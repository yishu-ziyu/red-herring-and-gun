"""Independent aggregation regressions from the 2026-09-08 contract.

These direct aggregation probes intentionally retain legacy trial dictionaries.
They test that negative evidence cannot become acceptance, independently of the
new receipt schema. QA_REPORT_MODULE selects the same evaluator's old/new target.
Session isolation is logical-only, not a permission-isolated blind assessment.
"""
import importlib.util
import os
import json
import tempfile
from pathlib import Path
import unittest

TARGET = Path(os.environ.get('QA_REPORT_MODULE', Path(__file__).with_name('qa_report.py')))
spec = importlib.util.spec_from_file_location('shannon_report_target', TARGET)
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)


def behavior(**overrides):
    row = {'behavior_id': 'independent-b', '当前覆盖状态': 'covered',
           '严重度': 'HIGH', 'evidence': 'a-test-file.py'}
    row.update(overrides)
    return row


def trial(status='PASS', terminal='COMPLETE'):
    return {'trial_id': 'independent-negative', 'behavior_ids': ['independent-b'],
            'execution_mode': 'CONTRACT_SUITE', 'driver': 'deterministic_runner',
            'frontend_sha': 'a' * 40, 'backend_sha': 'b' * 40,
            'instrument_version': 'legacy-probe', 'api_target': 'none',
            '_env_unverified': False, 'terminal_status': terminal,
            'checks': [{'id': 'independent-b', 'status': status,
                        'evidence_refs': ['deliberately-nonexistent-independent-artifact.png']}]}


class IndependentShannonReportTests(unittest.TestCase):
    def assert_rejected(self, row, trials):
        result = reporter.build_report([row], {'independent-b': trials})
        self.assertNotEqual(result['behaviors'][0]['status'], 'PASS', result)
        self.assertEqual(result['gate'], 'GATE_NOT_MET', result)
        return result

    def test_coverage_repo_suite_without_receipt_never_passes(self):
        self.assert_rejected(behavior(evidence_kind='repo-suite'), [])

    def test_repo_suite_cannot_mask_recorded_failure(self):
        self.assert_rejected(behavior(evidence_kind='repo-suite'), [trial('FAIL')])

    def test_human_failure_blocks_overall_gate(self):
        self.assert_rejected(behavior(human_gate=True), [trial('FAIL')])

    def test_terminal_failed_cannot_be_overridden_by_pass_checks(self):
        self.assert_rejected(behavior(), [trial('PASS', 'FAILED')])

    def test_required_automation_needs_human_is_incomplete(self):
        self.assert_rejected(behavior(), [trial('NEEDS_HUMAN')])


class IndependentIntegrityTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name)
        self.ref = self.artifact('result.json', {'observed': True})
        self.expected = dict(candidate_sha='a'*40, campaign_id='independent', dirty=False,
                             diff_sha256='d'*64, inventory_sha256='e'*64)
        self.t = dict(**self.expected, trial_id='independent-integrity', behavior_ids=['b'],
                      execution_mode='CONTRACT_SUITE', driver='deterministic_runner',
                      command=['python3', 'test.py'], started_at='2026-09-08T01:00:00+00:00',
                      ended_at='2026-09-08T01:00:01+00:00', exit_code=0,
                      terminal_status='COMPLETE', instrument=self.ref,
                      result_artifacts=[self.ref], checks=[dict(id='suite', behavior_id='b',
                      status='PASS', evidence_refs=[self.ref])])

    def artifact(self, name, value):
        path = self.path / name
        path.write_text(json.dumps(value))
        return dict(path=str(path), sha256=reporter.sha256(path))

    def test_json_cannot_impersonate_screenshot_and_trace(self):
        self.t.update(execution_mode='RECORDED_REPLAY', frontend_sha=self.expected['candidate_sha'],
                      source_manifest=self.ref)
        evaluation = self.artifact('evaluation.json', dict(trial_id=self.t['trial_id'], checks=self.t['checks']))
        self.t['result_artifacts'] = [dict(evaluation, role='evaluation'),
                                     dict(self.ref, role='trace'), dict(self.ref, role='screenshot')]
        self.assertTrue(reporter.execution_errors(self.t, self.expected),
                        'JSON bytes labeled trace/screenshot are not browser evidence')

    def test_matching_non_sha_candidate_is_invalid(self):
        self.t['candidate_sha'] = self.expected['candidate_sha'] = 'definitely-not-a-sha'
        self.assertTrue(reporter.execution_errors(self.t, self.expected),
                        'Matching arbitrary strings do not establish a candidate SHA')

    def test_live_non_sha_backend_and_generic_json_are_invalid(self):
        self.t.update(execution_mode='REAL_LIVE', frontend_sha=self.expected['candidate_sha'],
                      backend_sha='backend', api_target='http://localhost', backend_binding=self.ref)
        self.expected['backend_sha'] = 'backend'
        self.assertTrue(reporter.execution_errors(self.t, self.expected),
                        'Generic JSON and matching non-SHA strings cannot establish live backend')

    def test_live_binding_contents_must_match_backend_and_api(self):
        binding = self.artifact('binding.json', dict(backend_sha='c'*40, api_target='http://wrong-target'))
        self.t.update(execution_mode='REAL_LIVE', frontend_sha=self.expected['candidate_sha'],
                      backend_sha='b'*40, api_target='http://localhost', backend_binding=binding)
        self.expected['backend_sha'] = 'b'*40
        self.assertTrue(reporter.execution_errors(self.t, self.expected),
                        'Valid hash of a binding for another backend/API cannot verify this run')


if __name__ == '__main__':
    unittest.main(verbosity=2)
