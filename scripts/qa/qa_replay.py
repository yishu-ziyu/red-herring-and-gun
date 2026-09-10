#!/usr/bin/env python3
"""Recorded snapshot → existing DEV replay adapter → production UI. No live API.

Deterministic runner, not a simulated or human comprehension study. Creates a
new evidence directory per invocation; historical recordings are read-only.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import http.server
import json
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import os
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_smoke import find_cached_chromium
from qa_suite import git_state
from replay_checks import check_profiles, expected_target, SNAPSHOT_SHA256

ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / 'docs/design/2026-09-06-mode3-production/final/real-after-76'
SNAPSHOT = HISTORY / 'snapshots/complete.json'


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def artifact(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def public_trace(raw, destination):
    """Publish a derived trace without cookie/authorization headers or cookie jars."""
    private_headers = {'cookie', 'set-cookie', 'authorization', 'proxy-authorization'}

    def scrub(value):
        if isinstance(value, list):
            return [scrub(v) for v in value if not (isinstance(v, dict) and str(v.get('name', '')).lower() in private_headers)]
        if isinstance(value, dict):
            return {k: ([] if k.lower() == 'cookies' else scrub(v)) for k, v in value.items() if k.lower() not in private_headers}
        return value

    with zipfile.ZipFile(raw) as source, zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            content = source.read(name)
            if name.endswith(('.trace', '.network')):
                content = ('\n'.join(json.dumps(scrub(json.loads(line)), ensure_ascii=False) for line in content.decode().splitlines() if line) + '\n').encode()
            target.writestr(name, content)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def replay_server(snapshot, out, port=0):
    """Serve Vite's actual HTML/assets with the existing replay init payload.

    No alternate page or UI. This read-only proxy refuses every API request.
    It also makes the same recording accessible to an independent browser session.
    """
    vite_port = free_port()
    command = [str(ROOT / 'mvp/node_modules/.bin/vite'), '--host', '127.0.0.1', '--port', str(vite_port), '--strictPort']
    pack = json.dumps({'frames': [{'delayMs': 50, 'investigation': snapshot, 'complete': True}]}, ensure_ascii=False).replace('<', '\\u003c')
    inject = f'<script>window.__RHG_REPLAY={pack};</script>'.encode()
    log = (out / 'vite.log').open('w')
    process = subprocess.Popen(command, cwd=ROOT / 'mvp', stdout=log, stderr=subprocess.STDOUT)
    server = None
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('candidate Vite exited; see vite.log')
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{vite_port}/', timeout=.5).close()
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.1)
        else:
            raise RuntimeError('candidate Vite did not become ready')

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path.startswith(('/api', '/health', '/mcp', '/r/')):
                    self.send_error(503, 'RECORDED_REPLAY: backend disabled')
                    return
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{vite_port}{self.path}', timeout=15) as response:
                        body = response.read()
                        content_type = response.headers.get('Content-Type', '')
                        if 'text/html' in content_type:
                            body = body.replace(b'<head>', b'<head>' + inject, 1)
                        self.send_response(response.status)
                        self.send_header('Content-Type', content_type)
                        self.send_header('Content-Length', str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                except (OSError, urllib.error.URLError):
                    self.send_error(502)

        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/?fixture=replay'
        write(out / 'frontend-process.json', {'cwd': str(ROOT / 'mvp'), 'pid': process.pid, 'command': command, 'url': url, 'started_at': now(), 'backend': 'DISABLED_RECORDED_REPLAY'})
        yield url
    finally:
        if server:
            server.shutdown()
            server.server_close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        log.close()


def record_profile(browser, url, out, name, snapshot, synthetic):
    keyboard = name == 'keyboardReduced'
    viewport = {'width': 390 if name == 'mobile390' else 1440, 'height': 844 if name == 'mobile390' else 900}
    context = browser.new_context(viewport=viewport, reduced_motion='reduce' if keyboard else 'no-preference', locale='zh-CN')
    context.tracing.start(screenshots=True, snapshots=True, sources=False)
    page = context.new_page()
    trace = []
    result = {'name': name, 'viewport': viewport, 'actions': trace}
    directory = out / name
    directory.mkdir()
    shot = directory / 'drawer.png'
    trace_path = directory / 'trace.zip'

    def action(description):
        trace.append({'at': now(), 'action': description, 'url': page.url})
        result['overflowPx'] = max(result.get('overflowPx', 0), page.evaluate('Math.max(0, document.documentElement.scrollWidth-innerWidth)'))
        if len(trace) > 40:
            raise AssertionError('profile action budget exceeded')

    def tab_to(locator):
        # Actual keyboard discovery with a bounded budget, never locator.focus().
        for _ in range(40):
            if locator.evaluate('(el) => el === document.activeElement'):
                return
            page.keyboard.press('Tab')
            action('Tab')
        raise AssertionError('keyboard target not reached within 40 tabs')

    try:
        page.goto(url, wait_until='domcontentloaded')
        action('打开记录调查')
        page.locator('[data-gp-direct-answer]').wait_for()
        page.screenshot(path=str(directory / 'answer.png'))
        original = page.locator('.gp-original-text')
        original.scroll_into_view_if_needed()
        result.update(originalClaimVisible=original.is_visible(), originalClaimText=original.inner_text())
        answer = page.locator('[data-gp-direct-answer]')
        answer.scroll_into_view_if_needed()
        result.update(directAnswerVisible=answer.is_visible(), directAnswerText=answer.inner_text())
        result['claimTextsVisible'] = []
        for claim_text in page.locator('.gp-claim-text').all():
            claim_text.scroll_into_view_if_needed()
            if claim_text.is_visible():
                result['claimTextsVisible'].append(claim_text.inner_text())
        action('阅读原句、判断和命题')
        claim, source = expected_target(snapshot)
        section = page.locator(f'article[data-gp-claim-id="{claim["id"]}"]')
        header = section.locator('.gp-claim-head')
        if keyboard:
            tab_to(header)
            if header.get_attribute('aria-expanded') == 'true':
                page.keyboard.press('Enter')
            page.keyboard.press('Enter')
        else:
            if header.get_attribute('aria-expanded') == 'true':
                header.click()
            header.click()
        action('展开命题')
        trigger = section.locator(f'[data-source-id="{source["id"]}"]').first
        if keyboard:
            tab_to(trigger)
            page.keyboard.press('Enter')
        else:
            trigger.click()
        drawer = page.get_by_role('dialog')
        drawer.wait_for()
        page.wait_for_function('''() => { const r = document.querySelector('[role=dialog]').getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth+1 && r.bottom <= innerHeight+1; }''')
        page.wait_for_timeout(400)  # capture the settled drawer, not its entry transform
        link = drawer.locator('a.gp-source-open')
        if synthetic:
            # Sandbox DOM mutation only. The immutable recording is untouched.
            link.evaluate('(el) => el.href = "https://example.invalid/wrong-source"')
            action('SYNTHETIC_FIXTURE: sandbox 来源 href 故障注入')
        result.update(openedClaimId=drawer.get_attribute('data-gp-claim-id'), selectedSourceId=drawer.get_attribute('data-gp-source-id'), drawerVisible=drawer.is_visible(), drawerHref=link.get_attribute('href'), drawerTitle=drawer.locator('.gp-source-title').inner_text())
        page.screenshot(path=str(shot))
        action('打开来源抽屉并读取关系与摘录')
        requests = []
        responses = []
        context.on('response', lambda response: responses.append({'url': response.url, 'status': response.status}) if response.request.is_navigation_request() else None)
        context.on('request', lambda request: requests.append(request.url) if request.is_navigation_request() else None)
        if keyboard:
            tab_to(link)
        with context.expect_page() as popup:
            if keyboard:
                page.keyboard.press('Enter')
            else:
                link.click()
        source_page = popup.value
        result['sourceNavigationAttempted'] = True
        try:
            source_page.wait_for_url(lambda url: bool(url) and url != 'about:blank', wait_until='domcontentloaded', timeout=15000)
            result['sourceFinalUrl'] = source_page.url
            source_page.screenshot(path=str(directory / 'external-source.png'), timeout=5000)
        except Exception as exc:
            result['sourceNavigationError'] = str(exc)[:500]
        result['openedSourceUrl'] = requests[0] if requests else source_page.url
        result['sourceResponseStatus'] = responses[-1]['status'] if responses else 'unknown'
        result['sourceResponses'] = responses
        source_page.close()
        page.bring_to_front()
        result['sourcePageClosedReturned'] = source_page.is_closed() and not page.is_closed()
        action('点击打开原文、新页关闭返回')
        if keyboard:
            page.keyboard.press('Escape')
        else:
            drawer.locator('[data-gp-source-close]').click()
        drawer.wait_for(state='detached')
        page.wait_for_function('(selector) => document.querySelector(selector) === document.activeElement', arg=f'article[data-gp-claim-id="{claim["id"]}"] [data-source-id="{source["id"]}"]', timeout=2000)
        result.update(focusReturned=trigger.evaluate('(el) => el === document.activeElement'), reducedMotion=page.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), overflowPx=max(result.get('overflowPx', 0), page.evaluate('Math.max(0, document.documentElement.scrollWidth-innerWidth)')))
        action('关闭抽屉，返回命题与焦点')
        answer.scroll_into_view_if_needed()
        result['closedReturned'] = not drawer.count() and answer.is_visible() and answer.evaluate('(el) => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }')
        action('滚回判断，确认直接答案再次进入视口')
        page.screenshot(path=str(directory / 'returned.png'))
    except Exception as exc:
        result['error'] = str(exc)
        page.screenshot(path=str(shot))
    finally:
        private = ROOT / '.data/qa-private-traces'
        private.mkdir(parents=True, exist_ok=True, mode=0o700)
        raw = private / (str(uuid.uuid4()) + '.zip')
        context.tracing.stop(path=str(raw))
        os.chmod(raw, 0o600)
        public_trace(raw, trace_path)
        result['trace_derivation'] = 'Cookie/Set-Cookie/Authorization headers and cookie jars removed; raw trace retained privately'
        result['artifacts'] = {'screenshot': str(shot), 'trace': str(trace_path)}
        write(directory / 'operations.json', trace)
        context.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--inventory', default='docs/qa/replay-scope.yaml')
    parser.add_argument('--synthetic-wrong-source', action='store_true')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    if artifact(SNAPSHOT)['sha256'] != SNAPSHOT_SHA256:
        raise RuntimeError('historical recording changed; do not silently change evaluator')
    snapshot = json.loads(SNAPSHOT.read_text())
    started = now()
    state = git_state()
    candidate = state['candidate_sha']
    # Runner generated evidence is outside source diff. Candidate must be clean for final acceptance.
    source_manifest = out / 'source-manifest.json'
    write(source_manifest, {'execution_mode': 'RECORDED_REPLAY', 'snapshot': artifact(SNAPSHOT), 'source_record': artifact(HISTORY / 'SOURCE.md'), 'historical_backend': 'see original SOURCE.md; not a current backend run', 'frontend_sha': candidate})
    observations = {'profiles': [], 'execution_mode': 'SYNTHETIC_FIXTURE' if args.synthetic_wrong_source else 'RECORDED_REPLAY', 'driver': 'deterministic_runner', 'simulated_comprehension_score': None, 'human_validation': 'HUMAN_VALIDATION_PENDING'}
    with replay_server(snapshot, out, args.port) as url:
        if args.serve:
            print(url, flush=True)
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                return 0
        with sync_playwright() as p:
            executable = find_cached_chromium()
            browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            observations['browser_version'] = browser.version
            for name in ('desktop', 'mobile390', 'keyboardReduced'):
                observations['profiles'].append(record_profile(browser, url, out, name, snapshot, args.synthetic_wrong_source))
            browser.close()
    checks = check_profiles(observations, snapshot)
    write(out / 'observations.json', observations)
    evaluated_checks = [{'id': key, 'behavior_id': 'replay-source-task', 'status': value} for key, value in checks.items()]
    write(out / 'checks.json', {'trial_id': out.name, 'checks': evaluated_checks})
    code = 1 if 'FAIL' in checks.values() else 0
    evidence = [{**artifact(p), 'role': 'evaluation' if p.name == 'checks.json' else 'trace' if p.suffix == '.zip' else 'screenshot' if p.suffix == '.png' else 'record'} for p in sorted(out.rglob('*')) if p.is_file()]
    receipt = {'trial_id': out.name, 'campaign_id': args.campaign, **state, 'frontend_sha': candidate, 'execution_mode': observations['execution_mode'], 'driver': 'deterministic_runner', 'command': [sys.executable, *sys.argv], 'started_at': started, 'ended_at': now(), 'exit_code': code, 'terminal_status': 'COMPLETE' if not code and state == git_state() else 'FAILED', 'inventory_sha256': artifact(ROOT / args.inventory)['sha256'], 'instrument': artifact(__file__), 'instrument_files': [artifact(ROOT / 'scripts/qa/replay_checks.py')], 'source_manifest': artifact(source_manifest), 'result_artifacts': evidence, 'behavior_ids': ['replay-source-task'], 'checks': [{'id': key, 'behavior_id': 'replay-source-task', 'status': value, 'evidence_refs': [artifact(out / 'observations.json'), artifact(out / 'checks.json')]} for key, value in checks.items()]}
    if args.synthetic_wrong_source:
        receipt['source_manifest'] = artifact(source_manifest)
        receipt['synthetic_reason'] = 'Sandbox drawer href mutation; calibration only, not a real run'
    write(out / 'trial.json', receipt)
    print(json.dumps({'exit_code': code, 'failed': [k for k, v in checks.items() if v == 'FAIL'], 'receipt': str(out / 'trial.json')}, ensure_ascii=False))
    return code


if __name__ == '__main__':
    sys.exit(main())
