#!/usr/bin/env python3
"""P0-P3 修复验证：fixture=complete，移动端 375 + 桌面 1280，断言 + 截图。"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.path.abspath("docs/reports/2026-09-12-page-audit")
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
        cwd=os.path.abspath("apps"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(80):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sock.connect_ex(("127.0.0.1", PORT)) == 0:
            sock.close()
            break
        sock.close()
        time.sleep(0.25)
    return proc


def main() -> int:
    errors: list[str] = []
    vite = ensure_vite()
    try:
        with sync_playwright() as p:
            # ---- 移动端 ----
            ctx = p.chromium.launch_persistent_context(
                "/tmp/chrome-kimi-fix-m", headless=True, executable_path=CHROME,
                viewport={"width": 375, "height": 812})
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"http://127.0.0.1:{PORT}/?fixture=complete", wait_until="domcontentloaded")
            page.wait_for_selector("[data-gp-phase='complete']", timeout=20000)
            page.wait_for_timeout(800)

            if page.locator(".gp-hero-sources-list").count() > 0:
                errors.append("P0: 移动端来源条仍展开")
            if not page.locator(".gp-hero-sources-toggle").is_visible():
                errors.append("P0: 折叠触发器不可见")

            nowrap_count = page.locator("[data-gp-direct-answer] .is-nowrap").count()
            print(f"INFO mobile nowrap segments = {nowrap_count}")
            if nowrap_count == 0:
                errors.append("P1: 结论断言没有锁行短段")

            dossier_dir = page.evaluate(
                "getComputedStyle(document.querySelector('.gp-dossier-header')).flexDirection")
            print(f"INFO dossier header flexDirection = {dossier_dir}")
            if dossier_dir != "column":
                errors.append("P2: 案卷条移动端未垂直堆叠")

            # P3：域名应作为摘录后的行内引用，不在 header 里（有摘录时）
            in_header = page.evaluate(
                "document.querySelectorAll('.gp-evidence-header .gp-evidence-domain').length")
            cite_total = page.evaluate(
                "document.querySelectorAll('.gp-evidence-body > .gp-evidence-domain').length")
            print(f"INFO domains in header = {in_header}, citation lines = {cite_total}")
            if cite_total == 0:
                errors.append("P3: 未找到行内引用域名")

            page.screenshot(path=os.path.join(BASE, "fixed-mobile.png"), full_page=True, timeout=90000)
            hero = page.locator(".gp-hero")
            hero.screenshot(path=os.path.join(BASE, "fixed-hero-mobile.png"))
            ctx.close()

            # ---- 桌面端 ----
            ctx = p.chromium.launch_persistent_context(
                "/tmp/chrome-kimi-fix-d", headless=True, executable_path=CHROME,
                viewport={"width": 1280, "height": 900})
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"http://127.0.0.1:{PORT}/?fixture=complete", wait_until="domcontentloaded")
            page.wait_for_selector("[data-gp-phase='complete']", timeout=20000)
            page.wait_for_timeout(800)

            if page.locator(".gp-hero-sources-list").count() == 0:
                errors.append("P0: 桌面端来源条应变默认展开")
            cite_total = page.evaluate(
                "document.querySelectorAll('.gp-evidence-body > .gp-evidence-domain').length")
            if cite_total == 0:
                errors.append("P3: 桌面端未找到行内引用域名")

            page.screenshot(path=os.path.join(BASE, "fixed-desktop.png"), full_page=True, timeout=90000)
            ctx.close()
    finally:
        if vite:
            vite.terminate()

    for e in errors:
        print("FAIL:", e)
    print("PASS" if not errors else f"{len(errors)} failed")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
