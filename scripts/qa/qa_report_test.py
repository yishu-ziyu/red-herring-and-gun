"""Evidence contract tests: no live model calls."""
import base64
import zipfile
import copy
import json
import tempfile
import unittest
from pathlib import Path
from scripts.qa import qa_report as q


class QaReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        artifact = self.path / 'result.json'
        artifact.write_text('{"observed":true}')
        self.ref = dict(path=str(artifact), sha256=q.sha256(artifact))
        self.b = dict(behavior_id='b', 严重度='HIGH', 当前覆盖状态='covered', evidence_kind='repo-suite', requirement_ref='contract', required_checks=['suite'], approved_commands=[['python3','test.py']])
        self.expected = dict(candidate_sha='a'*40, campaign_id='campaign', dirty=False, diff_sha256='d'*64, inventory_sha256='e'*64)
        self.t = dict(**self.expected, trial_id='run', behavior_ids=['b'], execution_mode='CONTRACT_SUITE', driver='deterministic_runner', command=['python3','test.py'], started_at='2026-09-08T01:00:00+00:00', ended_at='2026-09-08T01:00:01+00:00', exit_code=0, terminal_status='COMPLETE', instrument=self.ref, result_artifacts=[self.ref], checks=[dict(id='suite', behavior_id='b', status='PASS', evidence_refs=[self.ref])])

    def report(self, t=None, b=None):
        t = copy.deepcopy(t or self.t)
        t['_errors'] = q.execution_errors(t, self.expected)
        return q.build_report([b or self.b], {'b':[t]})

    def test_real_complete_contract_receipt_passes_without_backend(self):
        self.assertEqual(self.report()['overall_acceptance'], 'PASS')

    def test_no_receipt_cannot_pass(self):
        self.assertEqual(q.build_report([self.b], {})['behaviors'][0]['status'], 'NOT_RUN')

    def test_missing_and_tampered_artifacts_fail_closed(self):
        for ref in [dict(path='/no/such/file', sha256='x'), dict(**self.ref, extra=True)]:
            t = copy.deepcopy(self.t)
            t['checks'][0]['evidence_refs'] = [ref]
            if ref.get('extra'): ref['sha256'] = 'bad'
            self.assertNotEqual(self.report(t)['overall_acceptance'], 'PASS')

    def test_receipt_binding_and_completeness(self):
        for key in ['candidate_sha','campaign_id','diff_sha256','inventory_sha256','dirty','started_at','command','instrument','result_artifacts']:
            with self.subTest(key=key):
                t = copy.deepcopy(self.t); del t[key]
                self.assertNotEqual(self.report(t)['overall_acceptance'], 'PASS')

    def test_fail_attempt_not_cancelled_by_pass(self):
        passed = copy.deepcopy(self.t); passed['_errors'] = []
        failed = copy.deepcopy(passed); failed['checks'][0]['status'] = 'FAIL'
        self.assertEqual(q.build_report([self.b], {'b':[passed,failed]})['overall_acceptance'], 'FAIL')

    def test_human_fail_blocks_overall(self):
        t = copy.deepcopy(self.t); t['driver']='human'; t['checks'][0]['status']='FAIL'
        b = dict(self.b, human_gate=True)
        self.assertEqual(self.report(t,b)['overall_acceptance'], 'FAIL')

    def test_human_pending_is_not_overall_pass(self):
        b = dict(self.b, human_gate=True)
        r = q.build_report([b], {})
        self.assertEqual(r['automation'],'PASS')
        self.assertEqual(r['overall_acceptance'],'HUMAN_PENDING')

    def test_automated_needs_human_is_incomplete(self):
        t = copy.deepcopy(self.t); t['checks'][0]['status']='NEEDS_HUMAN'
        self.assertEqual(self.report(t)['gate'],'GATE_NOT_MET')

    def test_terminal_failure_not_hidden(self):
        t = dict(self.t, terminal_status='FAILED')
        self.assertEqual(self.report(t)['overall_acceptance'],'FAIL')

    def test_old_candidate_separate(self):
        t = dict(self.t, candidate_sha='old')
        (self.path/'trial.json').write_text(json.dumps(t))
        # Only trial files belong in trials directory.
        (self.path/'result.json').rename(self.path/'result.txt')
        loaded,_ = q.load_trials(str(self.path),self.expected)
        r=q.build_report([self.b],loaded)
        self.assertEqual(r['behaviors'][0]['status'],'NOT_RUN')
        self.assertEqual(len(r['historical_trials']),1)

    def test_na_requires_contract_and_adjudication(self):
        t = copy.deepcopy(self.t); t['checks'][0]['status']='NOT_APPLICABLE'
        self.assertEqual(self.report(t)['overall_acceptance'],'FAIL')
        t['checks'][0]['adjudication']=dict(reason='outside frozen contract',by='reviewer',contract_ref='contract',evidence=self.ref)
        self.assertEqual(self.report(t,dict(self.b,allow_not_applicable=True))['overall_acceptance'],'PASS')

    def test_replay_needs_frontend_and_historical_manifest(self):
        t=dict(self.t,execution_mode='RECORDED_REPLAY')
        self.assertEqual(self.report(t)['overall_acceptance'],'FAIL')
        t.update(frontend_sha=self.expected['candidate_sha'],source_manifest=self.ref)
        evaluation = self.path / 'evaluation.json'
        evaluation.write_text(json.dumps(dict(trial_id=t['trial_id'],checks=t['checks'])))
        screenshot = self.path / 'shot.png'
        screenshot.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='))
        trace = self.path / 'trace.zip'
        with zipfile.ZipFile(trace, 'w') as z:
            z.writestr('trace.trace', '{"type":"context-options"}\n')
        t['result_artifacts'] = [dict(path=str(evaluation),sha256=q.sha256(evaluation),role='evaluation'),dict(path=str(trace),sha256=q.sha256(trace),role='trace'),dict(path=str(screenshot),sha256=q.sha256(screenshot),role='screenshot')]
        self.assertEqual(self.report(t)['overall_acceptance'],'PASS')

    def test_live_needs_expected_backend_and_artifact(self):
        t=dict(self.t,execution_mode='REAL_LIVE',frontend_sha=self.expected['candidate_sha'],backend_sha='b'*40,api_target='http://localhost')
        self.assertEqual(self.report(t)['overall_acceptance'],'FAIL')
        self.expected['backend_sha']='b'*40
        binding = self.path / 'binding.json'
        binding.write_text(json.dumps(dict(backend_sha='b'*40, api_target=t['api_target'])))
        t['backend_binding']=dict(path=str(binding),sha256=q.sha256(binding))
        self.assertEqual(self.report(t)['overall_acceptance'],'PASS')

    def test_partial_coverage_cannot_pass_from_subset(self):
        self.assertEqual(self.report(b=dict(self.b, 当前覆盖状态='partial'))['overall_acceptance'],'FAIL')

    def test_command_must_be_allowed_by_contract(self):
        t = dict(self.t,command=['echo','passed'])
        self.assertEqual(self.report(t)['overall_acceptance'],'FAIL')

    def test_required_check_contract_must_exist(self):
        self.assertEqual(self.report(b=dict(self.b,required_checks=[]))['overall_acceptance'],'FAIL')

    def test_missing_required_check_cannot_pass(self):
        self.assertEqual(self.report(b=dict(self.b,required_checks=['another']))['overall_acceptance'],'FAIL')

if __name__ == '__main__':
    unittest.main()
