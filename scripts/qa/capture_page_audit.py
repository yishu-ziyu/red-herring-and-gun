#!/usr/bin/env python3
"""整页审查截图：fixture=complete，桌面 + 移动两种视口。"""
from __future__ import annotations

import os
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright

OUT = os.path.abspath("docs/reports/2026-09-12-page-audit")
os.makedirs(OUT, exist_ok=True)
PORT = 5197
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def ensure_vite():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    open_ = sock.connect_ex(("127.0.0.1", PORT)) == 0
    sock.close()
    if open_:
        return None
    proc = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=os.path.abspath("apps"),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(80):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sock.connect_ex(("127.0.0.1", PORT)) == 0:
            sock.close()
            break
        sock.close()
        time.sleep(0.25)
    return proc


def main():
    vite = ensure_vite()
    try:
        with sync_playwright() as p:
            for tag, width, height, full in [
                ("desktop", 1280, 900, True),
                ("mobile", 375, 812, True),
            ]:
                ctx = p.chromium.launch_persistent_context(
                    f"/tmp/chrome-kimi-audit-{tag}",
                    headless=True,
                    executable_path=CHROME,
                    viewport={"width": width, "height": height},
                )
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                page.goto(f"http://127.0.0.1:{PORT}/?fixture=complete", wait_until="domcontentloaded")
                page.wait_for_selector("[data-gp-phase='complete']", timeout=20000)
                page.wait_for_timeout(1200)
                page.screenshot(path=os.path.join(OUT, f"page-{tag}.png"), full_page=full)
                print(f"saved page-{tag}.png")
                ctx.close()
    finally:
        if vite:
            vite.terminate()


if __name__ == "__main__":
    main()
