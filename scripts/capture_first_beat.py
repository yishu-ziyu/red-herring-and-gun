#!/usr/bin/env python3
"""Capture production screenshots for first beat: received and decomposed on port 5211."""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/design/2026-09-11-investigation-experience/preview")
os.makedirs(OUT_DIR, exist_ok=True)
PORT = 5211
BASE_URL = f"http://127.0.0.1:{PORT}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME)

        # 1. Received Desktop (1440x900)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/?fixture=received", wait_until="domcontentloaded")
        page.wait_for_selector(".gp-roles.is-compact", timeout=10000)
        time.sleep(0.5)
        rec_desktop = os.path.join(OUT_DIR, "beat1-received-desktop.png")
        page.screenshot(path=rec_desktop, full_page=True)
        print(f"Captured {rec_desktop}", flush=True)
        ctx.close()

        # 2. Decomposed Desktop (1440x900)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/?fixture=decomposed", wait_until="domcontentloaded")
        page.wait_for_selector(".gp-claims", timeout=10000)
        time.sleep(0.5)
        dec_desktop = os.path.join(OUT_DIR, "beat1-decomposed-desktop.png")
        page.screenshot(path=dec_desktop, full_page=True)
        print(f"Captured {dec_desktop}", flush=True)
        ctx.close()

        # 3. Decomposed Mobile (390x844)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/?fixture=decomposed", wait_until="domcontentloaded")
        page.wait_for_selector(".gp-claims", timeout=10000)
        time.sleep(0.5)
        dec_mobile = os.path.join(OUT_DIR, "beat1-decomposed-mobile.png")
        page.screenshot(path=dec_mobile)
        print(f"Captured {dec_mobile}", flush=True)
        ctx.close()

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
