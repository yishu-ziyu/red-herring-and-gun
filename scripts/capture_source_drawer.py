#!/usr/bin/env python3
"""Capture production Golden Path Source Drawer / Bottom Sheet screenshots.

Port 5183 is reserved for this agent. Screenshots are DEV fixture driven,
not a live SSE run (#66).
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/design/2026-09-06-source-drawer")
os.makedirs(OUT_DIR, exist_ok=True)
BASE_URL = "http://127.0.0.1:5183"
PORT = 5183
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def make_grayscale(src_path: str, dest_path: str) -> None:
    img = Image.open(src_path).convert("L")
    img.save(dest_path)
    print(f"Saved grayscale: {dest_path}")


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
    for _ in range(50):
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


def wait_complete(page) -> None:
    page.wait_for_selector(".gp-hero-answer, [data-gp-conclusion-judgment]", timeout=15000)
    page.wait_for_selector(".gp-evidence-item", timeout=15000)


def ensure_claim_expanded(page, claim_id: str) -> None:
    page.evaluate(
        """(id) => {
          const head = document.querySelector('[data-gp-claim-id="' + id + '"] .gp-claim-head');
          if (!head) throw new Error('missing claim ' + id);
          if (head.getAttribute('aria-expanded') !== 'true') head.click();
        }""",
        claim_id,
    )


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


def open_evidence(page, selector: str) -> None:
    js_click(page, selector)
    page.wait_for_selector(".gp-drawer--source.is-open", timeout=5000)
    page.wait_for_function(
        """() => {
          const d = document.querySelector('.gp-drawer--source.is-open');
          if (!d) return false;
          const r = d.getBoundingClientRect();
          return r.width > 280 && r.height > 200 && r.bottom > 80 && r.right > 80;
        }""",
        timeout=5000,
    )
    page.wait_for_timeout(280)


def shot(page, name: str) -> str:
    path = os.path.join(OUT_DIR, name)
    page.screenshot(path=path, full_page=False)
    print(f"Saved {path}")
    return path


def run() -> int:
    errors: list[str] = []
    vite = start_vite_if_needed()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, headless=True)
            desktop = browser.new_context(viewport={"width": 1440, "height": 900})
            page = desktop.new_page()
            page.goto(f"{BASE_URL}/?fixture=source-audit", wait_until="domcontentloaded")
            wait_complete(page)

            # Full audit: finding + limitation on the support row.
            ensure_claim_expanded(page, "claim-2")
            page.wait_for_selector('[data-gp-claim-id="claim-2"] .gp-evidence-item[data-gp-role="support"]')
            open_evidence(page, '[data-gp-claim-id="claim-2"] .gp-evidence-item[data-gp-role="support"]')
            page.wait_for_selector('[data-gp-source-section="finding"]')
            page.wait_for_selector('[data-gp-source-section="limitation"]')
            shot(page, "source-drawer.png")
            make_grayscale(os.path.join(OUT_DIR, "source-drawer.png"), os.path.join(OUT_DIR, "source-drawer-grayscale.png"))

            js_click(page, "[data-gp-source-close]")
            page.wait_for_selector(".gp-drawer--source", state="detached")

            # No limitation: claim-2 contradict is reachable and has no limitation.
            open_evidence(page, '[data-gp-claim-id="claim-2"] .gp-evidence-item[data-gp-role="contradict"]')
            if page.locator('.gp-drawer--source [data-gp-source-section="limitation"]').count() != 0:
                errors.append("source-drawer-no-limitation.png still shows limitation")
            page.wait_for_selector('.gp-drawer--source[data-gp-role="contradict"]')
            shot(page, "source-drawer-no-limitation.png")
            js_click(page, "[data-gp-source-close]")
            page.wait_for_selector(".gp-drawer--source", state="detached")

            # Unreachable: claim-1 first evidence is marked reachable=false in source-audit.
            open_evidence(page, '[data-gp-claim-id="claim-1"] .gp-evidence-item')
            page.wait_for_selector(".gp-drawer--source .gp-source-unreachable")
            shot(page, "source-drawer-unreachable.png")
            desktop.close()

            mobile = browser.new_context(viewport={"width": 390, "height": 844})
            page = mobile.new_page()
            page.goto(f"{BASE_URL}/?fixture=source-audit", wait_until="domcontentloaded")
            wait_complete(page)
            ensure_claim_expanded(page, "claim-2")
            page.wait_for_selector('[data-gp-claim-id="claim-2"] .gp-evidence-item[data-gp-role="support"]')
            open_evidence(page, '[data-gp-claim-id="claim-2"] .gp-evidence-item[data-gp-role="support"]')
            placement = page.locator(".gp-drawer--source").get_attribute("data-gp-placement")
            if placement != "sheet":
                errors.append(f"mobile placement is {placement}, expected sheet")
            box = page.locator(".gp-drawer--source").bounding_box()
            if not box:
                errors.append("mobile sheet has no bounding box")
            else:
                if box["y"] < 40:
                    errors.append(f"mobile sheet does not sit at bottom, y={box['y']}")
                if box["width"] < 380:
                    errors.append(f"mobile sheet width {box['width']} < 380")
            shot(page, "source-sheet.png")
            make_grayscale(os.path.join(OUT_DIR, "source-sheet.png"), os.path.join(OUT_DIR, "source-sheet-grayscale.png"))
            mobile.close()
            browser.close()
    finally:
        if vite is not None:
            vite.terminate()
            vite.wait(timeout=5)

    required = [
        "source-drawer.png",
        "source-drawer-no-limitation.png",
        "source-drawer-unreachable.png",
        "source-drawer-grayscale.png",
        "source-sheet.png",
        "source-sheet-grayscale.png",
    ]
    for name in required:
        path = os.path.join(OUT_DIR, name)
        if not os.path.exists(path):
            errors.append(f"missing {name}")

    if errors:
        print("GATE FAIL")
        for item in errors:
            print(f"  - {item}")
        return 1
    print("GATE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(run())
