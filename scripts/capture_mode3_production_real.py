#!/usr/bin/env python3
"""Issue #66 production integration capture.

REAL SSE: user input → orchestrate-stream → investigation_snapshot
received → decomposed → investigating → judging → complete.

Port 5186 is reserved. Do not reuse 5180–5184 (fixture capture ports).

Every screenshot/video/snapshot is tagged REAL SSE or DETERMINISTIC FIXTURE.
Fixture output is never a substitute for the live stream.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

CLAIM = "维生素C能治感冒，而且每次感冒都应当输液。"
PORT = 5186
API_PORT = 3000
BASE_URL = f"http://127.0.0.1:{PORT}"
API_URL = f"http://127.0.0.1:{API_PORT}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = Path("docs/design/2026-09-06-mode3-production/final").resolve()
REAL = OUT / "real"
SNAP_DIR = REAL / "snapshots"
MOTION = REAL / "motion"
FRAMES = MOTION / "frames"
REDUCED_FRAMES = MOTION / "frames-reduced"
SOURCE_LOG = OUT / "SOURCE.md"
REPORT = REAL / "run-report.json"
CHROME_ARGS = ["--disable-dev-shm-usage"]
SSE_WAIT_MS = 210_000

SSE_HOOK = r"""
(() => {
  const orig = window.fetch.bind(window);
  window.__rhgSse = { events: [], phases: [], error: null, started: false };
  window.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const res = await orig(...args);
    if (String(url).includes('/api/agent/orchestrate-stream')) {
      window.__rhgSse.started = true;
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
                window.__rhgSse.events.push(ev);
                if (ev.type === 'investigation_snapshot' && ev.investigation && ev.investigation.phase) {
                  window.__rhgSse.phases.push(ev.investigation.phase);
                }
              } catch (err) {
                window.__rhgSse.error = String(err);
              }
            }
          }
        } catch (err) {
          window.__rhgSse.error = String(err);
        }
      })();
    }
    return res;
  };
})();
"""

PIN_JS = r"""
() => {
  const pick = (sel) => document.querySelector(sel);
  window.__gpPin = {
    canvas: pick('.gp-canvas'),
    region: pick('[data-gp-conclusion-region]'),
    original: pick('.gp-original'),
    originalText: pick('.gp-original-text'),
    claims: pick('.gp-claim-list'),
    board: pick('.gp-evidence-board'),
    dialog: pick('[role="dialog"]'),
    evidence: {},
  };
  for (const el of document.querySelectorAll('[data-gp-evidence-key]')) {
    window.__gpPin.evidence[el.getAttribute('data-gp-evidence-key')] = el;
  }
  return {
    phase: pick('.gp-canvas') && pick('.gp-canvas').getAttribute('data-gp-phase'),
    region: Boolean(window.__gpPin.region),
    evidenceKeys: Object.keys(window.__gpPin.evidence),
  };
}
"""

SAME_JS = r"""
() => {
  const pin = window.__gpPin || {};
  const same = (a, b) => Boolean(a) && a === b;
  const evidence = {};
  for (const [key, node] of Object.entries(pin.evidence || {})) {
    const now = document.querySelector('[data-gp-evidence-key="' + key + '"]');
    evidence[key] = {
      same: same(node, now),
      present: Boolean(now),
      role: now && now.getAttribute('data-gp-role'),
      identity: now && now.getAttribute('data-gp-identity'),
    };
  }
  return {
    canvas: same(pin.canvas, document.querySelector('.gp-canvas')),
    region: same(pin.region, document.querySelector('[data-gp-conclusion-region]')),
    original: same(pin.original, document.querySelector('.gp-original')),
    originalText: same(pin.originalText, document.querySelector('.gp-original-text')),
    claims: same(pin.claims, document.querySelector('.gp-claim-list')),
    board: !pin.board || same(pin.board, document.querySelector('.gp-evidence-board')),
    dialog: !pin.dialog || same(pin.dialog, document.querySelector('[role="dialog"]')),
    evidence,
    phase: document.querySelector('.gp-canvas') && document.querySelector('.gp-canvas').getAttribute('data-gp-phase'),
    conclusionState: document.querySelector('[data-gp-conclusion-region]') && document.querySelector('[data-gp-conclusion-region]').getAttribute('data-gp-conclusion-state'),
    hasDirectAnswer: Boolean(document.querySelector('[data-gp-direct-answer]')),
    activeTag: document.activeElement && document.activeElement.tagName,
    activeRole: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-gp-role'),
    activeKey: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-gp-evidence-key'),
    scrollY: window.scrollY,
  };
}
"""


def port_open(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ok = sock.connect_ex(("127.0.0.1", port)) == 0
    sock.close()
    return ok


def wait_port(port: int, timeout: float = 40) -> None:
    start = time.time()
    while time.time() - start < timeout:
        if port_open(port):
            return
        time.sleep(0.25)
    raise RuntimeError(f"port {port} did not open")


def start_stack_if_needed():
    api_up = port_open(API_PORT)
    web_up = port_open(PORT)
    if api_up and web_up:
        print(f"Reusing API :{API_PORT} and Vite :{PORT}")
        return None
    print(f"Starting mvp npm run dev -- --port {PORT}")
    log_path = Path.home() / ".grok" / "long-running-background-tasks"
    log_path.mkdir(parents=True, exist_ok=True)
    log_file = open(log_path / "mvp-dev-5186.log", "ab")
    proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(PORT)],
        cwd=os.path.abspath("mvp"),
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    wait_port(API_PORT, 40)
    wait_port(PORT, 40)
    time.sleep(0.6)
    return proc


def grayscale(src: Path, dest: Path) -> None:
    Image.open(src).convert("L").save(dest)
    print(f"Saved grayscale: {dest}")


def save_gif(paths: list[Path], dest: Path, duration_ms: int = 90) -> None:
    images = [Image.open(p).convert("RGB") for p in paths if p.exists()]
    if not images:
        return
    images[0].save(dest, save_all=True, append_images=images[1:], duration=duration_ms, loop=0)
    print(f"Saved gif: {dest}")


def js_click(page, selector: str) -> None:
    page.wait_for_selector(selector, state="attached", timeout=15000)
    page.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error('missing ' + sel);
          el.scrollIntoView({ block: 'center' });
          el.click();
        }""",
        selector,
    )


def redact_snapshot(inv: dict) -> dict:
    """Keep product fields. Drop nothing from the contract; sources keep title/url/domain."""
    if not isinstance(inv, dict):
        return inv
    out = json.loads(json.dumps(inv))
    return out


def dump_events(page) -> dict:
    return page.evaluate("() => window.__rhgSse || { events: [], phases: [], error: 'missing hook' }")


def snapshots_from_events(events: list) -> list[dict]:
    snaps = []
    for ev in events:
        if ev.get("type") == "investigation_snapshot" and isinstance(ev.get("investigation"), dict):
            snaps.append(redact_snapshot(ev["investigation"]))
    return snaps


def write_snapshots(snaps: list[dict]) -> dict[str, Path]:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    seen = set()
    for i, snap in enumerate(snaps, start=1):
        phase = snap.get("phase") or "unknown"
        key = phase if phase not in seen else f"{phase}-{i}"
        seen.add(phase)
        path = SNAP_DIR / f"{i:02d}-{key}.json"
        path.write_text(json.dumps(snap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written[key] = path
        print(f"Saved REAL snapshot {path.name} phase={phase}")
    (SNAP_DIR / "all-phases.json").write_text(
        json.dumps([{"phase": s.get("phase"), "claims": len(s.get("claims") or []), "sources": len(s.get("sources") or [])} for s in snaps], ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return written


def evidence_roles(snap: dict) -> list[dict]:
    rows = []
    for claim in snap.get("claims") or []:
        for link in claim.get("evidence") or []:
            rows.append(
                {
                    "claimId": claim.get("id"),
                    "sourceId": link.get("sourceId"),
                    "role": link.get("role"),
                    "finding": bool(link.get("finding")),
                    "limitation": bool(link.get("limitation")),
                }
            )
    return rows


def find_role_transition(snaps: list[dict]) -> dict | None:
    prev: dict[tuple[str, str], str] = {}
    for snap in snaps:
        for row in evidence_roles(snap):
            key = (row["claimId"], row["sourceId"])
            role = row["role"]
            if key in prev and prev[key] == "unassessed" and role in ("support", "contradict", "context-only"):
                return {
                    "claimId": row["claimId"],
                    "sourceId": row["sourceId"],
                    "from": prev[key],
                    "to": role,
                    "atPhase": snap.get("phase"),
                }
            prev[key] = role
    return None


def span_audit(snap: dict) -> list[dict]:
    original = snap.get("originalClaim") or ""
    rows = []
    for claim in snap.get("claims") or []:
        span = claim.get("originalSpan")
        item = {
            "id": claim.get("id"),
            "text": claim.get("text"),
            "span": span,
            "status": "no-trace",
        }
        if isinstance(span, dict) and isinstance(span.get("start"), int) and isinstance(span.get("end"), int):
            start, end = span["start"], span["end"]
            if 0 <= start < end <= len(original):
                sliced = original[start:end]
                item["slice"] = sliced
                item["status"] = "exact" if sliced == claim.get("text") else "mismatch"
            else:
                item["status"] = "invalid-span"
        rows.append(item)
    return rows


def screenshot(page, name: str, source: str) -> Path:
    dest = OUT / name
    page.screenshot(path=str(dest), full_page=True)
    print(f"Saved {source}: {dest.name}")
    return dest


def fill_and_submit(page) -> None:
    page.wait_for_selector("#claim-input", timeout=20000)
    page.wait_for_function(
        """() => !document.body.innerText.includes('正在确认调查服务')""",
        timeout=20000,
    )
    page.locator("#claim-input").click()
    page.keyboard.insert_text(CLAIM)
    page.wait_for_function(
        """() => {
          const btn = document.querySelector('[data-prompt-send]');
          const el = document.querySelector('#claim-input');
          return btn && !btn.disabled && (el && (el.textContent || '').trim().length > 0);
        }""",
        timeout=15000,
    )
    js_click(page, "[data-prompt-send]")
    page.wait_for_timeout(400)
    redo = page.locator('button', has_text="重新核查")
    if redo.count() > 0:
        redo.first.click()
        print("Clicked 重新核查 (same-claim guard)")


def wait_phase(page, phase: str, timeout_ms: int) -> None:
    page.wait_for_function(
        """(p) => {
          const el = document.querySelector('.gp-canvas');
          return el && el.getAttribute('data-gp-phase') === p;
        }""",
        arg=phase,
        timeout=timeout_ms,
    )


def capture_fixture_conflict(browser) -> None:
    """Labeled DETERMINISTIC FIXTURE fallback for conflict/gap visual if the real run has none."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.goto(f"{BASE_URL}/?fixture=conflict", wait_until="domcontentloaded")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_selector("[data-gp-conflict-id], .gp-conflict, [data-gp-gap]", timeout=15000)
    page.wait_for_timeout(300)
    screenshot(page, "desktop-conflict-gap.png", "DETERMINISTIC FIXTURE")
    ctx.close()


def keyboard_walk(page) -> dict:
    notes = {"steps": [], "ok": True, "errors": []}
    page.keyboard.press("Escape")
    page.wait_for_timeout(120)
    claim = page.query_selector("[data-gp-claim-id] .gp-claim-head")
    evidence = page.query_selector("[data-gp-evidence-key]")
    if not claim or not evidence:
        notes["ok"] = False
        notes["errors"].append("missing claim head or evidence")
        return notes

    page.evaluate("() => document.querySelector('[data-gp-claim-id] .gp-claim-head')?.focus()")
    notes["steps"].append({"focus": "claim-head", "active": page.evaluate("() => document.activeElement?.className")})
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('[data-gp-evidence-key]')?.focus()")
    focused_key = page.evaluate("() => document.activeElement?.getAttribute('data-gp-evidence-key')")
    notes["steps"].append({"focus": "evidence", "key": focused_key})
    page.keyboard.press("Enter")
    page.wait_for_selector("[role='dialog']", timeout=8000)
    dialog = page.query_selector("[role='dialog']")
    notes["steps"].append({"drawer": True, "resolve": dialog.get_attribute("data-gp-source-resolve") if dialog else None})

    page.keyboard.press("Tab")
    inside_1 = page.evaluate("() => Boolean(document.activeElement?.closest('[role=dialog]'))")
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    inside_2 = page.evaluate("() => Boolean(document.activeElement?.closest('[role=dialog]'))")
    if not inside_1 or not inside_2:
        notes["ok"] = False
        notes["errors"].append(f"tab trap failed inside1={inside_1} inside2={inside_2}")
    notes["steps"].append({"tabTrap": {"afterTab": inside_1, "afterShiftTab": inside_2}})

    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    still = page.query_selector("[role='dialog']")
    returned = page.evaluate("() => document.activeElement?.getAttribute('data-gp-evidence-key')")
    if still:
        notes["ok"] = False
        notes["errors"].append("Escape did not close drawer")
    notes["steps"].append({"escapeClosed": still is None, "focusReturnKey": returned})
    if focused_key and returned != focused_key:
        notes["ok"] = False
        notes["errors"].append(f"focus return expected {focused_key} got {returned}")
    return notes


def editorial_audit(page) -> dict:
    return page.evaluate(
        """() => {
          const answer = document.querySelector('[data-gp-direct-answer]');
          const hero = document.querySelector('.gp-hero');
          const canvas = document.querySelector('.gp-canvas');
          const rows = [...document.querySelectorAll('[data-gp-evidence-key]')].map((el) => {
            const cs = getComputedStyle(el);
            return {
              role: el.getAttribute('data-gp-role'),
              bg: cs.backgroundColor,
              radius: cs.borderRadius,
              shadow: cs.boxShadow,
            };
          });
          const acs = answer ? getComputedStyle(answer) : null;
          const hcs = hero ? getComputedStyle(hero) : null;
          const rainbow = rows.filter((r) => {
            const m = r.bg && r.bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
            if (!m) return false;
            const [r0,g0,b0] = m.slice(1).map(Number);
            const chroma = Math.max(r0,g0,b0) - Math.min(r0,g0,b0);
            return chroma > 18 && (r0+g0+b0)/3 < 245;
          });
          return {
            hasAnswer: Boolean(answer),
            answerSize: acs && parseFloat(acs.fontSize),
            heroBg: hcs && hcs.backgroundColor,
            heroShadow: hcs && hcs.boxShadow,
            heroRadius: hcs && hcs.borderRadius,
            canvasBg: canvas && getComputedStyle(canvas).backgroundColor,
            rainbowRows: rainbow,
            rowCount: rows.length,
          };
        }"""
    )


def run_real(browser) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    REAL.mkdir(parents=True, exist_ok=True)
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    MOTION.mkdir(parents=True, exist_ok=True)
    FRAMES.mkdir(parents=True, exist_ok=True)

    video_dir = MOTION / "playwright-video"
    if video_dir.exists():
        shutil.rmtree(video_dir)
    video_dir.mkdir(parents=True, exist_ok=True)

    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        record_video_dir=str(video_dir),
        record_video_size={"width": 1440, "height": 900},
        reduced_motion="no-preference",
    )
    page = ctx.new_page()
    page.add_init_script(SSE_HOOK)

    page.goto(BASE_URL + "/", wait_until="domcontentloaded")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_selector("#claim-input", timeout=20000)
    page.wait_for_timeout(400)
    screenshot(page, "desktop-input.png", "REAL SSE")

    fill_and_submit(page)
    page.wait_for_selector(".gp-canvas", timeout=30000)

    seen_phases: list[str] = []
    pin_after_claims = False
    transition_dom = None
    conclusion_before = None
    scroll_before_complete = None
    last_roles: dict[str, str] = {}
    role_change_frames: list[Path] = []
    start = time.time()
    deadline = start + SSE_WAIT_MS / 1000

    while time.time() < deadline:
        phase = page.evaluate("() => document.querySelector('.gp-canvas')?.getAttribute('data-gp-phase') || ''")
        if phase and (not seen_phases or seen_phases[-1] != phase):
            seen_phases.append(phase)
            print(f"DOM phase → {phase} t={time.time()-start:.1f}s")
            if phase == "decomposed":
                page.wait_for_timeout(180)
                screenshot(page, "desktop-real-decomposed.png", "REAL SSE")
            if phase == "investigating":
                page.wait_for_selector("[data-gp-claim-id]", timeout=20000)
                page.wait_for_timeout(250)
                screenshot(page, "desktop-real-investigating.png", "REAL SSE")
                page.set_viewport_size({"width": 390, "height": 844})
                page.wait_for_timeout(200)
                screenshot(page, "mobile-real-investigating.png", "REAL SSE")
                page.set_viewport_size({"width": 1440, "height": 900})
                page.wait_for_timeout(150)
                pin = page.evaluate(PIN_JS)
                print("pinned", pin)
                pin_after_claims = True
                scroll_before_complete = page.evaluate("() => window.scrollY")
            if phase == "judging":
                screenshot(page, "desktop-real-judging.png", "REAL SSE")
            if phase == "complete":
                break

        if pin_after_claims:
            same = page.evaluate(SAME_JS)
            for key, info in (same.get("evidence") or {}).items():
                role = info.get("role")
                if key in last_roles and last_roles[key] != role and last_roles[key] == "unassessed":
                    path = FRAMES / f"settling-{key.replace(':', '_')}-{last_roles[key]}-to-{role}.png"
                    page.screenshot(path=str(path), full_page=False)
                    role_change_frames.append(path)
                    print(f"REAL settling frame {path.name} same={info.get('same')} identity={info.get('identity')}")
                    if transition_dom is None:
                        transition_dom = {"key": key, **info, "from": last_roles[key]}
                if role:
                    last_roles[key] = role
        page.wait_for_timeout(180)

    try:
        wait_phase(page, "complete", 15_000)
    except PlaywrightTimeout:
        print("WARN: complete phase not reached within extra wait")

    sse = dump_events(page)
    snaps = snapshots_from_events(sse.get("events") or [])
    write_snapshots(snaps)
    (SNAP_DIR / "sse-phases.json").write_text(json.dumps(sse.get("phases") or [], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (SNAP_DIR / "sse-event-types.json").write_text(
        json.dumps([e.get("type") for e in (sse.get("events") or [])], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    complete_snap = next((s for s in reversed(snaps) if s.get("phase") == "complete"), snaps[-1] if snaps else None)
    if complete_snap:
        (SNAP_DIR / "complete.json").write_text(json.dumps(complete_snap, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    page.wait_for_timeout(500)
    same_after = page.evaluate(SAME_JS) if pin_after_claims else {}
    screenshot(page, "desktop-real-complete.png", "REAL SSE")
    grayscale(OUT / "desktop-real-complete.png", OUT / "desktop-complete-grayscale.png")

    has_conflict = bool(page.query_selector("[data-gp-conflict-id], .gp-conflict"))
    has_gap = bool(page.query_selector("[data-gp-gap], .gp-gap, .gp-gaps"))
    conflict_source = None
    if has_conflict or has_gap:
        screenshot(page, "desktop-conflict-gap.png", "REAL SSE")
        conflict_source = "REAL SSE"
    else:
        conflict_source = "DETERMINISTIC FIXTURE (real run had no conflict/gap)"

    # Claim Trace on real complete
    trace = span_audit(complete_snap or {})
    trace_marks = page.evaluate(
        """() => [...document.querySelectorAll('mark.gp-trace-mark')].map((m) => ({
          text: m.textContent,
          claim: m.getAttribute('data-gp-claim-id') || m.closest('[data-claim]')?.getAttribute('data-gp-claim-id')
        }))"""
    )

    hover_trace = None
    first_claim = page.query_selector("[data-gp-claim-id]")
    if first_claim:
        cid = first_claim.get_attribute("data-gp-claim-id")
        page.hover(f'[data-gp-claim-id="{cid}"] .gp-claim-head')
        page.wait_for_timeout(160)
        hover_trace = page.evaluate(
            """() => {
              const marks = [...document.querySelectorAll('mark.gp-trace-mark')];
              const traced = document.querySelector('.gp-original-text')?.getAttribute('data-gp-traced-claim');
              return { traced, markCount: marks.length, markText: marks.map((m) => m.textContent) };
            }"""
        )
        screenshot(page, "desktop-real-claim-trace-hover.png", "REAL SSE")

    # Source Drawer from first real evidence
    drawer_notes = {}
    first_ev = page.query_selector("[data-gp-evidence-key]")
    if first_ev:
        key = first_ev.get_attribute("data-gp-evidence-key")
        js_click(page, f'[data-gp-evidence-key="{key}"]')
        page.wait_for_selector("[role='dialog']", timeout=8000)
        drawer_notes = page.evaluate(
            """() => {
              const d = document.querySelector('[role=dialog]');
              const sections = [...document.querySelectorAll('[data-gp-source-section]')].map((s) => s.getAttribute('data-gp-source-section'));
              return {
                open: Boolean(d),
                resolve: d && d.getAttribute('data-gp-source-resolve'),
                claim: d && d.getAttribute('data-gp-claim-id'),
                source: d && d.getAttribute('data-gp-source-id'),
                role: d && d.getAttribute('data-gp-role'),
                sections,
                hasExcerpt: Boolean(document.querySelector('[data-gp-source-section="excerpt"]')),
                hasFinding: Boolean(document.querySelector('[data-gp-source-section="finding"]')),
                hasLimitation: Boolean(document.querySelector('[data-gp-source-section="limitation"]')),
              };
            }"""
        )
        screenshot(page, "desktop-source-drawer.png", "REAL SSE")
        grayscale(OUT / "desktop-source-drawer.png", OUT / "desktop-source-drawer-grayscale.png")
        page.evaluate(PIN_JS)
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

    kb = keyboard_walk(page)
    (REAL / "keyboard.json").write_text(json.dumps(kb, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    edit = editorial_audit(page)
    (REAL / "editorial-audit.json").write_text(json.dumps(edit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Reduced motion of the REAL complete page (restored visual, not a second live stream)
    page.emulate_media(reduced_motion="reduce")
    page.wait_for_timeout(200)
    screenshot(page, "desktop-reduced-motion-complete.png", "REAL SSE complete + emulated reduced-motion (not a second live stream)")

    mobile = browser.new_context(viewport={"width": 390, "height": 844})
    mpage = mobile.new_page()
    mpage.add_init_script(SSE_HOOK)
    mpage.goto(BASE_URL + "/", wait_until="domcontentloaded")
    mpage.set_viewport_size({"width": 390, "height": 844})
    mpage.wait_for_selector("#claim-input", timeout=20000)
    screenshot(mpage, "mobile-input.png", "REAL SSE")
    mobile.close()

    # Mobile of the completed investigation: reuse history if the canvas is still up by resizing
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(300)
    screenshot(page, "mobile-real-complete.png", "REAL SSE (resized from completed desktop session)")
    grayscale(OUT / "mobile-real-complete.png", OUT / "mobile-complete-grayscale.png")
    if page.query_selector("[data-gp-evidence-key]"):
        js_click(page, "[data-gp-evidence-key]")
        page.wait_for_selector("[role='dialog']", timeout=8000)
        screenshot(page, "mobile-source-sheet.png", "REAL SSE")
        grayscale(OUT / "mobile-source-sheet.png", OUT / "mobile-source-sheet-grayscale.png")
        page.keyboard.press("Escape")

    video_path = None
    try:
        video_path = page.video.path() if page.video else None
    except Exception:
        video_path = None
    ctx.close()
    if video_path and Path(video_path).exists():
        dest = MOTION / "real-sse-desktop.webm"
        shutil.move(video_path, dest)
        print(f"Saved REAL video: {dest}")

    transition = find_role_transition(snaps)
    report = {
        "source": "REAL SSE",
        "claim": CLAIM,
        "ssePhases": sse.get("phases") or [],
        "domPhases": seen_phases,
        "sseStarted": sse.get("started"),
        "sseError": sse.get("error"),
        "eventCount": len(sse.get("events") or []),
        "transition": transition,
        "transitionDom": transition_dom,
        "sameAfterComplete": same_after,
        "spanAudit": trace,
        "traceMarks": trace_marks,
        "hoverTrace": hover_trace,
        "drawer": drawer_notes,
        "keyboard": kb,
        "editorial": edit,
        "conflictSource": conflict_source,
        "hasConflictDom": has_conflict,
        "hasGapDom": has_gap,
        "scrollBeforeComplete": scroll_before_complete,
        "durationSec": round(time.time() - start, 1),
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("ssePhases", "domPhases", "transition", "conflictSource", "durationSec")}, ensure_ascii=False, indent=2))
    return report


def capture_fixture_reduced_motion(browser) -> None:
    """FIXTURE-only settling/emergence reduced-motion frames. Not a live stream."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(f"{BASE_URL}/?fixture=settling", wait_until="domcontentloaded")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(400)
    paths = []
    for i in range(8):
        p = REDUCED_FRAMES / f"fixture-settling-{i:02d}.png"
        REDUCED_FRAMES.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(p), full_page=False)
        paths.append(p)
        page.wait_for_timeout(80)
    save_gif(paths, MOTION / "fixture-settling-reduced.gif")
    page.goto(f"{BASE_URL}/?fixture=investigating", wait_until="domcontentloaded")
    page.wait_for_timeout(200)
    page.goto(f"{BASE_URL}/?fixture=complete", wait_until="domcontentloaded")
    page.wait_for_timeout(200)
    page.screenshot(path=str(MOTION / "fixture-conclusion-reduced-complete.png"), full_page=False)
    print("Saved DETERMINISTIC FIXTURE reduced-motion frames")
    ctx.close()


def write_source_md(report: dict) -> None:
    lines = [
        "# SOURCE — Issue #66 production integration artifacts",
        "",
        "Every file in this directory is tagged. Fixture is never a substitute for the live stream.",
        "",
        f"- Real investigation input: `{CLAIM}`",
        f"- SSE phases: `{report.get('ssePhases')}`",
        f"- DOM phases: `{report.get('domPhases')}`",
        f"- Evidence role transition: `{report.get('transition')}`",
        f"- Conflict/gap image: {report.get('conflictSource')}",
        f"- Duration: {report.get('durationSec')}s",
        "",
        "## REAL SSE",
        "",
        "- `desktop-input.png`",
        "- `desktop-real-decomposed.png` (if phase observed)",
        "- `desktop-real-investigating.png`",
        "- `desktop-real-complete.png`",
        "- `desktop-complete-grayscale.png` (derived from real complete)",
        "- `desktop-source-drawer.png`",
        "- `mobile-input.png`",
        "- `mobile-real-complete.png`",
        "- `mobile-source-sheet.png`",
        "- `desktop-reduced-motion-complete.png` (real complete + emulated reduced-motion)",
        "- `real/snapshots/*.json`",
        "- `real/motion/real-sse-desktop.webm`",
        "",
        "## DETERMINISTIC FIXTURE",
        "",
        "- `real/motion/frames-reduced/fixture-settling-*.png` and `fixture-settling-reduced.gif`",
        "- `real/motion/fixture-conclusion-reduced-complete.png`",
    ]
    if report.get("conflictSource", "").startswith("DETERMINISTIC"):
        lines.append("- `desktop-conflict-gap.png` — FIXTURE because the real run had no conflict/gap")
    else:
        lines.append("- `desktop-conflict-gap.png` — REAL SSE")
    SOURCE_LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    errors: list[str] = []
    proc = start_stack_if_needed()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=CHROME, args=CHROME_ARGS)
            report = run_real(browser)
            if report.get("conflictSource", "").startswith("DETERMINISTIC"):
                capture_fixture_conflict(browser)
            capture_fixture_reduced_motion(browser)
            write_source_md(report)
            browser.close()

            phases = set(report.get("ssePhases") or []) | set(report.get("domPhases") or [])
            for required in ("received", "decomposed", "investigating", "judging", "complete"):
                if required not in phases:
                    errors.append(f"missing phase {required} in SSE+DOM")
            if not report.get("transition"):
                errors.append("no observable unassessed→role transition in REAL snapshots (do not invent)")
            same = report.get("sameAfterComplete") or {}
            if same and same.get("region") is False:
                errors.append("conclusion region remounted")
            if same and same.get("original") is False:
                errors.append("original claim remounted")
            for row in report.get("spanAudit") or []:
                if row.get("status") == "mismatch":
                    errors.append(f"span mismatch for {row.get('id')}")
            kb = report.get("keyboard") or {}
            if kb.get("ok") is False:
                errors.extend(kb.get("errors") or ["keyboard walk failed"])
            if report.get("sseError"):
                errors.append(f"sse hook error {report['sseError']}")

            print("GATE", "FAIL" if errors else "PASS")
            for e in errors:
                print(" -", e)
            (REAL / "gate.json").write_text(json.dumps({"ok": not errors, "errors": errors}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return 1 if errors else 0
    finally:
        if proc:
            proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
