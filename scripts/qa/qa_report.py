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
import hashlib
import re
import zipfile
import struct
from datetime import datetime
from pathlib import Path
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
EXECUTION_MODES = {"CONTRACT_SUITE", "REAL_LIVE", "RECORDED_REPLAY", "SYNTHETIC_FIXTURE", "FAULT_INJECTED_LIVE"}
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


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def artifact_valid(ref):
    try:
        return (isinstance(ref, dict) and bool(ref.get('path'))
                and sha256(ref['path']) == ref.get('sha256'))
    except (OSError, TypeError):
        return False


def validate_trial(record, path):
    if not isinstance(record, dict) or not isinstance(record.get('checks'), list):
        raise SchemaError(f'{path}: trial/checks 不合法')
    for c in record['checks']:
        if not isinstance(c, dict) or c.get('status') not in RESULT_STATUSES:
            raise SchemaError(f'{path}: check status 不合法')
        if c['status'] == 'PASS' and not c.get('evidence_refs'):
            raise SchemaError(f'{path}: PASS 缺少 evidence_refs')
    return record


def execution_errors(t, expected):
    errors = []
    if not expected or not expected.get('candidate_sha') or not expected.get('campaign_id'):
        return ['missing explicit expected candidate/campaign']
    if not re.fullmatch(r'[0-9a-f]{40}', str(expected.get('candidate_sha', ''))):
        errors.append('candidate must be full Git SHA')
    for key in ('candidate_sha', 'campaign_id', 'dirty', 'diff_sha256', 'inventory_sha256'):
        if key not in expected or t.get(key) != expected[key]:
            errors.append(f'{key} mismatch')
    if t.get('execution_mode') not in EXECUTION_MODES or t.get('driver') not in DRIVERS:
        errors.append('invalid execution mode/driver')
    if not t.get('trial_id') or not t.get('command') or not isinstance(t.get('exit_code'), int):
        errors.append('missing runner identity/command/exit')
    try:
        start, end = [datetime.fromisoformat(t[k].replace('Z', '+00:00')) for k in ('started_at', 'ended_at')]
        if not start.tzinfo or not end.tzinfo or end < start:
            errors.append('invalid timestamp order/timezone')
    except (KeyError, TypeError, ValueError, AttributeError):
        errors.append('missing timestamps')
    refs = [t.get('instrument')] + t.get('instrument_files', []) + t.get('result_artifacts', [])
    if not t.get('result_artifacts') or not all(artifact_valid(r) for r in refs):
        errors.append('missing or altered instrument/result artifact')
    mode = t.get('execution_mode')
    if mode != 'CONTRACT_SUITE' and t.get('frontend_sha') != expected['candidate_sha']:
        errors.append('frontend not bound')
    if mode in {'REAL_LIVE', 'FAULT_INJECTED_LIVE'}:
        if not expected.get('backend_sha') or t.get('backend_sha') != expected['backend_sha'] or not artifact_valid(t.get('backend_binding')):
            errors.append('backend not bound')
        if not t.get('api_target'):
            errors.append('missing api target')
        if not re.fullmatch(r'[0-9a-f]{40}', str(expected.get('backend_sha', ''))):
            errors.append('backend must be full Git SHA')
        try:
            binding = json.loads(Path(t['backend_binding']['path']).read_text())
            if binding.get('backend_sha') != expected.get('backend_sha') or binding.get('api_target') != t.get('api_target'):
                errors.append('backend binding content differs from expected backend/API')
        except (OSError, KeyError, TypeError, ValueError, AttributeError):
            errors.append('backend binding JSON is not parseable')
    if mode == 'RECORDED_REPLAY' and not artifact_valid(t.get('source_manifest')):
        errors.append('historical source manifest missing')
    if mode == 'RECORDED_REPLAY':
        artifacts = t.get('result_artifacts', [])
        roles = {r.get('role') for r in artifacts if isinstance(r, dict)}
        if not {'evaluation', 'trace', 'screenshot'} <= roles:
            errors.append('replay requires evaluation, trace and screenshot artifacts')
        for artifact in artifacts:
            try:
                if artifact.get('role') == 'screenshot':
                    data = Path(artifact['path']).read_bytes()
                    if len(data) < 33 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[8:16] != b'\x00\x00\x00\rIHDR' or not all(struct.unpack('>II', data[16:24])):
                        errors.append('screenshot is not PNG with valid IHDR')
                if artifact.get('role') == 'trace':
                    with zipfile.ZipFile(artifact['path']) as archive:
                        if not archive.namelist() or archive.testzip() is not None:
                            errors.append('trace ZIP is empty or corrupt')
            except (OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile, struct.error):
                errors.append('replay artifact type is not parseable')
        evaluations = [r for r in artifacts if isinstance(r, dict) and r.get('role') == 'evaluation']
        try:
            if len(evaluations) != 1:
                raise ValueError('one evaluation required')
            result = json.loads(Path(evaluations[0]['path']).read_text())
            keys = ('id', 'behavior_id', 'status')
            normalized = lambda checks: [{k: c.get(k) for k in keys} for c in checks]
            if result.get('trial_id') != t.get('trial_id') or normalized(result['checks']) != normalized(t['checks']):
                errors.append('replay evaluation differs from receipt')
        except (OSError, KeyError, TypeError, ValueError):
            errors.append('replay evaluation is not parseable')
    for c in t['checks']:
        if c.get('status') == 'PASS' and not all(artifact_valid(r) for r in c.get('evidence_refs', [])):
            errors.append(f"check {c.get('id')} artifact missing/altered")
    return errors


def load_trials(trials_dir, expected=None):
    by_behavior = {}
    for path in sorted(Path(trials_dir).glob('*')) if Path(trials_dir).is_dir() else []:
        if path.suffix not in {'.yaml', '.yml', '.json'}:
            continue
        t = validate_trial(load_yaml(str(path)), str(path))
        t['_path'] = str(path)
        t['_history'] = bool(expected and (t.get('candidate_sha') != expected.get('candidate_sha') or t.get('campaign_id') != expected.get('campaign_id')))
        t['_errors'] = execution_errors(t, expected)
        for bid in t.get('behavior_ids', []):
            by_behavior.setdefault(bid, []).append(t)
    return by_behavior, []


def current_trials(trials):
    return [t for t in trials if not t.get('_history')]


def relevant_checks(b, t):
    return [c for c in t['checks'] if c.get('behavior_id', b['behavior_id'] if len(t.get('behavior_ids', [])) <= 1 else None) == b['behavior_id']]


def behavior_status(b, trials):
    applicable = current_trials(trials)
    # A failed attempt remains a failure even when its evidence is incomplete.
    for t in applicable:
        if t.get('terminal_status') == 'FAILED' or (isinstance(t.get('exit_code'), int) and t['exit_code'] != 0):
            return 'FAIL'
        if any(c['status'] == 'FAIL' for c in relevant_checks(b, t)):
            return 'FAIL'
    if b['当前覆盖状态'] == 'missing':
        return 'FAIL'
    if b['当前覆盖状态'] == 'blocked':
        return 'BLOCKED'
    if b['当前覆盖状态'] in {'partial', 'pending-audit'}:
        return 'NOT_RUN'
    if not applicable:
        return 'NOT_RUN'
    statuses = []
    for t in applicable:
        if t.get('_errors', ['unvalidated receipt']) or t.get('terminal_status') != 'COMPLETE':
            return 'NOT_RUN'
        if t.get('execution_mode') == 'CONTRACT_SUITE' and t.get('command') not in b.get('approved_commands', []):
            return 'BLOCKED'
        checks = relevant_checks(b, t)
        if not checks:
            return 'NOT_RUN'
        required = set(b.get('required_checks', []))
        if not required:
            return 'NOT_RUN'
        if not required.issubset({c['id'] for c in checks}):
            return 'NOT_RUN'
        if str(b.get('human_gate', '')).lower() in {'true', '1', 'yes'} and t.get('driver') != 'human':
            return 'NEEDS_HUMAN'
        for c in checks:
            status = c['status']
            if status == 'NOT_APPLICABLE':
                a = c.get('adjudication', {})
                if not b.get('allow_not_applicable') or not a.get('reason') or not a.get('by') or a.get('contract_ref') != b.get('requirement_ref') or not artifact_valid(a.get('evidence')):
                    return 'BLOCKED'
            statuses.append(status)
    for status in ('BLOCKED', 'NOT_RUN', 'NEEDS_HUMAN'):
        if status in statuses:
            return status
    return 'PASS' if 'PASS' in statuses else 'NOT_APPLICABLE'


def build_report(behaviors, trials_by_behavior):
    rows = []
    historical = {}
    for b in behaviors:
        trials = trials_by_behavior.get(b['behavior_id'], [])
        human = str(b.get('human_gate', '')).lower() in {'true', '1', 'yes'}
        status = behavior_status(b, trials)
        if human and status in {'NOT_RUN', 'BLOCKED', 'NEEDS_HUMAN'}:
            status = 'HUMAN_PENDING'
        current = current_trials(trials)
        execution = 'NOT_RUN' if not current else ('FAILED' if any(t.get('terminal_status') == 'FAILED' or t.get('exit_code', 0) != 0 for t in current) else 'UNVERIFIED' if any(t.get('_errors', ['unvalidated receipt']) or t.get('terminal_status') != 'COMPLETE' for t in current) else 'COMPLETE')
        rows.append(dict(behavior_id=b['behavior_id'], severity=b['严重度'], coverage=b['当前覆盖状态'], execution=execution, acceptance=status, status=status, human_gate=human, blocked_on=b.get('blocked_on', ''), evidence_errors=[{'trial_id': t.get('trial_id'), 'errors': t.get('_errors', ['unvalidated receipt'])} for t in current]))
        for t in trials:
            if t.get('_history'):
                historical[t.get('_path', t['trial_id'])] = {k: t.get(k) for k in ('trial_id', 'candidate_sha', 'campaign_id', 'terminal_status', '_path')}
    machine_fail = any(r['status'] not in {'PASS', 'NOT_APPLICABLE'} for r in rows if not r['human_gate'])
    human_fail = any(r['human_gate'] and r['status'] == 'FAIL' for r in rows)
    pending = any(r['status'] == 'HUMAN_PENDING' for r in rows)
    gate = 'GATE_NOT_MET' if machine_fail or human_fail else 'AUTOMATION_PASSED_HUMAN_PENDING' if pending else 'READY_ONLY_IF_HUMAN_GATES_PASS'
    return dict(gate=gate, automation='FAIL' if machine_fail else 'PASS', overall_acceptance='FAIL' if machine_fail or human_fail else 'HUMAN_PENDING' if pending else 'PASS', behaviors=rows, historical_trials=list(historical.values()))


def render_markdown(report, inventory_path):
    lines = ['# QA 执行与验收报告', '', f"清单：{inventory_path}；总门：{report['gate']}；自动化：{report['automation']}；总体验收：{report['overall_acceptance']}", '', '| behavior | coverage | execution | acceptance |', '|---|---|---|---|']
    lines += [f"| {r['behavior_id']} | {r['coverage']} | {r['execution']} | {r['acceptance']} |" for r in report['behaviors']]
    lines += ['', '历史候选/批次（不计入当前结果）：', json.dumps(report['historical_trials'], ensure_ascii=False), '', '本报告只覆盖指定清单；自动化不替代真人验收。']
    return '\n'.join(lines) + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', default='docs/qa/behavior-inventory.yaml')
    p.add_argument('--trials-dir', default='docs/qa/artifacts/trials')
    p.add_argument('--out', default='out/qa-report')
    p.add_argument('--expected-candidate', required=True)
    p.add_argument('--expected-campaign', required=True)
    p.add_argument('--expected-diff', required=True)
    p.add_argument('--expected-dirty', choices=['true', 'false'], required=True)
    p.add_argument('--expected-backend')
    a = p.parse_args()
    try:
        expected = dict(candidate_sha=a.expected_candidate, campaign_id=a.expected_campaign, dirty=a.expected_dirty == 'true', diff_sha256=a.expected_diff, inventory_sha256=sha256(a.inventory), backend_sha=a.expected_backend)
        behaviors = validate_inventory(load_yaml(a.inventory))
        trials, _ = load_trials(a.trials_dir, expected)
        report = build_report(behaviors, trials)
        report['expected'] = expected
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out + '.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        Path(a.out + '.md').write_text(render_markdown(report, a.inventory))
        print(f"[qa:report] {report['gate']}; {a.out}.json")
        return int(report['gate'] == 'GATE_NOT_MET')
    except (SchemaError, OSError, yaml.YAMLError) as e:
        print(f'[qa:report] SCHEMA/TOOL ERROR: {e}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
