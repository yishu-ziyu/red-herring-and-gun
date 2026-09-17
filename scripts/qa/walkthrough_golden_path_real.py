#!/usr/bin/env python3
"""Golden Path 六步真实走查（Evaluator 2/3/4）。

契约：docs/evals/2026-09-12-golden-path-smoothness.md
复用已经跑起来的 Vite :5211（不新建栈、不改任何产品代码）。

成本纪律：全程只发起 1 次真实调查 + 1 次真实追问。SSE 事件只读克隆，不重放、不重试。

产物：
  docs/reports/2026-09-12-golden-path-walkthrough/real-*.png
  docs/reports/2026-09-12-golden-path-walkthrough/real-timeline.json   （逐次采样 + 里程碑 + 摩擦）
  docs/reports/2026-09-12-golden-path-walkthrough/real-run.json        （断言、网络、SSE 摘要）
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import Error as PWError
from playwright.sync_api import sync_playwright

PORT = 5211
BASE = f"http://127.0.0.1:{PORT}/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_ARGS = ["--disable-dev-shm-usage"]

OUT = Path("docs/reports/2026-09-12-golden-path-walkthrough").resolve()
OUT.mkdir(parents=True, exist_ok=True)

# 与 docs/reports/2026-09-12-post-link-investigation-flow.html 里同款的隔夜菜微博链接 + 原疑问。
CLAIM_TEXT = "https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？"

ROUND_BUDGET_S = 330.0
POLL_S = 0.2
BLANK_THRESHOLD_S = 2.0

HOOK_JS = r"""
(() => {
  window.__rhg = { net: [], sse: [], phases: [], snapshots: [], errors: [], t0: Date.now(), completed: false, errored: null, runStatus: null };
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isStream = String(url).includes('/api/agent/orchestrate-stream');
    const rec = {
      t: Date.now(),
      url: String(url),
      method: init.method || (input && input.method) || 'GET',
      body: typeof init.body === 'string' ? init.body.slice(0, 4000) : null,
      status: null,
      ok: null,
      error: null,
      isStream: isStream,
      done: false,
    };
    if (rec.url.includes('/api/')) window.__rhg.net.push(rec);
    try {
      const res = await orig(...args);
      rec.status = res.status;
      rec.ok = res.ok;
      rec.done = true;
      if (isStream) {
        const clone = res.clone();
        (async () => {
          try {
            const reader = clone.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const ev = JSON.parse(line.slice(6));
                  window.__rhg.sse.push({ t: Date.now(), type: ev.type });
                  if (ev.type === 'complete') window.__rhg.completed = true;
                  if (ev.type === 'error') window.__rhg.errored = { t: Date.now(), message: ev.message || '' };
                  if (ev.type === 'run_state') window.__rhg.runStatus = ev.status;
                  if (ev.type === 'investigation_snapshot' && ev.investigation) {
                    const inv = ev.investigation;
                    window.__rhg.phases.push(inv.phase);
                    window.__rhg.snapshots.push({
                      t: Date.now(),
                      phase: inv.phase,
                      claims: (inv.claims || []).length,
                      claimsDone: (inv.claims || []).filter((c) => (c.evidence || []).length > 0).length,
                      evidence: (inv.claims || []).reduce((n, c) => n + ((c.evidence || []).length), 0),
                      conflicts: (inv.conflicts || []).length,
                      sources: (inv.sources || []).length,
                      hasConclusion: Boolean(inv.conclusion && (inv.conclusion.directAnswer || '').trim()),
                    });
                  }
                } catch (err) {
                  window.__rhg.errors.push('sse-parse: ' + String(err));
                }
              }
            }
          } catch (err) {
            window.__rhg.errors.push('sse-read: ' + String(err));
          }
        })();
      }
      return res;
    } catch (err) {
      rec.error = String(err);
      rec.done = true;
      window.__rhg.errors.push('fetch: ' + String(err) + ' @ ' + rec.url);
      throw err;
    }
  };
})();
"""

SIG_JS = r"""
() => {
  const q = (sel) => document.querySelector(sel);
  const n = (sel) => document.querySelectorAll(sel).length;
  const txt = (sel) => { const el = q(sel); return el ? (el.textContent || '').trim() : ''; };
  const claimIds = [...document.querySelectorAll('[data-gp-claim-id]')].map((el) => el.getAttribute('data-gp-claim-id'));
  const visibleEvidence = [...document.querySelectorAll('[data-gp-evidence-key]')]
    .filter((el) => el.getClientRects().length > 0).length;
  return {
    mode: q('.gp-input-stage') ? 'input' : (q('.gp-canvas') ? 'canvas' : 'waiting'),
    phase: q('.gp-canvas') ? q('.gp-canvas').getAttribute('data-gp-phase') : null,
    thinking: q('[data-gp-thinking-state]') ? q('[data-gp-thinking-state]').getAttribute('data-gp-thinking-state') : null,
    claims: n('[data-gp-claim-id]'),
    claimIds: claimIds,
    expandedClaims: n('.gp-claim-detail'),
    evidence: n('[data-gp-evidence-key]'),
    visibleEvidence: visibleEvidence,
    conflicts: n('[data-gp-conflict-id]'),
    conflictSides: n('[data-gp-conflict-side]'),
    activities: q('.gp-activity') ? Number(q('.gp-activity').getAttribute('data-gp-activity-count')) : 0,
    conclusionState: q('[data-gp-conclusion-region]') ? q('[data-gp-conclusion-region]').getAttribute('data-gp-conclusion-state') : null,
    heroAnswer: txt('[data-gp-direct-answer]'),
    followup: Boolean(q('.gp-followup')),
    chips: n('.gp-followup-chip'),
    followupValue: q('.gp-followup-input') ? q('.gp-followup-input').value : null,
    reverify: [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === '重新调查').length,
    interrupted: Boolean(q('[data-gp-interrupted]')),
    stopped: Boolean(q('[data-gp-stopped]')),
    waitingText: txt('.gp-waiting'),
    alerts: [...document.querySelectorAll('[role="alert"], .gp-global-notice, .gp-hint--warning')].map((el) => (el.textContent || '').trim()).filter(Boolean),
    sendDisabled: q('[data-prompt-send]') ? q('[data-prompt-send]').disabled : null,
    sendLabel: q('[data-prompt-send]') ? q('[data-prompt-send]').getAttribute('aria-label') : null,
    bodyH: document.body.scrollHeight,
    docW: document.documentElement.scrollWidth,
    viewW: window.innerWidth,
  };
}
"""

EXPAND_JS = r"""
() => {
  const out = [];
  for (const art of document.querySelectorAll('[data-gp-claim-id]')) {
    if (art.querySelector('.gp-claim-detail')) continue;
    const head = art.querySelector('.gp-claim-head');
    if (!head) continue;
    const id = art.getAttribute('data-gp-claim-id');
    head.scrollIntoView({ block: 'center' });
    head.click();
    out.push(id);
  }
  return out;
}
"""

OVERFLOW_JS = r"""
() => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      // 完成态/调查态把分组标题做成 1px 的视觉隐藏辅助文本；它的文字自然会
      // scrollWidth > 1，但不是布局溢出，也不会影响页面横向滚动。
      if (s.position === 'absolute' && el.clientWidth <= 1 && el.clientHeight <= 1 && s.overflow === 'hidden') continue;
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (!el.getClientRects().length) continue;
      bad.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        text: (el.textContent || '').trim().slice(0, 60),
      });
    }
  }
  return {
    docScrollW: document.documentElement.scrollWidth,
    viewW: window.innerWidth,
    offenders: bad.slice(0, 25),
  };
}
"""

MILESTONES = [
    ("canvas", lambda s: s["mode"] == "canvas"),
    ("thinking", lambda s: s["thinking"] is not None),
    ("claims", lambda s: s["claims"] > 0),
    ("evidence", lambda s: s["evidence"] > 0),
    ("conflict", lambda s: s["conflicts"] > 0),
    ("conclusion", lambda s: s["conclusionState"] == "complete" and bool(s["heroAnswer"])),
    ("followup", lambda s: s["followup"]),
]


class Walk:
    def __init__(self, page, tag: str):
        self.page = page
        self.tag = tag
        self.timeline: list[dict[str, Any]] = []
        self.milestones: dict[str, float] = {}
        self.blank_windows: list[dict[str, Any]] = []
        self.screenshots: list[str] = []
        self.t0 = 0.0
        self.seen: set[str] = set()
        self.last_sig: dict | None = None
        self.last_change_at = 0.0
        self.in_blank = False
        self.blank_start = 0.0

    def sig(self) -> dict:
        return self.page.evaluate(SIG_JS)

    def shot(self, name: str, full: bool = True) -> str:
        path = OUT / name
        self.page.screenshot(path=str(path), full_page=full)
        self.screenshots.append(name)
        return name

    def log(self, sig: dict, note: str = "") -> None:
        rel = round((time.time() - self.t0) * 1000) / 1000.0
        self.timeline.append({"t": rel, "tag": self.tag, "sig": sig, "note": note})

    def poll(self, budget_s: float, stop, on_milestone=None) -> dict:
        """按 0.2s 轮询，直到 stop(sig) 为真 / 预算耗尽。同时记录里程碑与 >2s 无变化窗口。"""
        deadline = time.time() + budget_s
        last = None
        while time.time() < deadline:
            try:
                sig = self.sig()
            except PWError:
                time.sleep(POLL_S)
                continue
            rel = time.time() - self.t0
            self.log(sig)
            if last is None or sig != last:
                self.last_change_at = time.time()
                if self.in_blank:
                    self.blank_windows.append({
                        "start": round(self.blank_start - self.t0, 2),
                        "end": round(rel, 2),
                        "duration": round(time.time() - self.blank_start, 2),
                        "sigDuringBlank": last,
                        "endedBy": "ui-change",
                    })
                    self.in_blank = False
            else:
                gap = time.time() - self.last_change_at
                if gap > BLANK_THRESHOLD_S and not self.in_blank:
                    self.in_blank = True
                    self.blank_start = self.last_change_at
                    self.shot(f"real-{self.tag}-friction-blank-{len(self.blank_windows) + 1}.png")
            for name, test in MILESTONES:
                if name in self.seen:
                    continue
                try:
                    hit = bool(test(sig))
                except Exception:
                    hit = False
                if hit:
                    self.seen.add(name)
                    self.milestones[name] = round(rel, 2)
                    if on_milestone:
                        on_milestone(name, sig, rel)
            last = sig
            if stop(sig):
                return sig
            time.sleep(POLL_S)
        return last or {}

    def close_blank(self) -> None:
        if self.in_blank:
            self.blank_windows.append({
                "start": round(self.blank_start - self.t0, 2),
                "end": round((time.time() - self.t0), 2),
                "duration": round(time.time() - self.blank_start, 2),
                "sigDuringBlank": self.last_sig,
                "endedBy": "round-end",
            })
            self.in_blank = False


def net_stream_requests(page) -> list[dict]:
    return page.evaluate("() => (window.__rhg.net || []).filter((r) => r.isStream)")


def main() -> int:
    report: dict[str, Any] = {"base": BASE, "claimText": CLAIM_TEXT, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
    console: list[str] = []
    pageerrors: list[str] = []
    failed: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME, args=CHROME_ARGS)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = ctx.new_page()
        page.add_init_script(HOOK_JS)
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: pageerrors.append(str(e)))
        page.on("requestfailed", lambda r: failed.append(f"{r.method} {r.url} :: {r.failure}"))

        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_selector("#claim-input", timeout=30000)
        # 服务状态确认完成前提交会被拦（copy.serviceChecking）；等它消失再贴。
        page.wait_for_function(
            "() => !document.body.innerText.includes('正在确认调查服务')",
            timeout=30000,
        )
        page.wait_for_timeout(500)

        run = Walk(page, "round1")
        run.shot("real-00-home.png")
        home_sig = run.sig()
        report["readyHints"] = page.evaluate("() => [...document.querySelectorAll('.gp-hint')].map((e) => e.className + ' | ' + e.textContent.trim())")

        # ---------- 第 1 步：贴链接 + 提交反馈 ----------
        page.locator("#claim-input").click()
        page.keyboard.insert_text(CLAIM_TEXT)
        page.wait_for_selector("[data-prompt-send]:not([disabled])", timeout=15000)
        page.wait_for_timeout(400)
        filled_sig = run.sig()
        link_chips = page.evaluate("() => [...document.querySelectorAll('.gp-link-chip')].map((e) => e.textContent.trim())")
        run.shot("real-01-input-filled.png")

        before = len(net_stream_requests(page))
        run.t0 = time.time()
        run.last_sig = home_sig
        run.last_change_at = time.time()
        page.locator("[data-prompt-send]").click()

        fb: dict[str, Any] = {"samples": []}
        t_click = time.time()
        for label, delay in (("150ms", 0.15), ("400ms", 0.25), ("1s", 0.6)):
            time.sleep(delay)
            s = run.sig()
            fb["samples"].append({
                "after": label,
                "elapsed": round(time.time() - t_click, 3),
                "sendDisabled": s["sendDisabled"],
                "sendLabel": s["sendLabel"],
                "mode": s["mode"],
                "bodyH": s["bodyH"],
            })
            if label != "1s":
                run.shot(f"real-02-submit-feedback-{label}.png")
        run.shot("real-03-submit-feedback-1s.png")
        fb["visibleChangeWithin1s"] = any(
            (sample["sendDisabled"] is True) or (sample["sendLabel"] == "正在读取链接…") or (sample["mode"] != "input")
            for sample in fb["samples"]
        )
        report["submitFeedback"] = fb
        report["linkChipsDetected"] = link_chips
        report["streamRequestsBeforeSubmit"] = before

        def on_milestone(name: str, sig: dict, rel: float) -> None:
            mapping = {
                "canvas": "real-04-canvas-first-beat.png",
                "thinking": "real-05-thinking-disclosure.png",
                "claims": "real-06-claims-decomposed.png",
                "evidence": "real-07-first-evidence.png",
            }
            if name == "evidence" and sig["expandedClaims"] == 0:
                expanded = page.evaluate(EXPAND_JS)
                page.wait_for_timeout(300)
                report.setdefault("autoExpandedClaims", []).extend(expanded)
                run.shot("real-07b-first-evidence-after-expand.png")
            if name == "conflict":
                page.evaluate("""() => { const el = document.querySelector('[data-gp-conflict-id]'); if (el) el.scrollIntoView({ block: 'center' }); }""")
                page.wait_for_timeout(300)
            if name in mapping:
                run.shot(mapping[name])

        def stop1(sig: dict) -> bool:
            if sig["followup"] and sig["conclusionState"] == "complete":
                return True
            return bool(sig["interrupted"]) or bool(sig["stopped"])

        final1 = run.poll(ROUND_BUDGET_S, stop1, on_milestone)
        run.close_blank()

        # 冲突/结论：截最新态（若里程碑截图时点不同）
        if "conflict" in run.milestones:
            page.evaluate("""() => { const el = document.querySelector('[data-gp-conflict-id]'); if (el) el.scrollIntoView({ block: 'center' }); }""")
            page.wait_for_timeout(300)
            run.shot("real-08-conflict.png")
        run.shot("real-09-conclusion.png")
        report["round1Final"] = final1
        report["round1Milestones"] = run.milestones
        report["round1BlankWindows"] = run.blank_windows
        report["round1Screenshots"] = run.screenshots
        report["round1PhaseSeq"] = page.evaluate("() => window.__rhg.phases")
        report["round1EventTypes"] = page.evaluate("() => (window.__rhg.sse || []).map((e) => e.type)")
        report["round1CompleteEvent"] = page.evaluate("() => Boolean(window.__rhg.completed)")
        report["round1ErrorEvent"] = page.evaluate("() => window.__rhg.errored")
        report["round1RunStatus"] = page.evaluate("() => window.__rhg.runStatus")
        report["round1SnapshotDigest"] = page.evaluate("() => (window.__rhg.snapshots || []).slice(-6)")
        report["round1ActivityCount"] = final1.get("activities")

        # ---------- 第 6 步：追问胶囊「只填不发」 ----------
        report["reverifyEntries"] = final1.get("reverify")
        chips = page.evaluate("() => [...document.querySelectorAll('.gp-followup-chip')].map((b) => b.textContent.trim())")
        report["chips"] = chips
        page.evaluate("""() => { const el = document.querySelector('.gp-followup'); if (el) el.scrollIntoView({ block: 'center' }); }""")
        page.wait_for_timeout(300)
        run.shot("real-10-followup-area.png", full=False)

        streams_before_chip = len(net_stream_requests(page))
        all_before_chip = page.evaluate("() => (window.__rhg.net || []).length")
        dead_click = None
        if chips:
            page.evaluate("""() => { const b = document.querySelector('.gp-followup-chip'); if (b) b.click(); }""")
            time.sleep(0.6)
            chip_sig = run.sig()
            page.evaluate("""() => { const el = document.querySelector('.gp-followup-input'); if (el) el.scrollIntoView({ block: 'center' }); }""")
            run.shot("real-11-chip-filled-not-sent.png", full=False)
            report["chipClick"] = {
                "expected": chips[0],
                "inputValue": chip_sig["followupValue"],
                "valueMatches": chip_sig["followupValue"] == chips[0],
                "focused": page.evaluate("() => document.activeElement && document.activeElement.className"),
                "streamsBefore": streams_before_chip,
                "streamsAfter": len(net_stream_requests(page)),
                "allRequestsBefore": all_before_chip,
                "allRequestsAfter": page.evaluate("() => (window.__rhg.net || []).length"),
            }
            report["chipClick"]["noNewRequest"] = (
                report["chipClick"]["streamsAfter"] == streams_before_chip
                and report["chipClick"]["allRequestsAfter"] == all_before_chip
            )
        else:
            report["chipClick"] = {"error": "没有推荐追问胶囊"}

        # ---------- 真实追问一轮 ----------
        streams_before_send = len(net_stream_requests(page))
        t_send = time.time()
        page.evaluate("""() => { const el = document.querySelector('.gp-followup-input'); if (el) { el.focus(); } }""")
        page.keyboard.press("Enter")
        fu: dict[str, Any] = {"samples": []}
        for label, delay in (("300ms", 0.3), ("1s", 0.7)):
            time.sleep(delay)
            s = run.sig()
            fu["samples"].append({
                "after": label,
                "elapsed": round(time.time() - t_send, 3),
                "mode": s["mode"],
                "streams": len(net_stream_requests(page)),
                "bodyH": s["bodyH"],
            })
            run.shot(f"real-12-followup-submit-{label}.png")
        report["followupSubmit"] = fu
        report["followupStreamIssued"] = len(net_stream_requests(page)) > streams_before_send

        run2 = Walk(page, "round2")
        run2.t0 = t_send
        run2.last_change_at = t_send

        def on_milestone2(name: str, sig: dict, rel: float) -> None:
            names = {
                "canvas": "real-13-followup-canvas.png",
                "thinking": "real-14-followup-thinking.png",
                "claims": "real-15-followup-claims.png",
                "evidence": "real-16-followup-evidence.png",
                "conclusion": "real-17-followup-conclusion.png",
            }
            if name in names:
                run2.shot(names[name])

        def stop2(sig: dict) -> bool:
            if sig["conclusionState"] == "complete" and bool(sig["heroAnswer"]) and sig["followup"]:
                return True
            return bool(sig["interrupted"]) or bool(sig["stopped"]) or sig["mode"] == "input"

        final2 = run2.poll(ROUND_BUDGET_S, stop2, on_milestone2)
        run2.close_blank()
        run2.shot("real-18-followup-final.png")

        report["round2Final"] = final2
        report["round2Milestones"] = run2.milestones
        report["round2BlankWindows"] = run2.blank_windows
        report["round2Screenshots"] = run2.screenshots
        report["round2PhaseSeq"] = page.evaluate("() => window.__rhg.phases")
        report["round2EventTypes"] = page.evaluate("() => (window.__rhg.sse || []).map((e) => e.type)")
        report["round2SnapshotDigest"] = page.evaluate("() => (window.__rhg.snapshots || []).slice(-6)")
        report["round2ActivityCount"] = final2.get("activities")
        report.setdefault("autoExpandedClaims", [])

        # ---------- 文字溢出检查 ----------
        try:
            report["overflow"] = page.evaluate(OVERFLOW_JS)
            page.evaluate("""() => { const el = document.querySelector('[data-gp-conflict-id], .gp-claims'); if (el) el.scrollIntoView({ block: 'center' }); }""")
            page.wait_for_timeout(300)
            run2.shot("real-19-overflow-check.png")
        except PWError as exc:
            report["overflow"] = {"error": str(exc)}

        report["net"] = page.evaluate("() => (window.__rhg.net || []).map((r) => ({ t: r.t, url: r.url, method: r.method, status: r.status, ok: r.ok, error: r.error, isStream: r.isStream, body: r.body }))")
        report["sseErrors"] = page.evaluate("() => (window.__rhg.errors || [])")
        report["console"] = console[-80:]
        report["pageErrors"] = pageerrors
        report["failedRequests"] = failed
        report["timeline1"] = run.timeline
        report["timeline2"] = run2.timeline
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")

        ctx.close()
        browser.close()

    (OUT / "real-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "real-timeline.json").write_text(
        json.dumps({"round1": report["timeline1"], "round2": report["timeline2"]}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "round1Milestones": report["round1Milestones"],
        "round1BlankWindows": report["round1BlankWindows"],
        "round2Milestones": report["round2Milestones"],
        "round2BlankWindows": report["round2BlankWindows"],
        "submitFeedback": report["submitFeedback"],
        "chipClick": report.get("chipClick"),
        "followupStreamIssued": report["followupStreamIssued"],
        "round1Final": {k: report["round1Final"].get(k) for k in ("phase", "claims", "evidence", "conflicts", "activities", "conclusionState", "heroAnswer", "reverify")},
        "round2Final": {k: report["round2Final"].get(k) for k in ("phase", "claims", "evidence", "conflicts", "activities", "conclusionState", "heroAnswer", "reverify")},
        "overflow": report.get("overflow"),
        "pageErrors": pageerrors,
        "sseErrors": report["sseErrors"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
