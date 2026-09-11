#!/usr/bin/env python3
"""争点与缺口原型取证：第二轮四个变体 + 窄屏，真实 Chromium 截图。

用法：python3 scripts/capture_conflict_gap_prototype.py
输出：docs/design/prototypes/conflict-gap/screenshots/
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/design/prototypes/conflict-gap/screenshots")
PORT = 51937
BASE = f"http://127.0.0.1:{PORT}"
PAGE = "/docs/design/prototypes/conflict-gap/index.html"
VARIANTS = ["snippet", "signature", "states", "duel"]


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=os.path.abspath("."),
    )
    time.sleep(1.0)
    errors: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)

            def new_page(width: int, height: int):
                ctx = browser.new_context(viewport={"width": width, "height": height})
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
                pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
                return ctx, pg

            # 桌面：四个变体初始态 + 来源抽屉开态（片段变体，验证行仍可下钻）
            for i, name in enumerate(VARIANTS, start=1):
                ctx, page = new_page(1440, 1100)
                page.goto(f"{BASE}{PAGE}?v={i}")
                page.wait_for_timeout(1100)
                page.screenshot(path=os.path.join(OUT_DIR, f"r3-desktop-{i}-{name}.png"), full_page=True)
                if name == "snippet":
                    page.click(".snip-side.is-contradict .snip-row")
                    page.wait_for_timeout(500)
                    page.screenshot(path=os.path.join(OUT_DIR, "r3-desktop-3-snippet-drawer.png"), full_page=False)
                ctx.close()

            # 窄屏：四个变体初始态（取景器是 chrome，盖内容，截图时临时藏起来）
            for i, name in enumerate(VARIANTS, start=1):
                ctx, page = new_page(390, 1000)
                page.goto(f"{BASE}{PAGE}?v={i}")
                page.wait_for_timeout(1100)
                page.evaluate("document.querySelector('.proto-picker').style.display = 'none'")
                page.screenshot(path=os.path.join(OUT_DIR, f"r3-mobile-{i}-{name}.png"), full_page=True)
                ctx.close()

            browser.close()
    finally:
        server.terminate()

    if errors:
        print("[capture] 控制台错误：")
        for e in errors:
            print(" -", e)
        return 1
    print(f"[capture] OK，截图写入 {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
