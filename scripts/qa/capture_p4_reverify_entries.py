#!/usr/bin/env python3
"""P4 调查：完成态两处「重新调查」入口的截图证据。

入口 A：追问卡 actions 栏 secondary 按钮（FollowUpSection.tsx:167）
入口 B：页面最底部文字链（原 InvestigationCanvas.tsx:401-407，P4 已删；
本脚本兼容改后状态：linkB 为 None 时自动跳过 P4b 特写与标注）
产物：docs/reports/2026-09-12-p4-reverify-entries/
复用已起的 dev 服务（默认 127.0.0.1:5211，见 docs/NOTES.md），没有则按
capture_page_audit.py 的方式临时起 npx vite。
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import time

from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.abspath("docs/reports/2026-09-12-p4-reverify-entries")
os.makedirs(OUT, exist_ok=True)
PORT = 5211
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RED = (200, 60, 50)

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]

# 骨架 + 两处入口的文档坐标与样式，一次 evaluate 拿全
MEASURE_JS = """
() => {
  const docY = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
             w: Math.round(r.width), h: Math.round(r.height) };
  };
  const canvasInner = document.querySelector(".gp-canvas-inner");
  const skeleton = canvasInner
    ? [...canvasInner.children].map((el) => ({
        cls: (el.className || "").toString().split(" ")[0] || el.tagName,
        top: Math.round(el.getBoundingClientRect().top + window.scrollY),
        h: Math.round(el.getBoundingClientRect().height),
      }))
    : [];
  const btnA = document.querySelector(".gp-followup-actions-bar .gp-action-btn--secondary");
  const btnB = document.querySelector(".gp-result-again .gp-link-btn");
  const styleOf = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color,
             background: s.backgroundColor, border: `${s.borderWidth} ${s.borderStyle} ${s.borderColor}`,
             borderRadius: s.borderRadius, padding: s.padding, textDecoration: s.textDecorationLine };
  };
  return {
    pageH: document.documentElement.scrollHeight,
    viewportH: window.innerHeight,
    claims: document.querySelectorAll(".gp-claims .gp-claim-list > *").length,
    stoppedBlocks: document.querySelectorAll("[data-gp-stopped]").length,
    reverifyButtons: [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "重新调查").length,
    barA: docY(document.querySelector(".gp-followup-actions-bar")),
    linkB: docY(document.querySelector(".gp-result-again")),
    styleA: styleOf(btnA),
    styleB: styleOf(btnB),
    skeleton,
  };
}
"""


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size, index=0)
    raise RuntimeError("no CJK font")


def annotate(src: str, dst: str, boxes: list, label_size: int, line: int) -> None:
    img = Image.open(src).convert("RGB")
    draw = ImageDraw.Draw(img)
    f = font(label_size)
    for tag, (x0, y0, x1, y1) in boxes:
        draw.rounded_rectangle([x0, y0, x1, y1], radius=10, outline=RED, width=line)
        tw = draw.textlength(tag, font=f)
        pad = label_size // 3
        cx0, cy0 = x0, max(0, y0 - label_size - pad * 2)
        draw.rounded_rectangle([cx0, cy0, cx0 + tw + pad * 2, cy0 + label_size + pad * 2], radius=8, fill=RED)
        draw.text((cx0 + pad, cy0 + pad - 1), tag, font=f, fill=(255, 255, 255))
    img.save(dst)
    print("saved", dst)


def crop_from_full(full: str, dst: str, rect: dict, up: int, down: int, page_h: int) -> None:
    img = Image.open(full).convert("RGB")
    x0 = max(0, rect["x"] - 12)
    y0 = max(0, rect["y"] - up)
    x1 = min(img.width, rect["x"] + rect["w"] + 12)
    y1 = min(img.height, page_h, rect["y"] + rect["h"] + down)
    img.crop((x0, y0, x1, y1)).save(dst)
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
                    f"/tmp/chrome-kimi-p4-{tag}",
                    headless=True,
                    executable_path=CHROME,
                    viewport={"width": width, "height": height},
                )
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                page.goto(f"http://127.0.0.1:{PORT}/?fixture=complete", wait_until="domcontentloaded")
                page.wait_for_selector("[data-gp-phase='complete']", timeout=20000)
                page.wait_for_timeout(1200)
                m = page.evaluate(MEASURE_JS)
                measures[tag] = m
                full = os.path.join(OUT, f"{tag}-full.png")
                page.screenshot(path=full, full_page=True)
                print("saved", full)

                # 局部特写：A 用元素自身截图（含复制结论简报并排），B 从整页裁带上下文
                page.locator(".gp-followup-actions-bar").screenshot(
                    path=os.path.join(OUT, f"{tag}-followup-actions-crop.png"))
                print("saved", f"{tag}-followup-actions-crop.png")
                if m["linkB"]:
                    crop_from_full(full, os.path.join(OUT, f"{tag}-bottom-link-crop.png"),
                                   m["linkB"], up=280, down=48, page_h=m["pageH"])

                label = 24 if tag == "mobile" else 26
                boxes = [
                    ("P4a 重新调查① 追问卡 actions", (m["barA"]["x"], m["barA"]["y"],
                     m["barA"]["x"] + m["barA"]["w"], m["barA"]["y"] + m["barA"]["h"])),
                ]
                if m["linkB"]:
                    boxes.append(("P4b 重新调查② 页面底部文字链", (m["linkB"]["x"], m["linkB"]["y"],
                         m["linkB"]["x"] + m["linkB"]["w"], m["linkB"]["y"] + m["linkB"]["h"])))
                annotate(full, os.path.join(OUT, f"{tag}-full-annotated.png"), boxes, label, 4)
                ctx.close()
    finally:
        if server:
            server.terminate()

    with open(os.path.join(OUT, "measures.json"), "w", encoding="utf-8") as f:
        json.dump(measures, f, ensure_ascii=False, indent=2)
    print("saved measures.json")


if __name__ == "__main__":
    main()
