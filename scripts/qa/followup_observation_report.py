#!/usr/bin/env python3
"""followup:report — 汇总追问观测记录（阶段 3：先观测，再决定是否建快路径）。

契约：docs/evals/2026-09-12-followup-observation.md（观测记录字段逐字钉死）。
本脚本只读 $DATA_DIR/followup-observations.jsonl，做确定性汇总，不判断产品好坏：
  样本总数、fastPathCandidate 占比、newSourceCount 分布、verdictDelta 分布、atomsSearched 均值。

DATA_DIR 沿用服务端约定（apps/server/src/lib/sqliteStore.ts: dataDir()）：
  --data-dir > $DATA_DIR > <当前工作目录>/.data
服务端进程的 cwd 是 apps/server，因此它的落盘目录通常是 apps/server/.data；
在仓库根执行时请显式传 --data-dir apps/server/.data（或设 DATA_DIR）。

退出码：0 = 汇总完成（含文件不存在 / 文件为空 / 存在无法解析的行，后两者会打印计数）；
        2 = 文件存在但读不动（权限等）。

用法：
  python3 scripts/qa/followup_observation_report.py [--data-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter

FILE_NAME = "followup-observations.jsonl"
TAG = "[followup:report]"
VERDICT_DELTAS = ("same", "strengthened", "weakened", "changed", "unknown")


def default_data_dir() -> str:
    return os.environ.get("DATA_DIR") or os.path.join(os.getcwd(), ".data")


def server_data_dir_candidate() -> str | None:
    """仅用于缺文件时的提示：仓库内 apps/server/.data 若有观测记录，提示它。不做自动回退。"""
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    candidate = os.path.join(repo_root, "apps", "server", ".data", FILE_NAME)
    return candidate if os.path.exists(candidate) else None


def as_number(value: object) -> float | None:
    """数字字段取值；bool 是 int 的子类，必须排除，否则 True 会被当成 1 混进分布。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def fmt_number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def fmt_ratio(hit: int, total: int) -> str:
    if total == 0:
        return "n/a"
    return f"{hit}/{total} ({hit / total * 100:.1f}%)"


def short_label(value: str) -> str:
    """契约里 verdictDelta 只是短标签；不按原样回显任意字符串，避免把脏数据里的长文本带进终端。"""
    flat = " ".join(value.split())
    return flat if len(flat) <= 40 else flat[:40] + "…"


def load_records(path: str) -> tuple[list[dict], int] | None:
    """返回 (记录列表, 无法解析行数)；文件不存在或只有空白返回 ([], 0)，读不动返回 None。"""
    if not os.path.exists(path):
        return [], 0
    records: list[dict] = []
    malformed = 0
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    malformed += 1
                    continue
                if isinstance(parsed, dict):
                    records.append(parsed)
                else:
                    malformed += 1
    except OSError as exc:
        print(f"{TAG} 无法读取 {path}：{exc}", file=sys.stderr)
        return None
    return records, malformed


def report(path: str, records: list[dict], malformed: int) -> None:
    total = len(records)

    candidates = 0
    candidate_seen = 0
    for rec in records:
        flag = rec.get("fastPathCandidate")
        if isinstance(flag, bool):
            candidate_seen += 1
            if flag:
                candidates += 1

    new_source_counts: Counter[str] = Counter()
    new_source_zero = 0
    new_source_seen = 0
    for rec in records:
        value = as_number(rec.get("newSourceCount"))
        if value is None:
            continue
        new_source_seen += 1
        new_source_counts[fmt_number(value)] += 1
        if value == 0:
            new_source_zero += 1

    verdict_delta_counts: Counter[str] = Counter()
    for rec in records:
        raw = rec.get("verdictDelta")
        if isinstance(raw, str) and raw in VERDICT_DELTAS:
            verdict_delta_counts[raw] += 1
        elif isinstance(raw, str):
            verdict_delta_counts[f"不在契约取值内({short_label(raw)})"] += 1
        else:
            verdict_delta_counts["不可用"] += 1

    searched_values: list[float] = []
    searched_missing = 0
    for rec in records:
        value = as_number(rec.get("atomsSearched"))
        if value is None:
            searched_missing += 1
        else:
            searched_values.append(value)
    searched_mean = sum(searched_values) / len(searched_values) if searched_values else None

    print(f"{TAG} 数据文件: {path}")
    print(f"{TAG} 样本总数: {total}")
    if malformed:
        print(f"{TAG} 无法解析的行: {malformed}（未计入样本总数）")

    print(
        f"{TAG} fastPathCandidate: {fmt_ratio(candidates, candidate_seen)}"
        f"（按可判定记录 {candidate_seen} 条算；缺该字段 {total - candidate_seen} 条）"
    )

    print(f"{TAG} newSourceCount 分布:")
    if new_source_counts:
        for key in sorted(new_source_counts, key=lambda text: float(text)):
            print(f"    {key}: {new_source_counts[key]}")
    else:
        print("    （无可用数值）")
    print(f"    无新来源 (newSourceCount == 0): {fmt_ratio(new_source_zero, new_source_seen)}")

    print(f"{TAG} verdictDelta 分布:")
    for label in VERDICT_DELTAS:
        print(f"    {label}: {verdict_delta_counts.get(label, 0)}")
    for label in sorted(key for key in verdict_delta_counts if key not in VERDICT_DELTAS):
        print(f"    {label}: {verdict_delta_counts[label]}")

    if searched_mean is None:
        print(f"{TAG} atomsSearched 均值: n/a（无可用数值）")
    else:
        print(
            f"{TAG} atomsSearched 均值: {searched_mean:.2f}"
            f"（n={len(searched_values)}，缺该字段 {searched_missing} 条）"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="汇总追问观测 JSONL（只读，不改任何数据）")
    parser.add_argument(
        "--data-dir",
        default=None,
        help="数据目录；默认取 $DATA_DIR，未设时用 <当前工作目录>/.data（与服务端约定一致）",
    )
    args = parser.parse_args()

    data_dir = args.data_dir if args.data_dir else default_data_dir()
    path = os.path.join(data_dir, FILE_NAME)

    loaded = load_records(path)
    if loaded is None:
        return 2
    records, malformed = loaded

    if not records and malformed == 0:
        print(f"{TAG} 尚无观测记录：{path}")
        print(f"{TAG} 文件不存在或为空。追问 run 完成后会往这里追加一行；若服务端的数据目录不是这里，")
        print(f"{TAG} 请用 --data-dir 指定（服务端 cwd 为 apps/server 时是 apps/server/.data，或设 DATA_DIR）。")
        other = server_data_dir_candidate()
        if other and os.path.abspath(other) != os.path.abspath(path):
            print(f"{TAG} 提示：仓库内 {other} 存在，可能才是服务端实际落盘处，可改用 --data-dir 指向它。")
        return 0

    report(path, records, malformed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
