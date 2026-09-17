#!/usr/bin/env python3
"""P5 调查：推荐追问胶囊「点击即发起新调查」的证据截图。

产物：docs/reports/2026-09-12-p5-followup-chips/

测量与截图分三段：
  1. 点击前：`?fixture=complete` 完成态下的追问区与 3 个胶囊（坐标 / 触摸尺寸 / 与输入框的距离）；
  2. 点击后：**拦住 POST /api/agent/orchestrate-stream 并让它挂住不回**，再点第一个胶囊。
     拦住是为了取证不花钱——不拦的话这一下会真的走一次完整调查（真实 API）。
     挂住而不 abort，是为了让画面停在真实生产里点击后的头几秒（连接中、快照还没回来），
     而不是停在拦截导致的失败态。
  3. 调查中态参照图：`?fixture=investigating`（纯 fixture，不走网络），给负责人看点击之后
     画面会走到哪里。
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.abspath("docs/reports/2026-09-12-p5-followup-chips")
os.makedirs(OUT, exist_ok=True)
PORT = 5211
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RED = (200, 60, 50)

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]

MEASURE_JS = """
() => {
  const docY = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
             w: Math.round(r.width), h: Math.round(r.height) };
  };
  const styleOf = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color,
             background: s.backgroundColor, border: `${s.borderWidth} ${s.borderStyle} ${s.borderColor}`,
             borderRadius: s.borderRadius, padding: s.padding, cursor: s.cursor, lineHeight: s.lineHeight };
  };
  const card = document.querySelector(".gp-followup");
  const box = document.querySelector(".gp-followup-input-box");
  const chips = [...document.querySelectorAll(".gp-followup-chip")];
  const groups = document.querySelector(".gp-followup-chips");
  const rect = chips.map(docY);
  return {
    pageH: document.documentElement.scrollHeight,
    viewportH: window.innerHeight,
    chipCount: chips.length,
    chipTexts: chips.map((c) => c.querySelector(".gp-followup-chip-text")?.textContent?.trim() ?? ""),
    chipRects: rect,
    chipStyle: styleOf(chips[0]),
    chipHasArrow: chips.map((c) => Boolean(c.querySelector(".gp-followup-chip-arrow"))),
    chipCursor: chips.map((c) => getComputedStyle(c).cursor),
    chipTagName: chips.map((c) => c.tagName),
    chipAriaLabel: chips.map((c) => c.getAttribute("aria-label")),
    chipTitle: chips.map((c) => c.getAttribute("title")),
    // 相邻胶囊之间的空隙：误触风险的最直接量度
    gaps: rect.slice(1).map((r, i) => {
      const p = rect[i];
      const dy = r.y - (p.y + p.h);
      const dx = r.x - (p.x + p.w);
      return { vertical: dy, horizontal: dx, sameRow: dy < 0 };
    }),
    card: card ? docY(card) : null,
    chipsGroup: groups ? docY(groups) : null,
    inputBox: box ? docY(box) : null,
    // 胶囊底 → 输入框顶 的直线距离（方向 B 要把文字「落进输入框」的视线/手势距离）
    chipToInput: (box && groups)
      ? Math.round(box.getBoundingClientRect().top - groups.getBoundingClientRect().bottom)
      : null,
    sendBtn: styleOf(document.querySelector(".gp-followup-send-btn")),
    // 胶囊底部 → 视口底部：移动端拇指区判断用
    // viewportH 外还要看胶囊在文档中的绝对位置
  };
}
"""

STATE_JS = """
() => {
  const canvas = document.querySelector(".gp-canvas-inner");
  return {
    canvasChildren: canvas ? [...canvas.children].map((el) => (el.className || "").toString().split(" ")[0] || el.tagName) : [],
    conclusionCardPresent: Boolean(document.querySelector(".gp-hero")),
    followupCardPresent: Boolean(document.querySelector(".gp-followup")),
    chipCount: document.querySelectorAll(".gp-followup-chip").length,
    waitingText: document.querySelector(".gp-waiting")?.textContent?.trim() ?? null,
    pageH: document.documentElement.scrollHeight,
    bodyText: document.body.innerText.replace(/\\s+/g, " ").slice(0, 300),
  };
}
"""


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size, index=0)
    raise RuntimeError("no CJK font")


def wrap(text: str, f: ImageFont.FreeTypeFont, draw: ImageDraw.ImageDraw, max_w: int) -> list[str]:
    """按像素宽把一行中文折成多行（逐字累加，遇空格可断）。"""
    lines: list[str] = []
    cur = ""
    for ch in text:
        if draw.textlength(cur + ch, font=f) > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def banner_box(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, size: int,
               x: int, y: int, max_w: int) -> None:
    pad = size // 3
    lines = wrap(text, f, draw, max_w - pad * 2)
    lh = size + 6
    w = max(draw.textlength(line, font=f) for line in lines) + pad * 2
    h = lh * len(lines) + pad * 2
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill=RED)
    for i, line in enumerate(lines):
        draw.text((x + pad, y + pad + i * lh), line, font=f, fill=(255, 255, 255))


def annotate(src: str, dst: str, boxes: list, label_size: int, line: int,
             banner: str | None = None, banner_x: int = 24, banner_y: int = 24) -> None:
    """boxes = [(tag, (x0,y0,x1,y1), soft)]；soft=True 只画细框、不画标签。"""
    img = Image.open(src).convert("RGB")
    draw = ImageDraw.Draw(img)
    f = font(label_size)
    for tag, (x0, y0, x1, y1), soft in boxes:
        draw.rounded_rectangle([x0, y0, x1, y1], radius=10, outline=RED, width=1 if soft else line)
        if tag:
            banner_box(draw, tag, f, label_size, x0, max(0, y0 - label_size - label_size // 3 * 2 - 6),
                       img.width - x0 - 8)
    if banner:
        banner_box(draw, banner, f, label_size, banner_x, banner_y, img.width - banner_x * 2)
    img.save(dst)
    print("saved", dst)


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


def main():
    server = ensure_server()
    measures = {}
    try:
        with sync_playwright() as p:
            for tag, width, height in [("desktop", 1280, 900), ("mobile", 375, 812)]:
                ctx = p.chromium.launch_persistent_context(
                    f"/tmp/chrome-kimi-p5-{tag}",
                    headless=True,
                    executable_path=CHROME,
                    viewport={"width": width, "height": height},
                )
                page = ctx.pages[0] if ctx.pages else ctx.new_page()

                # 取证不花钱：从页面创建起就拦住 /api/**。
                # 点击前：一律 abort（页面靠 fixture 渲染，不需要这些接口）。
                # 点击后：POST orchestrate-stream 挂住不回 → 画面停在真实生产里点击后的「连接中」态。
                blocked: list[dict] = []
                hold = {"on": False}
                held_routes: list = []

                def handler(route, request):
                    record = {"method": request.method, "url": request.url,
                              "postData": (request.post_data or "")[:800]}
                    if hold["on"] and request.method == "POST" and "orchestrate-stream" in request.url:
                        record["disposition"] = "held (never sent)"
                        blocked.append(record)
                        held_routes.append(route)
                        return  # 不 continue/不 abort/不 fulfill：请求挂住，画面停在连接中
                    record["disposition"] = "aborted"
                    blocked.append(record)
                    route.abort()

                page.route("**/api/**", handler)

                dialogs: list[str] = []
                page.on("dialog", lambda d: (dialogs.append(d.type), d.dismiss()))

                page.goto(f"http://127.0.0.1:{PORT}/?fixture=complete", wait_until="domcontentloaded")
                page.wait_for_selector("[data-gp-phase='complete']", timeout=20000)
                page.wait_for_timeout(1400)

                m = page.evaluate(MEASURE_JS)
                m["dialogsOnLoad"] = list(dialogs)
                full = os.path.join(OUT, f"{tag}-full.png")
                page.screenshot(path=full, full_page=True)
                print("saved", full)

                page.locator(".gp-followup").screenshot(path=os.path.join(OUT, f"{tag}-followup-card.png"))
                page.locator(".gp-followup-suggestions").screenshot(path=os.path.join(OUT, f"{tag}-chips-crop.png"))
                print("saved crops for", tag)

                label = 20 if tag == "mobile" else 26
                boxes = []
                g = m["chipsGroup"]
                if g:
                    boxes.append(("点这里 = 立刻发起新调查（3 个胶囊，任点一个即发）" if tag == "desktop"
                                  else "点这里 = 立刻发起新调查",
                                  (g["x"] - 8, g["y"] - 8, g["x"] + g["w"] + 8, g["y"] + g["h"] + 8), False))
                for r in m["chipRects"]:
                    boxes.append(("", (r["x"] - 2, r["y"] - 2, r["x"] + r["w"] + 2, r["y"] + r["h"] + 2), True))
                annotate(full, os.path.join(OUT, f"{tag}-annotated.png"), boxes, label, 3)

                # —— 点击后 ——
                m["beforeClickState"] = page.evaluate(STATE_JS)
                hold["on"] = True
                chip = page.locator(".gp-followup-chip").first
                chip.scroll_into_view_if_needed()
                page.wait_for_timeout(300)
                chip.click()
                page.wait_for_timeout(200)
                m["afterClickImmediate"] = page.evaluate(STATE_JS)
                page.screenshot(path=os.path.join(OUT, f"{tag}-after-click-immediate.png"))
                print("saved", f"{tag}-after-click-immediate.png")
                page.wait_for_timeout(2500)
                m["afterClickSettled"] = page.evaluate(STATE_JS)
                page.screenshot(path=os.path.join(OUT, f"{tag}-after-click-settled.png"))
                print("saved", f"{tag}-after-click-settled.png")
                annotate(
                    os.path.join(OUT, f"{tag}-after-click-settled.png"),
                    os.path.join(OUT, f"{tag}-after-click-annotated.png"),
                    [], label, 3,
                    banner="点完 1 个胶囊后：结论卡 / 追问卡 / 证据全部消失，只剩这一行"
                    if tag == "desktop" else "点完 1 个胶囊后：整页只剩这一行",
                )
                m["blockedApiRequests"] = blocked
                m["dialogsOnClick"] = list(dialogs)
                measures[tag] = m
                # 取证完成，把挂住的请求显式 abort 掉再关浏览器，避免留下未处理的路由异常。
                for r in held_routes:
                    try:
                        r.abort()
                    except Exception:
                        pass
                held_routes.clear()
                page.wait_for_timeout(120)
                ctx.close()

            # —— 调查中态参照图（纯 fixture，不走网络）——
            ctx = p.chromium.launch_persistent_context(
                "/tmp/chrome-kimi-p5-investigating",
                headless=True,
                executable_path=CHROME,
                viewport={"width": 1280, "height": 900},
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(f"http://127.0.0.1:{PORT}/?fixture=investigating", wait_until="domcontentloaded")
            page.wait_for_selector("[data-gp-phase='investigating']", timeout=20000)
            page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(OUT, "reference-investigating-state.png"))
            print("saved reference-investigating-state.png")
            ctx.close()
    finally:
        if server:
            server.terminate()

    with open(os.path.join(OUT, "measures.json"), "w", encoding="utf-8") as f:
        json.dump(measures, f, ensure_ascii=False, indent=2)
    print("saved measures.json")


if __name__ == "__main__":
    main()
