#!/usr/bin/env python3
"""主路 P0 修复真实走查（契约 docs/evals/2026-09-12-mainpath-p0.md，Evaluator 4）。

验证三条：
  A 链接抓取失败对用户可见 —— 真实微博链接 → `.gp-link-scrape-notice`（role=alert）出现且文案正确；
  B 拆题自证全丢有兜底 —— 断言 `[data-gp-claim-id]` > 0（拆题结果出现）；
  C 超时不再一锤定音 —— 等到真终态，记录总耗时与 `timeout_pending` 事件；结论是否送达用户。

成本纪律：全程只发起 1 次真实调查 + 1 次真实追问，不重跑、不重试。
复用已起的 Vite（127.0.0.1:5211，API 127.0.0.1:3000），不改任何产品代码。

产物：
  docs/reports/2026-09-12-mainpath-p0/real-*.png
  docs/reports/2026-09-12-mainpath-p0/real-run.json
  docs/reports/2026-09-12-mainpath-p0/real-timeline.json
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import Error as PWError
from playwright.sync_api import sync_playwright

PORT = 5211
BASE = f"http://127.0.0.1:{PORT}/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_ARGS = ["--disable-dev-shm-usage"]

OUT = Path("docs/reports/2026-09-12-mainpath-p0").resolve()
OUT.mkdir(parents=True, exist_ok=True)

# 与 docs/reports/2026-09-12-golden-path-walkthrough/real-notes.md 里同款的隔夜菜微博链接 + 原疑问。
CLAIM_TEXT = "https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？"
NOTICE_TEXT_ZH = "链接打不开（可能需要登录），已按你输入的文字继续"
NOTICE_TTL_S = 12.0

# 契约 C：总时限 300s + 服务端宽限 120s。预算留够，好看到真终态（晚完成也算结论送达）。
ROUND1_BUDGET_S = 470.0
ROUND2_BUDGET_S = 330.0
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
                  window.__rhg.sse.push({ t: Date.now(), type: ev.type, status: ev.status || null });
                  if (ev.type === 'complete') window.__rhg.completed = true;
                  if (ev.type === 'error') window.__rhg.errored = { t: Date.now(), code: ev.code || '', message: ev.message || '' };
                  if (ev.type === 'run_state') window.__rhg.runStatus = ev.status;
                  if (ev.type === 'investigation_snapshot' && ev.investigation) {
                    const inv = ev.investigation;
                    window.__rhg.phases.push(inv.phase);
                    window.__rhg.snapshots.push({
                      t: Date.now(),
                      phase: inv.phase,
                      claims: (inv.claims || []).length,
                      claimIds: (inv.claims || []).map((c) => c.id),
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
  return {
    mode: q('.gp-input-stage') ? 'input' : (q('.gp-canvas') ? 'canvas' : 'waiting'),
    phase: q('.gp-canvas') ? q('.gp-canvas').getAttribute('data-gp-phase') : null,
    thinking: q('[data-gp-thinking-state]') ? q('[data-gp-thinking-state]').getAttribute('data-gp-thinking-state') : null,
    claims: n('[data-gp-claim-id]'),
    claimIds: claimIds,
    evidence: n('[data-gp-evidence-key]'),
    conflicts: n('[data-gp-conflict-id]'),
    conclusionState: q('[data-gp-conclusion-region]') ? q('[data-gp-conclusion-region]').getAttribute('data-gp-conclusion-state') : null,
    heroAnswer: txt('[data-gp-direct-answer]'),
    followup: Boolean(q('.gp-followup')),
    chips: n('.gp-followup-chip'),
    followupValue: q('.gp-followup-input') ? q('.gp-followup-input').value : null,
    interrupted: Boolean(q('[data-gp-interrupted]')),
    stopped: Boolean(q('[data-gp-stopped]')),
    waitingText: txt('.gp-waiting'),
    alerts: [...document.querySelectorAll('[role="alert"], .gp-global-notice, .gp-hint--warning')].map((el) => (el.textContent || '').trim()).filter(Boolean),
    timeoutNotice: [...document.querySelectorAll('body *')]
      .filter((el) => (el.textContent || '').includes('还在查，可以离开页面'))
      .map((el) => el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().slice(0, 80))
      .slice(0, 4),
    sendDisabled: q('[data-prompt-send]') ? q('[data-prompt-send]').disabled : null,
    bodyH: document.body.scrollHeight,
  };
}
"""

NOTICE_JS = r"""
() => {
  const el = document.querySelector('.gp-link-scrape-notice');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    text: (el.textContent || '').trim(),
    role: el.getAttribute('role'),
    tag: el.tagName.toLowerCase(),
    visible: el.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0,
    inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth,
    rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right) },
    position: style.position,
    zIndex: style.zIndex,
    fontSize: style.fontSize,
    otherRoleAlerts: [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent || '').trim()).filter(Boolean),
  };
}
"""

OVERFLOW_JS = r"""
() => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (!el.getClientRects().length) continue;
      bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60), scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
  }
  return { docScrollW: document.documentElement.scrollWidth, viewW: window.innerWidth, offenders: bad.slice(0, 25) };
}
"""


class Walk:
    """0.2s 轮询界面全量签名：记里程碑 + >2s 无变化窗口。"""

    def __init__(self, page, tag: str):
        self.page = page
        self.tag = tag
        self.timeline: list[dict[str, Any]] = []
        self.blank_windows: list[dict[str, Any]] = []
        self.screenshots: list[str] = []
        self.t0 = 0.0
        self.last_sig: dict | None = None
        self.last_change_at = 0.0
        self.in_blank = False
        self.blank_start = 0.0

    def sig(self) -> dict:
        return self.page.evaluate(SIG_JS)

    def shot(self, name: str, full: bool = True) -> str:
        self.page.screenshot(path=str(OUT / name), full_page=full)
        self.screenshots.append(name)
        return name

    def poll(self, budget_s: float, stop=None, on_change=None) -> dict:
        deadline = time.time() + budget_s
        last = None
        while time.time() < deadline:
            try:
                sig = self.sig()
            except PWError:
                time.sleep(POLL_S)
                continue
            rel = time.time() - self.t0
            self.timeline.append({"t": round(rel, 2), "sig": sig})
            if last is None or sig != last:
                self.last_change_at = time.time()
                if self.in_blank:
                    self.blank_windows.append({
                        "start": round(self.blank_start - self.t0, 2),
                        "end": round(time.time() - self.t0, 2),
                        "duration": round(time.time() - self.blank_start, 2),
                        "endedBy": "ui-change",
                        "sigDuringBlank": last,
                    })
                    self.in_blank = False
                if on_change and last is not None:
                    on_change(last, sig, rel)
            else:
                if time.time() - self.last_change_at > BLANK_THRESHOLD_S and not self.in_blank:
                    self.in_blank = True
                    self.blank_start = self.last_change_at
                    self.shot(f"real-{self.tag}-friction-blank-{len(self.blank_windows) + 1}.png")
            last = sig
            if stop and stop(sig):
                return sig
            time.sleep(POLL_S)
        return last or {}

    def close_blank(self) -> None:
        if self.in_blank:
            self.blank_windows.append({
                "start": round(self.blank_start - self.t0, 2),
                "end": round(time.time() - self.t0, 2),
                "duration": round(time.time() - self.blank_start, 2),
                "endedBy": "round-end",
                "sigDuringBlank": self.last_sig,
            })
            self.in_blank = False


def stream_requests(page) -> list[dict]:
    return page.evaluate("() => (window.__rhg.net || []).filter((r) => r.isStream)")


def all_requests(page) -> list[dict]:
    return page.evaluate("() => (window.__rhg.net || [])")


def main() -> int:
    report: dict[str, Any] = {
        "base": BASE,
        "claimText": CLAIM_TEXT,
        "contract": "docs/evals/2026-09-12-mainpath-p0.md",
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "assertions": {},
    }
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
        page.wait_for_function("() => !document.body.innerText.includes('正在确认调查服务')", timeout=30000)
        page.wait_for_timeout(500)

        run = Walk(page, "round1")
        run.shot("real-00-home.png")

        # ---------- 贴链接 ----------
        page.locator("#claim-input").click()
        page.keyboard.insert_text(CLAIM_TEXT)
        page.wait_for_selector("[data-prompt-send]:not([disabled])", timeout=15000)
        page.wait_for_timeout(400)
        run.shot("real-01-input-filled.png")
        report["preSubmit"] = {
            "inputValue": page.evaluate("() => ((document.querySelector('#claim-input') || {}).innerText || '').trim()"),
            "linkChips": page.evaluate("() => [...document.querySelectorAll('.gp-link-chip')].map((e) => e.textContent.trim())"),
            "noticeBeforeSubmit": page.evaluate(NOTICE_JS),
        }

        # ---------- 提交 ----------
        streams_before = len(stream_requests(page))
        requests_before = len(all_requests(page))
        t_submit = time.time()
        run.t0 = t_submit
        run.last_change_at = t_submit
        page.locator("[data-prompt-send]").click()

        # A 断言：链接抓取失败提示。抓取解析出结果那一刻才挂提示，TTL 12s —— 高频轮询抓第一帧。
        notice: dict[str, Any] = {"samples": [], "firstSeenAt": None, "textOk": False, "roleOk": False, "visible": False}
        notice_first_shot = False
        deadline = time.time() + 25.0
        while time.time() < deadline:
            try:
                cur = page.evaluate(NOTICE_JS)
            except PWError:
                cur = None
            if cur:
                elapsed = round(time.time() - t_submit, 3)
                notice["samples"].append({"t": elapsed, **cur})
                if notice["firstSeenAt"] is None:
                    notice["firstSeenAt"] = elapsed
                    notice["textOk"] = cur["text"] == NOTICE_TEXT_ZH
                    notice["roleOk"] = cur["role"] == "alert"
                    notice["visible"] = bool(cur["visible"]) and bool(cur["inViewport"])
                    if not notice_first_shot:
                        run.shot("real-03-link-scrape-notice-1st-frame.png")
                        notice_first_shot = True
                if elapsed > 13.0:
                    break
            elif notice["firstSeenAt"] is not None:
                notice["goneAt"] = round(time.time() - t_submit, 3)
                break
            time.sleep(0.1)
        notice["ttlS"] = round(notice["goneAt"] - notice["firstSeenAt"], 2) if notice.get("goneAt") else None
        notice["persistedPast12s"] = bool(notice.get("goneAt") is None)
        run.shot("real-02-submit-state.png")
        report["linkScrapeNotice"] = notice
        report["assertions"]["A_notice_visible"] = {
            "pass": bool(notice["firstSeenAt"] is not None and notice["textOk"] and notice["roleOk"] and notice["visible"]),
            "detail": {
                "firstSeenAt": notice["firstSeenAt"],
                "textOk": notice["textOk"],
                "roleOk": notice["roleOk"],
                "visible": notice["visible"],
                "within12s": bool(notice["firstSeenAt"] is not None and notice["firstSeenAt"] <= NOTICE_TTL_S),
            },
        }

        # ---------- 等拆题（B 断言）与终态（C） ----------
        milestones: dict[str, float] = {}
        seen: set[str] = set()

        def milestone(name: str, sig: dict, rel: float, shot: str | None = None) -> None:
            if name in seen:
                return
            seen.add(name)
            milestones[name] = round(rel, 2)
            if shot:
                run.shot(shot)

        reset_seen = False
        first_claims_shot = False

        def on_change(prev: dict, sig: dict, rel: float) -> None:
            nonlocal reset_seen, first_claims_shot
            if sig["mode"] == "canvas":
                milestone("canvas", sig, rel, "real-04-canvas-first-beat.png")
            if sig["thinking"]:
                milestone("thinking", sig, rel)
            if prev.get("claims", 0) == 0 and sig["claims"] > 0:
                milestone("claims", sig, rel, "real-05-claims-decomposed.png")
                first_claims_shot = True
            if sig["evidence"] > 0:
                milestone("evidence", sig, rel, "real-06-first-evidence.png")
            if sig["conclusionState"] == "complete" and sig["heroAnswer"]:
                milestone("conclusion", sig, rel, "real-07-conclusion.png")
            if sig["timeoutNotice"]:
                milestone("timeoutNotice", sig, rel, "real-08-timeout-pending-notice.png")

        complete_since: list[float] = []

        def stop1(sig: dict) -> bool:
            if sig["interrupted"] or sig["stopped"]:
                return True
            done = sig["conclusionState"] == "complete" and bool(sig["heroAnswer"])
            if done and sig["followup"]:
                return True
            # 完成态等追问区最多 15 秒：追问区始终不出现也不能把预算耗在空等上。
            if done:
                if not complete_since:
                    complete_since.append(time.time())
                return time.time() - complete_since[0] > 15.0
            complete_since.clear()
            return False

        final1 = run.poll(ROUND1_BUDGET_S, stop1, on_change)
        run.close_blank()
        total_s = round(time.time() - t_submit, 2)
        run.shot("real-09-round1-final.png")

        report["round1"] = {
            "totalSeconds": total_s,
            "terminal": "complete" if (final1.get("conclusionState") == "complete" and final1.get("heroAnswer")) else ("interrupted" if final1.get("interrupted") else "budget-exhausted"),
            "milestones": milestones,
            "final": {k: final1.get(k) for k in ("mode", "phase", "claims", "claimIds", "evidence", "conflicts", "conclusionState", "heroAnswer", "followup", "chips", "interrupted", "stopped", "waitingText", "timeoutNotice")},
            "blankWindows": run.blank_windows,
            "phaseSeq": page.evaluate("() => window.__rhg.phases"),
            "eventTypes": page.evaluate("() => (window.__rhg.sse || []).map((e) => e.type)"),
            "timeoutPendingEvents": page.evaluate("() => (window.__rhg.sse || []).filter((e) => e.type === 'timeout_pending').map((e) => e.t)"),
            "completeEvent": page.evaluate("() => Boolean(window.__rhg.completed)"),
            "errorEvent": page.evaluate("() => window.__rhg.errored"),
            "runStatus": page.evaluate("() => window.__rhg.runStatus"),
            "snapshotDigest": page.evaluate("() => (window.__rhg.snapshots || []).slice(-8)"),
        }
        r1 = report["round1"]
        c_event = r1["timeoutPendingEvents"]
        report["assertions"]["B_claims_decomposed"] = {
            "pass": bool(milestones.get("claims") is not None and final1.get("claims", 0) > 0),
            "detail": {"claimsSeenAt": milestones.get("claims"), "finalClaims": final1.get("claims")},
        }
        report["assertions"]["C_conclusion_delivered"] = {
            "pass": bool(final1.get("conclusionState") == "complete" and (final1.get("heroAnswer") or "").strip()),
            "detail": {
                "terminal": r1["terminal"],
                "totalSeconds": total_s,
                "conclusionState": final1.get("conclusionState"),
                "heroAnswer": (final1.get("heroAnswer") or "")[:200],
                "timeoutPendingFired": bool(c_event),
                "timeoutPendingCount": len(c_event),
            },
        }

        # ---------- 追问胶囊：只填不发 ----------
        report["chips"] = page.evaluate("() => [...document.querySelectorAll('.gp-followup-chip')].map((b) => b.textContent.trim())")
        try:
            page.evaluate("() => { const el = document.querySelector('.gp-followup'); if (el) el.scrollIntoView({ block: 'center' }); }")
            page.wait_for_timeout(300)
            run.shot("real-10-followup-area.png")
        except PWError:
            pass

        chip: dict[str, Any] = {"chips": report["chips"]}
        if report["chips"]:
            s_before = len(stream_requests(page))
            a_before = len(all_requests(page))
            page.evaluate("() => { const b = document.querySelector('.gp-followup-chip'); if (b) b.click(); }")
            time.sleep(0.6)
            sig_after = run.sig()
            page.evaluate("() => { const el = document.querySelector('.gp-followup-input'); if (el) el.scrollIntoView({ block: 'center' }); }")
            run.shot("real-11-chip-filled-not-sent.png")
            chip.update({
                "clicked": report["chips"][0],
                "inputValue": sig_after["followupValue"],
                "valueMatches": sig_after["followupValue"] == report["chips"][0],
                "streamsBefore": s_before,
                "streamsAfter": len(stream_requests(page)),
                "requestsBefore": a_before,
                "requestsAfter": len(all_requests(page)),
            })
            chip["noNewRequest"] = chip["streamsAfter"] == s_before and chip["requestsAfter"] == a_before
        else:
            chip["error"] = "没有推荐追问胶囊（前置：调查完成态才有）"
        report["chipClick"] = chip

        # ---------- Enter 发起真实追问 ----------
        followup: dict[str, Any] = {"samples": []}
        if report["chips"]:
            s_before_send = len(stream_requests(page))
            base_claims = run.sig()["claims"]
            t_send = time.time()
            page.evaluate("() => { const el = document.querySelector('.gp-followup-input'); if (el) el.focus(); }")
            page.keyboard.press("Enter")
            for label, delay in (("300ms", 0.3), ("1s", 0.7)):
                time.sleep(delay)
                s = run.sig()
                followup["samples"].append({
                    "after": label,
                    "elapsed": round(time.time() - t_send, 3),
                    "mode": s["mode"],
                    "phase": s["phase"],
                    "claims": s["claims"],
                    "streams": len(stream_requests(page)),
                    "sendDisabled": s["sendDisabled"],
                    "bodyH": s["bodyH"],
                })
                run.shot(f"real-12-followup-submit-{label}.png")
            followup["streamIssued"] = len(stream_requests(page)) > s_before_send
            followup["claimsBeforeSend"] = base_claims

            run2 = Walk(page, "round2")
            run2.t0 = t_send
            run2.last_change_at = t_send
            state = {"reset": False, "claims": False}
            fu_milestones: dict[str, float] = {}

            def on_change2(prev: dict, sig: dict, rel: float) -> None:
                if sig["claims"] < base_claims or sig["claims"] == 0:
                    state["reset"] = True
                    fu_milestones.setdefault("reset", round(rel, 2))
                if state["reset"] and sig["claims"] > 0 and not state["claims"]:
                    state["claims"] = True
                    fu_milestones["claims"] = round(rel, 2)
                    run2.shot("real-13-followup-claims-decomposed.png")

            def stop2(sig: dict) -> bool:
                if state["claims"]:
                    return True
                return bool(sig["interrupted"]) or bool(sig["stopped"])

            final2 = run2.poll(ROUND2_BUDGET_S, stop2, on_change2)
            run2.close_blank()
            run2.shot("real-14-followup-final.png")
            followup["round2"] = {
                "elapsedToStop": round(time.time() - t_send, 2),
                "milestones": fu_milestones,
                "final": {k: final2.get(k) for k in ("mode", "phase", "claims", "evidence", "conclusionState", "interrupted", "stopped")},
                "blankWindows": run2.blank_windows,
                "eventTypes": page.evaluate("() => (window.__rhg.sse || []).map((e) => e.type)"),
                "snapshotDigest": page.evaluate("() => (window.__rhg.snapshots || []).slice(-4)"),
            }
            report["followupBlankWindows"] = run2.blank_windows
            report["timeline2"] = run2.timeline
        else:
            followup["skipped"] = "无胶囊可点（追问区未出现）"
        report["followupSubmit"] = followup
        report["assertions"]["D_followup_round"] = {
            "pass": bool(report["chips"] and chip.get("valueMatches") and chip.get("noNewRequest") and followup.get("streamIssued") and followup.get("round2", {}).get("milestones", {}).get("claims") is not None),
            "detail": {
                "chipFilled": chip.get("valueMatches"),
                "chipNoNewRequest": chip.get("noNewRequest"),
                "streamIssued": followup.get("streamIssued"),
                "followupClaimsAt": followup.get("round2", {}).get("milestones", {}).get("claims"),
            },
        }

        # ---------- 溢出 ----------
        try:
            report["overflow"] = page.evaluate(OVERFLOW_JS)
        except PWError as exc:
            report["overflow"] = {"error": str(exc)}

        report["net"] = page.evaluate("() => (window.__rhg.net || []).map((r) => ({ t: r.t, url: r.url, method: r.method, status: r.status, ok: r.ok, error: r.error, isStream: r.isStream, body: r.body }))")
        report["sseErrors"] = page.evaluate("() => (window.__rhg.errors || [])")
        report["console"] = console[-80:]
        report["pageErrors"] = pageerrors
        report["failedRequests"] = failed
        report["timeline1"] = run.timeline
        report["screenshots"] = run.screenshots
        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")

        ctx.close()
        browser.close()

    (OUT / "real-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "real-timeline.json").write_text(
        json.dumps({"round1": report["timeline1"], "round2": report.get("timeline2", [])}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "assertions": report["assertions"],
        "linkScrapeNotice": {k: v for k, v in report["linkScrapeNotice"].items() if k != "samples"},
        "round1": {
            "totalSeconds": report["round1"]["totalSeconds"],
            "terminal": report["round1"]["terminal"],
            "milestones": report["round1"]["milestones"],
            "blankWindows": [w["duration"] for w in report["round1"]["blankWindows"]],
            "timeoutPendingFired": bool(report["round1"]["timeoutPendingEvents"]),
            "claims": report["round1"]["final"]["claims"],
            "heroAnswer": (report["round1"]["final"]["heroAnswer"] or "")[:160],
        },
        "chipClick": report["chipClick"],
        "followupSubmit": {k: v for k, v in report["followupSubmit"].items() if k != "samples"},
        "console": console[-20:],
        "pageErrors": pageerrors,
        "sseErrors": report["sseErrors"],
        "failedRequests": failed,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
