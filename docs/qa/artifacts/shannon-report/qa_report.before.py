#!/usr/bin/env python3
"""qa:report — 从行为清单与试验记录生成验收覆盖报告（确定性，fail-closed）。

状态语义（docs/evals/2026-09-08-product-qa-contract.md）：
  PASS / FAIL / BLOCKED / NOT_RUN / NEEDS_HUMAN / NOT_APPLICABLE
  - 没有执行、缺证据、环境不对、评分器不可用，不得显示 PASS。
  - 必需非人评门存在 FAIL/BLOCKED/NOT_RUN 时自动化总门非零退出。
  - 自动化门全过但人评门尚缺：AUTOMATION_PASSED_HUMAN_PENDING，不写 READY_TO_SHIP。

退出码：0 = 自动化必需门全 PASS；1 = 存在未达标必需门；2 = 工具/Schema 错误。

用法：
  python3 scripts/qa/qa_report.py \
    [--inventory docs/qa/behavior-inventory.yaml] \
    [--trials-dir docs/qa/artifacts/trials] \
    [--out out/qa-report]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import yaml

BEHAVIOR_REQUIRED_FIELDS = [
    "behavior_id",
    "requirement_ref",
    "用户目标",
    "前置条件",
    "允许的结果",
    "禁止的结果",
    "测量程序",
    "证据路径",
    "严重度",
    "当前覆盖状态",
]
COVERAGE_STATUSES = {"covered", "partial", "pending-audit", "blocked", "missing"}
RESULT_STATUSES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "NEEDS_HUMAN", "NOT_APPLICABLE"}
EXECUTION_MODES = {"REAL_LIVE", "RECORDED_REPLAY", "SYNTHETIC_FIXTURE", "FAULT_INJECTED_LIVE"}
DRIVERS = {"browser_agent", "deterministic_runner", "human"}
TRIAL_REQUIRED_FIELDS = [
    "trial_id",
    "behavior_ids",
    "execution_mode",
    "driver",
    "frontend_sha",
    "backend_sha",
    "api_target",
    "instrument_version",
    "checks",
    "terminal_status",
]


class SchemaError(Exception):
    """清单/试验记录不合法：报告工具自身报错（exit 2），不是产品 FAIL。"""


def load_yaml(path: str):
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def validate_inventory(inventory) -> list[dict]:
    behaviors = (inventory or {}).get("behaviors")
    if not isinstance(behaviors, list) or not behaviors:
        raise SchemaError("inventory.behaviors 必须是非空数组")
    seen = set()
    for i, b in enumerate(behaviors):
        if not isinstance(b, dict):
            raise SchemaError(f"behaviors[{i}] 不是对象")
        missing = [f for f in BEHAVIOR_REQUIRED_FIELDS if not str(b.get(f, "")).strip()]
        if missing:
            raise SchemaError(
                f"behaviors[{i}] (behavior_id={b.get('behavior_id')!r}) 缺必需字段: {missing}"
            )
        bid = b["behavior_id"]
        if bid in seen:
            raise SchemaError(f"behavior_id 重复: {bid}")
        seen.add(bid)
        if b["当前覆盖状态"] not in COVERAGE_STATUSES:
            raise SchemaError(
                f"{bid} 当前覆盖状态非法: {b['当前覆盖状态']!r}（允许 {sorted(COVERAGE_STATUSES)}）"
            )
        if b["当前覆盖状态"] == "covered" and not str(b.get("evidence", "")).strip():
            raise SchemaError(f"{bid} 声称 covered 但没有 evidence 字段")
        if b["当前覆盖状态"] == "blocked" and not str(b.get("blocked_on", "")).strip():
            raise SchemaError(f"{bid} 声称 blocked 但没有 blocked_on 字段")
        if b["当前覆盖状态"] == "partial" and not str(b.get("missing_aspects", "")).strip():
            raise SchemaError(f"{bid} 声称 partial 但没有 missing_aspects 字段")
    return behaviors


def validate_trial(record, path: str) -> dict:
    if not isinstance(record, dict):
        raise SchemaError(f"{path}: trial 必须是对象")
    missing = [f for f in TRIAL_REQUIRED_FIELDS if f not in record]
    if missing:
        raise SchemaError(f"{path}: 缺必需字段 {missing}")
    if record["execution_mode"] not in EXECUTION_MODES:
        raise SchemaError(f"{path}: execution_mode 非法 {record['execution_mode']!r}")
    if record["driver"] not in DRIVERS:
        raise SchemaError(f"{path}: driver 非法 {record['driver']!r}")
    if not isinstance(record["checks"], list) or not record["checks"]:
        raise SchemaError(f"{path}: checks 必须是非空数组")
    for c in record["checks"]:
        if not isinstance(c, dict) or not {"id", "status", "evidence_refs"} <= set(c):
            raise SchemaError(f"{path}: 每条 check 需要 id/status/evidence_refs")
        if c["status"] not in RESULT_STATUSES:
            raise SchemaError(f"{path}: check status 非法 {c['status']!r}")
        if c["status"] == "PASS" and not c["evidence_refs"]:
            # 评分器自检反例：PASS 必须有证据，缺证据不得 PASS。
            raise SchemaError(f"{path}: check {c['id']!r} PASS 但 evidence_refs 为空")
    return record


def load_trials(trials_dir: str) -> tuple[dict[str, list[dict]], list[str]]:
    """返回 behavior_id -> 有效 trial 列表；ENVIRONMENT_UNVERIFIED 的 trial 不产生 PASS。"""
    by_behavior: dict[str, list[dict]] = {}
    if not os.path.isdir(trials_dir):
        return by_behavior, []
    for path in sorted(glob.glob(os.path.join(trials_dir, "*.yaml"))):
        record = validate_trial(load_yaml(path), path)
        env_unverified = str(record.get("backend_sha", "")).strip() in {"", "unverified", "unknown"}
        record["_env_unverified"] = env_unverified
        for bid in record["behavior_ids"]:
            by_behavior.setdefault(bid, []).append(record)
    return by_behavior, []


def behavior_status(b: dict, trials: list[dict]) -> str:
    coverage = b["当前覆盖状态"]
    if coverage == "missing":
        return "FAIL"
    if coverage == "blocked":
        return "BLOCKED"
    if coverage in {"partial", "pending-audit"}:
        return "NOT_RUN"
    # covered：两种可 PASS 的证据形态——
    # 1) evidence_kind=repo-suite：确定性仓库套件（随根 npm test 对当前 HEAD 运行）；
    # 2) trial 记录：环境可验证（backend_sha 已证明）、全部 check PASS。
    # 两者都没有 → NOT_RUN（证据不足以 PASS）。
    if str(b.get("evidence_kind", "")).strip() == "repo-suite":
        return "PASS"
    applicable = [t for t in trials if not t["_env_unverified"]]
    if not applicable:
        return "NOT_RUN"
    for t in applicable:
        for c in t["checks"]:
            if c["status"] != "PASS":
                return c["status"] if c["status"] != "PASS" else "NOT_RUN"
    return "PASS"


def build_report(behaviors: list[dict], trials_by_behavior: dict[str, list[dict]]) -> dict:
    rows = []
    for b in behaviors:
        bid = b["behavior_id"]
        human_gate = str(b.get("human_gate", "")).strip().lower() in {"true", "1", "yes"}
        status = behavior_status(b, trials_by_behavior.get(bid, []))
        if human_gate and status not in {"PASS"}:
            status = "NEEDS_HUMAN" if status in {"NOT_RUN"} else status
        rows.append(
            {
                "behavior_id": bid,
                "severity": b["严重度"],
                "coverage": b["当前覆盖状态"],
                "status": status,
                "blocked_on": b.get("blocked_on", ""),
                "human_gate": human_gate,
            }
        )
    automation_rows = [r for r in rows if not r["human_gate"]]
    automation_failed = [r for r in automation_rows if r["status"] in {"FAIL", "BLOCKED", "NOT_RUN"}]
    human_pending = [r for r in rows if r["human_gate"] and r["status"] in {"NEEDS_HUMAN", "BLOCKED", "NOT_RUN"}]
    if automation_failed:
        gate = "GATE_NOT_MET"
    elif human_pending:
        gate = "AUTOMATION_PASSED_HUMAN_PENDING"
    else:
        gate = "READY_ONLY_IF_HUMAN_GATES_PASS"
    return {"gate": gate, "behaviors": rows}


def render_markdown(report: dict, inventory_path: str) -> str:
    lines = [
        "# QA 覆盖报告（自动生成，勿手改）",
        "",
        f"- 清单：`{inventory_path}`",
        f"- 总门：**{report['gate']}**",
        "",
        "| behavior | 严重度 | 清单状态 | 判定 | 阻塞/说明 |",
        "|---|---|---|---|---|",
    ]
    for r in report["behaviors"]:
        note = r["blocked_on"] or ("人评门" if r["human_gate"] else "")
        lines.append(
            f"| {r['behavior_id']} | {r['severity']} | {r['coverage']} | {r['status']} | {note} |"
        )
    lines += [
        "",
        "高严重度错误不与其它分数抵消：任何 FAIL 都独立列在上方并使总门失败。",
        "本报告不写 READY_TO_SHIP；人评门全过且人工裁决后才可能由人宣布验收完成。",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", default="docs/qa/behavior-inventory.yaml")
    parser.add_argument("--trials-dir", default="docs/qa/artifacts/trials")
    parser.add_argument("--out", default="out/qa-report")
    args = parser.parse_args()

    try:
        behaviors = validate_inventory(load_yaml(args.inventory))
        trials_by_behavior, _ = load_trials(args.trials_dir)
    except (SchemaError, OSError, yaml.YAMLError) as exc:
        print(f"[qa:report] SCHEMA/TOOL ERROR: {exc}", file=sys.stderr)
        return 2

    report = build_report(behaviors, trials_by_behavior)
    out_md = f"{args.out}.md"
    out_json = f"{args.out}.json"
    os.makedirs(os.path.dirname(out_md) or ".", exist_ok=True)
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write(render_markdown(report, args.inventory))
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    counts: dict[str, int] = {}
    for r in report["behaviors"]:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"[qa:report] gate={report['gate']} counts={counts}")
    print(f"[qa:report] 写出 {out_md} 与 {out_json}")
    if report["gate"] == "GATE_NOT_MET":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
