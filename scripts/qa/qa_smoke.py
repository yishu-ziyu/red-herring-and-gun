#!/usr/bin/env python3
"""qa:smoke — 浏览器工具可用性探针 + 可选环境 UI smoke（不调用付费模型）。

- 无条件：真实启动 headless Chromium，渲染本地生成的页面并截图（浏览器工具链实测证据）。
- 设置 QA_BASE_URL（如 http://127.0.0.1:5174）时：对产品输入卡 .gp-input-card 做真实断言。
- 未设置 QA_BASE_URL 时输出 TOOL_PROBE_ONLY，不对产品做任何断言——不得据此宣称产品通过。

退出码：0 = 所执行的断言全部通过；1 = 工具或断言失败。
证据写入 docs/qa/artifacts/tool-probe/<UTC 日期>/。
"""

from __future__ import annotations

import datetime
import glob
import os
import sys

from playwright.sync_api import sync_playwright

PROBE_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>qa-smoke-probe</title></head>
<body><h1 id="probe-ok">QA smoke probe rendered</h1></body></html>"""


def find_cached_chromium() -> str | None:
    """Python playwright 与 Node playwright 的浏览器版本可能不同；
    缓存里任意 chrome-headless-shell / Chromium 可执行文件都可用（executable_path）。"""
    home = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", os.path.expanduser("~/Library/Caches/ms-playwright"))
    patterns = [
        os.path.join(home, "chromium_headless_shell-*", "chrome-headless-shell-*", "chrome-headless-shell"),
        os.path.join(home, "chromium-*", "chrome-mac*", "Chromium.app", "Contents", "MacOS", "Chromium"),
        os.path.join(home, "chromium-*", "chrome-linux*", "chrome"),
    ]
    for pattern in patterns:
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    return None


def main() -> int:
    date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    out_dir = os.path.join("docs", "qa", "artifacts", "tool-probe", date)
    os.makedirs(out_dir, exist_ok=True)
    screenshot = os.path.join(out_dir, "smoke.png")

    base_url = os.environ.get("QA_BASE_URL", "").strip()
    mode = "ENV_UI_SMOKE" if base_url else "TOOL_PROBE_ONLY"
    failures: list[str] = []

    with sync_playwright() as p:
        launch_kwargs: dict = {"headless": True}
        try:
            browser = p.chromium.launch(**launch_kwargs)
        except Exception:
            executable = find_cached_chromium()
            if not executable:
                print("[qa:smoke] FAIL 未找到任何 Playwright Chromium，且默认启动失败（python3 -m playwright install chromium）")
                return 1
            print(f"[qa:smoke] 默认浏览器缺失，使用缓存可执行文件: {executable}")
            launch_kwargs["executable_path"] = executable
            browser = p.chromium.launch(**launch_kwargs)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()

            # 1) 工具探针：本地内容真实渲染 + 截图。
            probe_url = f"data:text/html;charset=utf-8,{PROBE_HTML}"
            page.goto(probe_url)
            if not page.locator("#probe-ok").is_visible():
                failures.append("probe: 本地渲染断言失败")
            page.screenshot(path=screenshot)
            print(f"[qa:smoke] probe screenshot -> {screenshot}")

            # 2) 可选：环境 UI smoke（只对明确提供的 QA_BASE_URL，不用线上生产地址）。
            if base_url:
                page.goto(base_url, wait_until="domcontentloaded")
                try:
                    page.wait_for_selector(".gp-input-card", timeout=10_000)
                    page.screenshot(path=os.path.join(out_dir, "env-input-stage.png"))
                    print(f"[qa:smoke] env smoke .gp-input-card visible at {base_url}")
                except Exception as exc:  # noqa: BLE001 — 断言失败如实记录
                    failures.append(f"env smoke: .gp-input-card 不可见（{exc}）")
                print("[qa:smoke] 注意：ENV_UI_SMOKE 只证明该环境输入卡可用，不证明后端版本")
            else:
                print("[qa:smoke] TOOL_PROBE_ONLY：未设置 QA_BASE_URL，未对产品做断言")
        finally:
            browser.close()

    print(f"[qa:smoke] mode={mode} failures={len(failures)}")
    for f in failures:
        print(f"[qa:smoke] FAIL {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
