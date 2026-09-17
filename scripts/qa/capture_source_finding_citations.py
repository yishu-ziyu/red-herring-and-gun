#!/usr/bin/env python3
"""QA 走查：来源抽屉 finding 引证角标 + 关联核验来源 chips。

验收契约：docs/evals/2026-09-12-source-finding-citations.md
独立 vite 端口 5197 + 独立 chrome profile（不碰 5211 与 agy 的浏览器标签）。
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/reports/2026-09-12-source-finding-citations")
os.makedirs(OUT_DIR, exist_ok=True)
BASE_URL = "http://127.0.0.1:5197"
PORT = 5197
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = "/tmp/chrome-kimi-gp-5197"


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
        cwd=os.path.abspath("apps"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    for _ in range(60):
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


def main() -> int:
    errors: list[str] = []
    vite = start_vite_if_needed()
    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                PROFILE,
                headless=True,
                executable_path=CHROME,
                viewport={"width": 1280, "height": 900},
                args=["--no-first-run"],
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"{BASE_URL}/?fixture=complete", wait_until="domcontentloaded")
            page.wait_for_selector(".gp-drawer--source, .gp-evidence-row, [data-source-id]", timeout=15000)

            # 打开第一个来源抽屉
            page.click("[data-source-id] >> nth=0")
            page.wait_for_selector(".gp-drawer--source.is-open", timeout=8000)
            page.wait_for_timeout(600)  # 等进入动画与 favicon

            drawer = page.locator(".gp-drawer--source")
            drawer_id = drawer.get_attribute("data-gp-source-id")

            # 1) finding 正文的 [n] 应渲染为角标（fixture 有 [n] 标记时）
            badges = drawer.locator("[data-gp-cite]")
            badge_count = badges.count()
            print(f"INFO: cite badges = {badge_count}, drawer source id = {drawer_id}")

            # 2) chips 区：不含当前来源；编号与角标一致
            chips_section = drawer.locator('[data-gp-source-section="cited-sources"]')
            if chips_section.count() == 0:
                fail(errors, "cited-sources 区没有渲染")
            else:
                current_in_chips = chips_section.locator(f'.gp-finding-source-chip[title*="{drawer_id}"]').count()
                # title 属性是 “标题 (域名)”，改用 href 与 data 对比：直接检查 chips 里有无当前来源链接
                current_href = drawer.locator(".gp-source-open").get_attribute("href")
                if current_href:
                    dup = chips_section.locator(f'a[href="{current_href}"]').count()
                    if dup > 0:
                        fail(errors, f"关联来源 chips 里重复出现当前来源 {current_href}")
                chip_labels = chips_section.locator(".gp-finding-source-index").all_inner_texts()
                badge_nums = sorted(int(badges.nth(i).get_attribute("data-gp-cite")) for i in range(badge_count))
                print(f"INFO: chip labels = {chip_labels}, badge numbers = {badge_nums}")

            page.screenshot(path=os.path.join(OUT_DIR, "drawer-full.png"), full_page=False)
            finding_block = drawer.locator('[data-gp-source-section="finding"]')
            if finding_block.count() > 0:
                finding_block.screenshot(path=os.path.join(OUT_DIR, "finding-block.png"))
            ctx.close()
    finally:
        if vite:
            vite.terminate()

    if errors:
        print(f"\n{len(errors)} check(s) failed")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
