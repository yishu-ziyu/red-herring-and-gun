#!/usr/bin/env python3
"""Capture production Golden Path Claim Trace screenshots on port 5181.

Deterministic fixtures only — not a live SSE run.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image

OUT_DIR = os.path.abspath("docs/design/2026-09-06-claim-trace")
os.makedirs(OUT_DIR, exist_ok=True)
PORT = 5181
BASE_URL = f"http://127.0.0.1:{PORT}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fail(errors: list[str], msg: str) -> None:
    print(f"FAIL: {msg}")
    errors.append(msg)


def start_vite_if_needed():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    is_open = sock.connect_ex(("127.0.0.1", PORT)) == 0
    sock.close()
    if is_open:
        return None
    print(f"Starting Vite server on port {PORT}...")
    proc = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=os.path.abspath("mvp"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    for _ in range(40):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ready = sock.connect_ex(("127.0.0.1", PORT)) == 0
        sock.close()
        if ready:
            break
        time.sleep(0.25)
    else:
        proc.terminate()
        raise RuntimeError(f"Vite did not start on {PORT}")
    return proc


def quote_metrics(page) -> dict:
    return page.evaluate(
        """() => {
          const quote = document.querySelector('.gp-original-quote');
          const text = document.querySelector('.gp-original-text');
          if (!quote || !text) return null;
          const q = quote.getBoundingClientRect();
          const t = text.getBoundingClientRect();
          return {
            quoteW: q.width, quoteH: q.height,
            textW: t.width, textH: t.height,
            text: text.textContent,
            active: [...document.querySelectorAll('mark.gp-trace-mark.is-active')].map((m) => ({
              claim: m.getAttribute('data-gp-trace-claim'),
              phrase: m.textContent,
            })),
            marks: document.querySelectorAll('mark.gp-trace-mark').length,
          };
        }"""
    )


def wait_mixed(page) -> None:
    page.wait_for_selector(".gp-original-text", timeout=15000)
    page.wait_for_selector('[data-gp-claim-id="claim-1"] .gp-claim-head', timeout=15000)
    page.wait_for_function(
        "() => (document.querySelector('.gp-original-text')?.textContent || '').includes('维生素C')",
        timeout=15000,
    )


def capture(browser) -> list[str]:
    errors: list[str] = []

    desktop = browser.new_context(viewport={"width": 1440, "height": 900})
    page = desktop.new_page()
    page.goto(f"{BASE_URL}/?fixture=mixed", wait_until="domcontentloaded")
    wait_mixed(page)
    time.sleep(0.35)

    idle = quote_metrics(page)
    print("idle metrics:", json.dumps(idle, ensure_ascii=False))
    if not idle or "维生素C能治感冒" not in (idle.get("text") or ""):
        fail(errors, "mixed fixture original sentence missing 维生素C能治感冒")
    if idle and idle.get("active"):
        fail(errors, f"idle should have no active trace, got {idle['active']}")
    idle_path = os.path.join(OUT_DIR, "claim-trace-idle.png")
    page.screenshot(path=idle_path, full_page=True)
    print(f"Captured {idle_path}")

    page.locator('[data-gp-claim-id="claim-1"] .gp-claim-head').hover()
    page.wait_for_selector('mark[data-gp-trace-claim="claim-1"].is-active', timeout=5000)
    time.sleep(0.2)
    claim01 = quote_metrics(page)
    print("claim-01 metrics:", json.dumps(claim01, ensure_ascii=False))
    if not claim01 or [a["claim"] for a in claim01["active"]] != ["claim-1"]:
        fail(errors, f"claim-01 hover should activate only claim-1, got {claim01}")
    if claim01 and abs(claim01["quoteW"] - idle["quoteW"]) > 0.5:
        fail(errors, f"layout shift quote width {idle['quoteW']} -> {claim01['quoteW']}")
    if claim01 and abs(claim01["quoteH"] - idle["quoteH"]) > 0.5:
        fail(errors, f"layout shift quote height {idle['quoteH']} -> {claim01['quoteH']}")
    if claim01 and abs(claim01["textW"] - idle["textW"]) > 0.5:
        fail(errors, f"layout shift original text width {idle['textW']} -> {claim01['textW']}")
    if claim01 and abs(claim01["textH"] - idle["textH"]) > 0.5:
        fail(errors, f"layout shift original text height {idle['textH']} -> {claim01['textH']}")
    path01 = os.path.join(OUT_DIR, "claim-trace-claim-01.png")
    page.screenshot(path=path01, full_page=True)
    print(f"Captured {path01}")

    clip = page.locator(".gp-original").bounding_box()
    frame_idle = os.path.join(OUT_DIR, "claim-trace-shift-idle.png")
    frame_hover = os.path.join(OUT_DIR, "claim-trace-shift-hover.png")
    if clip:
        page.locator('[data-gp-claim-id="claim-2"] .gp-claim-head').hover()
        page.wait_for_selector('mark[data-gp-trace-claim="claim-2"].is-active', timeout=5000)
        # recapture 01 frames from stored hover of claim-1 after we finish claim-02
    page.locator('[data-gp-claim-id="claim-2"] .gp-claim-head').hover()
    page.wait_for_selector('mark[data-gp-trace-claim="claim-2"].is-active', timeout=5000)
    time.sleep(0.2)
    claim02 = quote_metrics(page)
    print("claim-02 metrics:", json.dumps(claim02, ensure_ascii=False))
    if not claim02 or [a["claim"] for a in claim02["active"]] != ["claim-2"]:
        fail(errors, f"claim-02 hover should activate only claim-2, got {claim02}")
    if claim02 and abs(claim02["quoteW"] - idle["quoteW"]) > 0.5:
        fail(errors, f"layout shift quote width on claim-02 {idle['quoteW']} -> {claim02['quoteW']}")
    if claim02 and abs(claim02["quoteH"] - idle["quoteH"]) > 0.5:
        fail(errors, f"layout shift quote height on claim-02 {idle['quoteH']} -> {claim02['quoteH']}")
    path02 = os.path.join(OUT_DIR, "claim-trace-claim-02.png")
    page.screenshot(path=path02, full_page=True)
    print(f"Captured {path02}")

    # Shift frames + short GIF from original-quote crop
    page.mouse.move(0, 0)
    time.sleep(0.25)
    restored = quote_metrics(page)
    if restored and restored.get("active"):
        # move off claims; if still active, click body
        page.locator(".gp-original-label").hover()
        time.sleep(0.2)
        restored = quote_metrics(page)
    quote = page.locator(".gp-original")
    quote.screenshot(path=frame_idle)
    page.locator('[data-gp-claim-id="claim-1"] .gp-claim-head').hover()
    page.wait_for_selector('mark[data-gp-trace-claim="claim-1"].is-active')
    time.sleep(0.15)
    quote.screenshot(path=frame_hover)
    try:
        img1 = Image.open(frame_idle).convert("RGBA")
        img2 = Image.open(frame_hover).convert("RGBA")
        gif_path = os.path.join(OUT_DIR, "claim-trace-no-shift.gif")
        img1.save(gif_path, save_all=True, append_images=[img2], duration=450, loop=0)
        print(f"Captured {gif_path}")
    except Exception as exc:
        print(f"GIF optional skipped: {exc}")

    page.goto(f"{BASE_URL}/?fixture=nospan", wait_until="domcontentloaded")
    page.wait_for_selector('[data-gp-claim-id="claim-1"] .gp-claim-head', timeout=15000)
    time.sleep(0.3)
    page.locator('[data-gp-claim-id="claim-1"] .gp-claim-head').hover()
    time.sleep(0.2)
    nospan = quote_metrics(page)
    print("no-span metrics:", json.dumps(nospan, ensure_ascii=False))
    if nospan and nospan.get("marks", 0) != 0:
        fail(errors, f"no-span fixture must not render marks, got {nospan['marks']}")
    if nospan and nospan.get("active"):
        fail(errors, f"no-span must not activate trace, got {nospan['active']}")
    nospan_path = os.path.join(OUT_DIR, "claim-trace-no-span.png")
    page.screenshot(path=nospan_path, full_page=True)
    print(f"Captured {nospan_path}")
    page.close()
    desktop.close()

    mobile = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
    )
    page_m = mobile.new_page()
    page_m.goto(f"{BASE_URL}/?fixture=mixed", wait_until="domcontentloaded")
    wait_mixed(page_m)
    time.sleep(0.35)
    head1 = page_m.locator('[data-gp-claim-id="claim-1"] .gp-claim-head')
    before_expanded = head1.get_attribute("aria-expanded")
    head1.focus()
    page_m.wait_for_selector('mark[data-gp-trace-claim="claim-1"].is-active', timeout=5000)
    page_m.wait_for_timeout(200)
    mobile_metrics = quote_metrics(page_m)
    print("mobile metrics:", json.dumps(mobile_metrics, ensure_ascii=False))
    after_focus = head1.get_attribute("aria-expanded")
    if after_focus != before_expanded:
        fail(errors, f"mobile focus must not toggle expand ({before_expanded} -> {after_focus})")
    if not mobile_metrics or not any(a["claim"] == "claim-1" for a in mobile_metrics.get("active") or []):
        fail(errors, f"mobile focus/expanded-active should trace claim-1, got {mobile_metrics}")
    head1.tap()
    page_m.wait_for_timeout(150)
    toggled = head1.get_attribute("aria-expanded")
    print("mobile aria-expanded after tap:", toggled)
    if toggled == after_focus:
        fail(errors, "mobile tap should still toggle expand/collapse")
    # Restore expanded for the screenshot: focus + expanded together.
    if toggled == "false":
        head1.tap()
        page_m.wait_for_timeout(150)
    head1.focus()
    page_m.wait_for_selector('mark[data-gp-trace-claim="claim-1"].is-active', timeout=5000)
    print("mobile aria-expanded screenshot:", head1.get_attribute("aria-expanded"))
    mobile_path = os.path.join(OUT_DIR, "claim-trace-mobile-focus.png")
    page_m.screenshot(path=mobile_path, full_page=True)
    print(f"Captured {mobile_path}")
    page_m.close()
    mobile.close()

    required = [
        "claim-trace-idle.png",
        "claim-trace-claim-01.png",
        "claim-trace-claim-02.png",
        "claim-trace-no-span.png",
        "claim-trace-mobile-focus.png",
    ]
    for name in required:
        path = os.path.join(OUT_DIR, name)
        if not os.path.exists(path) or os.path.getsize(path) < 1000:
            fail(errors, f"missing or tiny screenshot {name}")

    return errors


def run() -> int:
    proc = start_vite_if_needed()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=CHROME)
            errors = capture(browser)
            browser.close()
    finally:
        if proc:
            proc.terminate()
            proc.wait()
    if errors:
        print("GATE FAIL")
        for item in errors:
            print(" -", item)
        return 1
    print("GATE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(run())
