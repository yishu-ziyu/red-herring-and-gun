#!/usr/bin/env python3
"""qa_report.py 自身的行为测试（验收工具也要被验收，任务书§9.4）。

运行：python3 -m unittest scripts.qa.qa_report_test -v（仓库根）
或： cd scripts/qa && python3 -m unittest qa_report_test -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import qa_report  # noqa: E402


def write_yaml(directory: str, name: str, content: str) -> str:
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(textwrap.dedent(content))
    return path


def behavior(behavior_id: str = "b1", **overrides) -> str:
    """生成单条 behavior 的 yaml 文本（默认 covered + evidence）。"""
    base = {
        "behavior_id": behavior_id,
        "requirement_ref": "ref",
        "用户目标": "g",
        "前置条件": "p",
        "允许的结果": "ok",
        "禁止的结果": "bad",
        "测量程序": "cmd",
        "证据路径": "evidence",
        "严重度": "HIGH",
        "当前覆盖状态": "covered",
        "evidence": "some-test-file",
    }
    base.update(overrides)
    items = [f"    {key}: {value}" for key, value in base.items()]
    return "behaviors:\n  -\n" + "\n".join(items) + "\n"


class QaReportTests(unittest.TestCase):
    def make_inventory(self, content: str) -> str:
        self._tmp = tempfile.TemporaryDirectory()
        return write_yaml(self._tmp.name, "inventory.yaml", content)

    def tearDown(self):
        if hasattr(self, "_tmp"):
            self._tmp.cleanup()

    def test_missing_required_field_is_schema_error(self):
        content = """
        behaviors:
          - behavior_id: b1
            requirement_ref: ref
        """
        inv = self.make_inventory(content)
        with self.assertRaises(qa_report.SchemaError):
            qa_report.validate_inventory(qa_report.load_yaml(inv))

    def test_covered_without_evidence_is_schema_error(self):
        content = """
        behaviors:
          - behavior_id: b1
            requirement_ref: ref
            用户目标: g
            前置条件: p
            允许的结果: ok
            禁止的结果: bad
            测量程序: cmd
            证据路径: e
            严重度: HIGH
            当前覆盖状态: covered
        """
        inv = self.make_inventory(content)
        with self.assertRaises(qa_report.SchemaError):
            qa_report.validate_inventory(qa_report.load_yaml(inv))

    def test_blocked_without_blocked_on_is_schema_error(self):
        content = """
        behaviors:
          - behavior_id: b1
            requirement_ref: ref
            用户目标: g
            前置条件: p
            允许的结果: ok
            禁止的结果: bad
            测量程序: cmd
            证据路径: e
            严重度: HIGH
            当前覆盖状态: blocked
        """
        inv = self.make_inventory(content)
        with self.assertRaises(qa_report.SchemaError):
            qa_report.validate_inventory(qa_report.load_yaml(inv))

    def test_pass_check_without_evidence_is_schema_error(self):
        """评分器自检反例：check 声称 PASS 但没有证据 → 试验记录非法，不得产生 PASS。"""
        content = behavior("b1")
        inv = self.make_inventory(content)
        trials = tempfile.mkdtemp()
        write_yaml(
            trials,
            "t1.yaml",
            """
            trial_id: t1
            behavior_ids: [b1]
            execution_mode: REAL_LIVE
            driver: browser_agent
            frontend_sha: abcdef0
            backend_sha: 1234567
            api_target: http://localhost
            instrument_version: v1
            checks:
              - id: c1
                status: PASS
                evidence_refs: []
            terminal_status: COMPLETE
            """,
        )
        qa_report.validate_inventory(qa_report.load_yaml(inv))
        with self.assertRaises(qa_report.SchemaError):
            qa_report.load_trials(trials)

    def test_fail_is_not_masked_by_other_pass(self):
        """两个行为一 PASS 一 FAIL：总门必须 GATE_NOT_MET。"""
        content = (
            behavior("b1")
            + """  -
    behavior_id: b2
    requirement_ref: ref
    用户目标: g
    前置条件: p
    允许的结果: ok
    禁止的结果: bad
    测量程序: cmd
    证据路径: e
    严重度: HIGH
    当前覆盖状态: missing
"""
        )
        inv = self.make_inventory(content)
        behaviors = qa_report.validate_inventory(qa_report.load_yaml(inv))
        report = qa_report.build_report(behaviors, {})
        statuses = {r["behavior_id"]: r["status"] for r in report["behaviors"]}
        self.assertEqual(statuses["b2"], "FAIL")
        self.assertEqual(report["gate"], "GATE_NOT_MET")

    def test_covered_without_valid_trial_is_not_run(self):
        """清单声称 covered 但没有任何环境可验证的 trial → NOT_RUN，不得 PASS。"""
        inv = self.make_inventory(behavior("b1"))
        behaviors = qa_report.validate_inventory(qa_report.load_yaml(inv))
        report = qa_report.build_report(behaviors, {})
        self.assertEqual(report["behaviors"][0]["status"], "NOT_RUN")
        self.assertEqual(report["gate"], "GATE_NOT_MET")

    def test_env_unverified_trial_does_not_produce_pass(self):
        inv = self.make_inventory(behavior("b1"))
        trials = tempfile.mkdtemp()
        write_yaml(
            trials,
            "t1.yaml",
            """
            trial_id: t1
            behavior_ids: [b1]
            execution_mode: REAL_LIVE
            driver: browser_agent
            frontend_sha: abcdef0
            backend_sha: unverified
            api_target: http://localhost
            instrument_version: v1
            checks:
              - id: c1
                status: PASS
                evidence_refs: [shot.png]
            terminal_status: COMPLETE
            """,
        )
        behaviors = qa_report.validate_inventory(qa_report.load_yaml(inv))
        trials_by_behavior, _ = qa_report.load_trials(trials)
        report = qa_report.build_report(behaviors, trials_by_behavior)
        self.assertEqual(report["behaviors"][0]["status"], "NOT_RUN")

    def test_valid_trial_with_pass_checks_produces_pass(self):
        inv = self.make_inventory(behavior("b1"))
        trials = tempfile.mkdtemp()
        write_yaml(
            trials,
            "t1.yaml",
            """
            trial_id: t1
            behavior_ids: [b1]
            execution_mode: REAL_LIVE
            driver: browser_agent
            frontend_sha: abcdef0
            backend_sha: 1234567
            api_target: http://localhost:8080
            instrument_version: v1
            checks:
              - id: c1
                status: PASS
                evidence_refs: [artifacts/shot.png]
            terminal_status: COMPLETE
            """,
        )
        behaviors = qa_report.validate_inventory(qa_report.load_yaml(inv))
        trials_by_behavior, _ = qa_report.load_trials(trials)
        report = qa_report.build_report(behaviors, trials_by_behavior)
        self.assertEqual(report["behaviors"][0]["status"], "PASS")
        self.assertNotEqual(report["gate"], "GATE_NOT_MET")

    def test_repo_suite_evidence_produces_pass_without_trial(self):
        """covered + evidence_kind=repo-suite：确定性仓库套件即版本绑定证据（随 npm test 对 HEAD 运行）。"""
        inv = self.make_inventory(behavior("b1", evidence_kind="repo-suite"))
        behaviors = qa_report.validate_inventory(qa_report.load_yaml(inv))
        report = qa_report.build_report(behaviors, {})
        self.assertEqual(report["behaviors"][0]["status"], "PASS")
        self.assertNotEqual(report["gate"], "GATE_NOT_MET")

    def test_human_gate_pending_reports_automation_passed_human_pending(self):
        """自动化全过 + 人评门未完成 → AUTOMATION_PASSED_HUMAN_PENDING，不是 READY_TO_SHIP。"""
        content = (
            behavior("b1")
            + """  -
    behavior_id: human1
    requirement_ref: ref
    用户目标: g
    前置条件: p
    允许的结果: ok
    禁止的结果: bad
    测量程序: cmd
    证据路径: e
    严重度: HIGH
    当前覆盖状态: blocked
    blocked_on: "issue-54 human validation"
    human_gate: true
"""
        )
        inv = self.make_inventory(content)
        trials = tempfile.mkdtemp()
        write_yaml(
            trials,
            "t1.yaml",
            """
            trial_id: t1
            behavior_ids: [b1]
            execution_mode: REAL_LIVE
            driver: browser_agent
            frontend_sha: abcdef0
            backend_sha: 1234567
            api_target: http://localhost:8080
            instrument_version: v1
            checks:
              - id: c1
                status: PASS
                evidence_refs: [artifacts/shot.png]
            terminal_status: COMPLETE
            """,
        )
        behaviors = qa_report.validate_inventory(qa_report.load_yaml(inv))
        trials_by_behavior, _ = qa_report.load_trials(trials)
        report = qa_report.build_report(behaviors, trials_by_behavior)
        self.assertEqual(report["gate"], "AUTOMATION_PASSED_HUMAN_PENDING")


if __name__ == "__main__":
    unittest.main()
