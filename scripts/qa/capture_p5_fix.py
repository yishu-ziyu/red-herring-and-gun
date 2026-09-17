#!/usr/bin/env python3
"""P5 修复验证：胶囊改为「点击填入输入框、确认再发」的断言与截图。

产物：docs/reports/2026-09-12-p5-followup-chips/fixed-desktop.png、fixed-mobile.png

契约：docs/evals/2026-09-12-p5-followup-confirm.md（Evaluator 3）。

两段断言，每个视口各走一遍：
  1. 点击前起就拦 `**/api/**` 并 abort（取证不花钱，且比挂住更确定：请求绝不落到后端）。
     点第 1 个胶囊后：输入框 value == 该胶囊文本、document.activeElement 就是输入框、
     这一下没有产生任何 /api/ 请求。
  2. 按 Enter 后：恰好 1 个 `orchestrate-stream` 请求，body 含 FOLLOW_UP_MARKER
     （同一条核查的追问，不是新案件。）——确认后走的仍是带上一轮上下文的同一条核查。

起服务/拦截约定复用 scripts/qa/capture_p5_followup_chips.py：默认复用 127.0.0.1:5211 的 dev 服务，
没有则临时 `npx vite`。
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

OUT = os.path.abspath("docs/reports/2026-09-12-p5-followup-chips")
os.makedirs(OUT, exist_ok=True)
PORT = 5211
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SUBTITLE = "点一个推荐问题，它会填入下方输入框；确认后再发出追查。"
FOLLOW_UP_MARKER = "同一条核查的追问，不是新案件。"

STATE_JS = """
() => {
  const chips = [...document.querySelectorAll(".gp-followup-chip")];
  const input = document.querySelector(".gp-followup-input");
  const active = document.activeElement;
  return {
    chipCount: chips.length,
    chipTexts: chips.map((c) => (c.querySelector(".gp-followup-chip-text")?.textContent ?? "").trim()),
    chipAriaLabels: chips.map((c) => c.getAttribute("aria-label")),
    inputValue: input ? input.value : null,
    inputPlaceholder: input?.getAttribute("placeholder") ?? null,
    activeTag: active ? active.tagName : null,
    activeClass: active ? (active.className || "").toString() : null,
    activeIsInput: active === input,
    selectionStart: input ? input.selectionStart : null,
    selectionEnd: input ? input.selectionEnd : null,
    subtitle: document.querySelector(".gp-followup-subtitle")?.textContent?.trim() ?? null,
    sendBtnDisabled: document.querySelector(".gp-followup-send-btn")?.disabled ?? null,
    phase: document.querySelector("[data-gp-phase]")?.getAttribute("data-gp-phase") ?? null,
  };
}
"""


def ensure_server():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    open_ = sock.connect_ex(("127.0.0.1", PORT)) == 0
    sock.close()
    if open_:
        print(f"reuse existing server on :{PORT}")
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


def main() -> int:
    errors: list[str] = []
    measures: dict = {}
    server = ensure_server()
    try:
        with sync_playwright() as p:
            for tag, width, height in [("desktop", 1280, 900), ("mobile", 375, 812)]:
                ctx = p.chromium.launch_persistent_context(
                    f"/tmp/chrome-kimi-p5fix-{tag}",
                    headless=True,
                    executable_path=CHROME,
                    viewport={"width": width, "height": height},
                )
                page = ctx.pages[0] if ctx.pages else ctx.new_page()

                blocked: list[dict] = []

                def handler(route, request):
                    blocked.append({
                        "method": request.method,
                        "url": request.url,
                        "postData": (request.post_data or "")[:2000],
                        "at": time.time(),
                    })
                    route.abort()

                page.route("**/api/**", handler)

                page.goto(f"http://127.0.0.1:{PORT}/?fixture=complete", wait_until="domcontentloaded")
                page.wait_for_selector("[data-gp-phase='complete']", timeout=20000)
                page.wait_for_timeout(1400)

                m = {"viewport": f"{width}x{height}", "beforeClick": page.evaluate(STATE_JS)}
                before = len(blocked)

                chip = page.locator(".gp-followup-chip").first
                chip.scroll_into_view_if_needed()
                page.wait_for_timeout(300)
                chip.click()
                page.wait_for_timeout(400)

                after = page.evaluate(STATE_JS)
                clickRequests = [r for r in blocked[before:]]
                m["afterClick"] = after
                m["requestsAfterClick"] = clickRequests

                question = m["beforeClick"]["chipTexts"][0]
                if m["beforeClick"]["chipCount"] != 3:
                    errors.append(f"[{tag}] 完成态应有 3 个胶囊，实为 {m['beforeClick']['chipCount']}")
                if after["inputValue"] != question:
                    errors.append(f"[{tag}] 点胶囊后输入框应为「{question}」，实为「{after['inputValue']}」")
                if not after["activeIsInput"]:
                    errors.append(
                        f"[{tag}] 点胶囊后焦点不在输入框（activeElement = {after['activeTag']}."
                        f"{after['activeClass']}）"
                    )
                if len(clickRequests) != 0:
                    errors.append(f"[{tag}] 点胶囊后出现了 /api/ 请求：{[r['url'] for r in clickRequests]}")
                if after["subtitle"] != SUBTITLE:
                    errors.append(f"[{tag}] 副标题不是契约文案，实为「{after['subtitle']}」")
                for text, label in zip(m["beforeClick"]["chipTexts"], after["chipAriaLabels"]):
                    if label != f"将「{text}」填入追问输入框":
                        errors.append(f"[{tag}] 胶囊 aria-label 不符：{label!r}（应为 将「{text}」填入追问输入框）")

                shot = os.path.join(OUT, f"fixed-{tag}.png")
                page.screenshot(path=shot, full_page=True, timeout=90000)
                print("saved", shot)

                # 确认：Enter 才发出；恰好 1 个 orchestrate-stream，body 带同一条核查的追问标记。
                before = len(blocked)
                page.keyboard.press("Enter")
                deadline = time.time() + 12
                streams: list[dict] = []
                while time.time() < deadline:
                    streams = [r for r in blocked[before:] if "orchestrate-stream" in r["url"]]
                    if streams:
                        break
                    page.wait_for_timeout(200)
                m["requestsAfterEnter"] = [r for r in blocked[before:]]
                m["orchestrateStreamCount"] = len(streams)
                if len(streams) != 1:
                    errors.append(f"[{tag}] 按 Enter 后 orchestrate-stream 请求应恰好 1 个，实为 {len(streams)}")
                else:
                    body = streams[0]["postData"]
                    m["enterBodyHasMarker"] = FOLLOW_UP_MARKER in body
                    m["enterBodyHasQuestion"] = question in body
                    if FOLLOW_UP_MARKER not in body:
                        errors.append(f"[{tag}] Enter 请求体不含「{FOLLOW_UP_MARKER}」")
                m["afterEnter"] = page.evaluate(STATE_JS)
                measures[tag] = m
                print(f"[{tag}] {json.dumps({k: v for k, v in m.items() if k != 'beforeClick'}, ensure_ascii=False)}")
                ctx.close()
    finally:
        if server:
            server.terminate()

    for e in errors:
        print("FAIL:", e)
    print("PASS" if not errors else f"{len(errors)} failed")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
