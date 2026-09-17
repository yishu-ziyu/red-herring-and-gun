#!/usr/bin/env python3
"""Verify a frozen app build. Requires explicit --live; exactly one run + one follow-up.

Browser plugin is not available in this workflow; use the installed Python Playwright
and local Chrome. No dependencies are installed and no API request is replayed.
Save private test artifacts outside the repository with --out /tmp/...
"""
from __future__ import annotations

import argparse
import base64
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

CLAIM = "https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PUBLIC_HOOK = r"""
(() => {
  window.__runtimeQA = {snapshot: null, generation: 0, states: [], errors: []};
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const isRun = String(args[0]).includes('/api/agent/orchestrate-stream');
    if (isRun) { window.__runtimeQA.generation++; window.__runtimeQA.snapshot = null; }
    const generation = window.__runtimeQA.generation;
    const response = await original(...args);
    if (isRun && response.ok && response.body) {
      const reader = response.clone().body.getReader();
      (async () => {
        let buffer = ''; const decoder = new TextDecoder();
        try {
          while (true) {
            const {value, done} = await reader.read(); if (done) break;
            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n'); buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const event = JSON.parse(line.slice(5));
              if (event.type === 'investigation_snapshot' && generation === window.__runtimeQA.generation) window.__runtimeQA.snapshot = event.investigation;
              if (event.type === 'run_state') window.__runtimeQA.states.push(event.status);
              if (event.type === 'error') window.__runtimeQA.errors.push(event.message);
            }
          }
        } catch (error) { window.__runtimeQA.errors.push(String(error)); }
        finally { reader.releaseLock(); }
      })();
    }
    return response;
  };
})();
"""

STATE = r"""() => {
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  return {
    snapshotPhase: window.__runtimeQA?.snapshot?.phase,
    generation: window.__runtimeQA?.generation,
    phase: document.querySelector('.gp-canvas')?.getAttribute('data-gp-phase') || 'input',
    claims: document.querySelectorAll('[data-gp-claim-id]').length,
    evidence: [...document.querySelectorAll('[data-gp-evidence-key]')].filter(visible).length,
    answer: document.querySelector('[data-gp-direct-answer]')?.textContent?.trim() || '',
    notices: [...document.querySelectorAll('[role="alert"]')].filter(visible).map(e=>e.textContent.trim()),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    overlay: !!document.querySelector('vite-error-overlay'),
  };
}"""


def verify_browser_stop(browser, base: str, output: Path) -> dict:
    """Use a local hanging BYO endpoint: no external model call for the stop test."""
    received = threading.Event()
    disconnected = threading.Event()
    calls = []

    class HangingModel(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            calls.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"choices":[')
            self.wfile.flush()
            received.set()
            self.connection.settimeout(10)
            try:
                if not self.connection.recv(1):
                    disconnected.set()
            except socket.timeout:
                pass
            except (ConnectionError, OSError):
                disconnected.set()

    server = ThreadingHTTPServer(("127.0.0.1", 0), HangingModel)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="zh-CN")
    page = None
    try:
        value = base64.b64encode(json.dumps({
            "baseUrl": f"http://127.0.0.1:{server.server_port}/v1",
            "apiKey": "local-test-only", "modelName": "hanging-test-only",
        }).encode()).decode()
        ctx.add_init_script(f"localStorage.setItem('gun-byo-key', {json.dumps(value)});")
        page = ctx.new_page()
        page.goto(base, wait_until="domcontentloaded")
        page.locator("#claim-input").fill("演示材料是否有可靠出处？")
        page.locator("[data-prompt-send]:not([disabled])").wait_for(timeout=30000)
        page.locator("[data-prompt-send]").click()
        assert received.wait(15), "Local BYO request did not start"
        page.locator("[data-gp-stop]").wait_for(state="visible", timeout=5000)
        started = time.monotonic()
        page.locator("[data-gp-stop]").click()
        page.locator('[data-gp-stop-state="stopped"]').wait_for(state="visible", timeout=5000)
        assert disconnected.wait(2), "Browser stopped but upstream socket stayed open"
        elapsed = round(time.monotonic() - started, 3)
        assert len(calls) == 1, "Cancel triggered a model retry"
        page.screenshot(path=str(output / "stopped-mobile.png"), full_page=True)
        return {"passed": True, "stopSeconds": elapsed, "modelCalls": len(calls), "upstreamClosed": True, "localModelOnly": True}
    except Exception:
        if page is not None:
            (output / "stop-failure.json").write_text(json.dumps({
                "body": page.locator("body").inner_text(),
                "stops": page.locator("[data-gp-stop-state]").evaluate_all("nodes => nodes.map(n => n.getAttribute('data-gp-stop-state'))"),
                "upstreamClosed": disconnected.is_set(), "modelCalls": len(calls),
            }, ensure_ascii=False, indent=2))
            page.screenshot(path=str(output / "stop-failure.png"), full_page=True)
        raise
    finally:
        ctx.close()
        server.shutdown()
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--stop-only", action="store_true", help="Only exercise the local hanging BYO cancellation path")
    args = parser.parse_args()
    if not args.live and not args.stop_only:
        parser.error("--live is required: this uses one real investigation and one follow-up")
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"base": args.base, "browser": "Playwright/local Chrome", "rounds": [], "pageErrors": [], "passed": False}
    requests: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME)
        if args.stop_only:
            try:
                result = verify_browser_stop(browser, args.base, output)
                (output / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
                print(json.dumps(result, ensure_ascii=False), flush=True)
                return 0
            finally:
                browser.close()
        context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = context.new_page()
        page.add_init_script(PUBLIC_HOOK)
        page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
        page.on("request", lambda req: requests.append(req.url) if req.method == "POST" and "/api/agent/orchestrate-stream" in req.url else None)
        try:
            page.goto(args.base, wait_until="domcontentloaded")
            page.locator("#claim-input").fill(CLAIM)
            page.locator("[data-prompt-send]:not([disabled])").wait_for(timeout=30000)
            report["title"] = page.title()
            assert report["title"] and page.locator(".gp-input-stage").is_visible()
            page.screenshot(path=str(output / "home.png"))
            for index in range(2):
                before = len(requests)
                start = time.monotonic()
                if index == 0:
                    page.locator("[data-prompt-send]").click()
                else:
                    chips = page.locator(".gp-followup-chip")
                    labels = chips.all_text_contents()
                    report["suggestions"] = labels
                    assert not any('「真的假的」' in text for text in labels), labels
                    if chips.count():
                        chips.first.click()
                        page.wait_for_timeout(300)
                        assert len(requests) == before, "Clicking a suggestion submitted without confirmation"
                        assert page.locator(".gp-followup-input").input_value().strip()
                    else:
                        page.locator(".gp-followup-input").fill("关于直接致癌的判断，现有证据还缺什么？")
                    page.locator(".gp-followup-input").press("Enter")
                entry = {"milestones": {}, "timeline": []}
                report["rounds"].append(entry)
                last = None
                while time.monotonic() - start < 550:
                    state = page.evaluate(STATE)
                    if state["generation"] != index + 1 or not state.get("snapshotPhase"):
                        page.wait_for_timeout(100)
                        continue
                    elapsed = round(time.monotonic() - start, 2)
                    if state != last:
                        entry["timeline"].append({"seconds": elapsed, **state})
                        last = state
                    for name, present in [("claims", state["claims"]), ("evidence", state["evidence"]), ("answer", state["answer"])]:
                        if present and name not in entry["milestones"]:
                            entry["milestones"][name] = elapsed
                            print(f"round {index+1} {name}: {elapsed}s", flush=True)
                    assert not state["overlay"], "Framework error overlay"
                    assert state["phase"] != "interrupted", state
                    if state["phase"] == "complete" and state["snapshotPhase"] == "complete" and state["answer"]:
                        break
                    page.wait_for_timeout(300)
                else:
                    raise AssertionError("Investigation did not finish within the bounded QA budget")
                page.wait_for_timeout(350)
                entry["snapshot"] = page.evaluate("window.__runtimeQA.snapshot")
                entry["final"] = page.evaluate(STATE)
                assert len(requests) == before + 1, "Duplicate investigation POST"
                assert not entry["final"]["overflow"], "Page overflows horizontally"
                assert not entry["final"]["answer"].startswith("流传说法是"), entry["final"]["answer"]
                notices = [text for text in entry["final"]["notices"] if "链接打不开" in text]
                assert len(notices) <= 1, notices
                page.screenshot(path=str(output / f"round-{index+1}.png"), full_page=True)
                # Real source drawer opens from the current investigation, not a fixture.
                pill = page.locator(".gp-claims .gp-source-pill").first
                if pill.count():
                    pill.click()
                    page.locator(".gp-drawer--source").wait_for(state="visible")
                    entry["drawerUrl"] = page.locator(".gp-source-open").get_attribute("href")
                    assert entry["drawerUrl"] in [source["url"] for source in entry["snapshot"]["sources"]]
                    page.locator("[data-gp-source-close]").click()
                print(f"round {index+1} complete; POST count={len(requests)}", flush=True)
            assert not report["pageErrors"], report["pageErrors"]
            report["stream"] = page.evaluate("({states: window.__runtimeQA.states, errors: window.__runtimeQA.errors})")
            assert not report["stream"]["errors"], report["stream"]
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(350)
            report["mobile"] = page.evaluate(STATE)
            assert not report["mobile"]["overflow"], "Mobile viewport overflows"
            page.screenshot(path=str(output / "mobile.png"), full_page=True)
            report["browserStop"] = verify_browser_stop(browser, args.base, output)
            report["passed"] = True
        except Exception as error:
            report["failure"] = str(error)
            try:
                report["lastState"] = page.evaluate(STATE)
                page.screenshot(path=str(output / "failure.png"), full_page=True)
            except Exception:
                pass
        finally:
            report["investigationPosts"] = len(requests)
            (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()
    print(json.dumps({"passed": report["passed"], "failure": report.get("failure"), "posts": len(requests), "report": str(output / "report.json")}, ensure_ascii=False), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
