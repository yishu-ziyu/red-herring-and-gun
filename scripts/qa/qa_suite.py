#!/usr/bin/env python3
"""Run a local contract suite and retain its actual process receipt. No paid calls."""
import argparse
import hashlib
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ref(path):
    return dict(path=str(path), sha256=digest(path))


def git_state():
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    # Include tracked diff and untracked file contents, excluding generated QA outputs.
    tracked = subprocess.check_output(['git', 'diff', 'HEAD', '--binary'])
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z']).split(b'\0')
    inputs = []
    for raw in sorted(filter(None, untracked)):
        p = Path(raw.decode())
        if str(p).startswith(('out/', 'docs/qa/artifacts/', '.omo/', '.statamcp/')):
            continue
        if p.is_file():
            inputs.append(raw + b'\0' + hashlib.sha256(p.read_bytes()).digest())
    diff = tracked + b''.join(inputs)
    return dict(candidate_sha=sha, dirty=bool(diff), diff_sha256=hashlib.sha256(diff).hexdigest())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--campaign', required=True)
    p.add_argument('--inventory', required=True)
    p.add_argument('--behavior', action='append', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args()
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    if not command:
        p.error('command required')
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=False)
    state = git_state()
    start = datetime.now(timezone.utc).isoformat()
    with (out / 'process.log').open('wb') as log:
        run = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    end = datetime.now(timezone.utc).isoformat()
    unchanged = state == git_state()
    artifact = ref(out / 'process.log')
    receipt = dict(trial_id=str(uuid.uuid4()), campaign_id=a.campaign, **state, execution_mode='CONTRACT_SUITE', driver='deterministic_runner', command=command, started_at=start, ended_at=end, exit_code=run.returncode, terminal_status='COMPLETE' if run.returncode == 0 and unchanged else 'FAILED', inventory_sha256=digest(a.inventory), instrument=ref(__file__), instrument_files=[ref('scripts/qa/qa_report.py'), ref('scripts/qa/qa_report_test.py')], result_artifacts=[artifact], behavior_ids=a.behavior, checks=[dict(id='suite', behavior_id=b, status='PASS' if run.returncode == 0 and unchanged else 'FAIL', evidence_refs=[artifact]) for b in a.behavior], source_unchanged_during_run=unchanged)
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print(out / 'receipt.json')
    return run.returncode if run.returncode else int(not unchanged)


if __name__ == '__main__':
    sys.exit(main())
