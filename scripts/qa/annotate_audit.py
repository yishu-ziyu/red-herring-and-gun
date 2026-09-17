#!/usr/bin/env python3
"""把审查发现圈注到整页截图上，输出 annotated-*.png。"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.abspath("docs/reports/2026-09-12-page-audit")
RED = (200, 60, 50)

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size, index=0)
    raise RuntimeError("no CJK font")


def annotate(src: str, dst: str, boxes: list[tuple[str, tuple[int, int, int, int]]], label_size: int, line: int) -> None:
    img = Image.open(src).convert("RGB")
    draw = ImageDraw.Draw(img)
    f = font(label_size)
    for tag, (x0, y0, x1, y1) in boxes:
        draw.rounded_rectangle([x0, y0, x1, y1], radius=10, outline=RED, width=line)
        # 标签 chip 挂在框左上角外侧
        tw = draw.textlength(tag, font=f)
        pad = label_size // 3
        cx0, cy0 = x0, max(0, y0 - label_size - pad * 2)
        draw.rounded_rectangle([cx0, cy0, cx0 + tw + pad * 2, cy0 + label_size + pad * 2], radius=8, fill=RED)
        draw.text((cx0 + pad, cy0 + pad - 1), tag, font=f, fill=(255, 255, 255))
    img.save(dst)
    print("saved", dst)


# (x0, y0, x1, y1) 为原图像素坐标；标注前先按整页缩略图估算，生成后人工核对再调。
MOBILE = [
    ("P0 来源条竖排吃光首屏", (18, 300, 357, 610)),
    ("P1 结论短语拦腰断行", (25, 635, 350, 790)),
    ("P5 胶囊点击即发送", (15, 1075, 360, 1250)),
    ("P4a 重新调查①", (30, 1305, 200, 1355)),
    ("P2 案卷条折行堆叠", (12, 1425, 363, 1545)),
    ("P3a 域名悬空", (150, 1945, 372, 2090)),
    ("P3b 域名悬空", (150, 2470, 372, 2660)),
    ("P4b 重新调查②", (15, 3110, 160, 3165)),
]

DESKTOP = [
    ("P0? 桌面端默认展开 待裁决", (200, 200, 1080, 388)),
    ("P4a 重新调查①", (215, 928, 312, 986)),
    ("P3a 域名悬空", (955, 1400, 1105, 1560)),
    ("P3b 域名悬空", (955, 1780, 1115, 1950)),
    ("P4b 重新调查②", (60, 2320, 175, 2360)),
]

annotate(os.path.join(BASE, "page-mobile.png"), os.path.join(BASE, "annotated-mobile.png"), MOBILE, 24, 4)
annotate(os.path.join(BASE, "page-desktop.png"), os.path.join(BASE, "annotated-desktop.png"), DESKTOP, 26, 4)
