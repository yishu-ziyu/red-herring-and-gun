#!/usr/bin/env python3
"""Capture Golden Path production screenshots and run real-browser visual gates.

E3 / E10 / E11 / E12 live here: computed style, 44px hit targets, 768 overflow,
scoped reduced-motion. Screenshots are production Golden Path + deterministic
fixtures — not a live SSE run.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image

OUT_DIR = os.path.abspath("docs/design/2026-09-06-mode3-production")
os.makedirs(OUT_DIR, exist_ok=True)
BASE_URL = "http://127.0.0.1:5180"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def make_grayscale(src_path: str, dest_path: str) -> None:
    img = Image.open(src_path).convert("L")
    img.save(dest_path)
    print(f"Saved grayscale: {dest_path}")


def duration_max_ms(value: str) -> float:
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    if not parts:
        return 0.0
    out = []
    for part in parts:
        if part.endswith("ms"):
            out.append(float(part[:-2]))
        elif part.endswith("s"):
            out.append(float(part[:-1]) * 1000.0)
        else:
            out.append(0.0)
    return max(out)


def parse_px(value: str) -> float:
    parts = [p.strip() for p in (value or "").replace("/", " ").split() if p.strip()]
    nums = []
    for part in parts:
        if part.endswith("px"):
            nums.append(float(part[:-2]))
        else:
            try:
                nums.append(float(part))
            except ValueError:
                continue
    return max(nums) if nums else 0.0


def fail(errors: list[str], msg: str) -> None:
    print(f"FAIL: {msg}")
    errors.append(msg)


def start_vite_if_needed():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    is_open = sock.connect_ex(("127.0.0.1", 5180)) == 0
    sock.close()
    if is_open:
        return None
    print("Starting Vite server on port 5180...")
    proc = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1", "--port", "5180"],
        cwd=os.path.abspath("mvp"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    for _ in range(40):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ready = sock.connect_ex(("127.0.0.1", 5180)) == 0
        sock.close()
        if ready:
            break
        time.sleep(0.25)
    else:
        proc.terminate()
        raise RuntimeError("Vite did not start on 5180")
    return proc


def measure_hit_target(page, selector: str) -> dict:
    handle = page.locator(selector)
    handle.wait_for(state="visible")
    box = handle.bounding_box()
    pseudo = page.evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          const before = getComputedStyle(el, '::before');
          const rect = el.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            beforeWidth: before.width,
            beforeHeight: before.height,
          };
        }""",
        selector,
    )
    return {"box": box, "pseudo": pseudo}


def run_gates(browser) -> list[str]:
    errors: list[str] = []

    # --- Desktop 1440: E3 embedded PromptInput + scoped reduced-motion ---
    desktop = browser.new_context(viewport={"width": 1440, "height": 900})
    page = desktop.new_page()
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    page.wait_for_selector(".gp-input-card")
    page.wait_for_selector("[data-prompt-frame]")

    e3 = page.evaluate(
        """() => {
          const card = document.querySelector('.gp-input-card');
          const frame = document.querySelector('[data-prompt-frame]');
          const cs = getComputedStyle(card);
          const fs = getComputedStyle(frame);
          return {
            cardBorderTop: cs.borderTopWidth,
            cardBorderRight: cs.borderRightWidth,
            cardBorderBottom: cs.borderBottomWidth,
            cardBorderLeft: cs.borderLeftWidth,
            cardShadow: cs.boxShadow,
            frameBorderTop: fs.borderTopWidth,
            frameBorderRight: fs.borderRightWidth,
            frameBorderBottom: fs.borderBottomWidth,
            frameBorderLeft: fs.borderLeftWidth,
            frameShadow: fs.boxShadow,
            frameBg: fs.backgroundColor,
          };
        }"""
    )
    print("E3 computed:", json.dumps(e3, ensure_ascii=False))
    for side in ("cardBorderTop", "cardBorderRight", "cardBorderBottom", "cardBorderLeft"):
        if parse_px(e3[side]) < 1:
            fail(errors, f"E3 outer .gp-input-card {side} is {e3[side]}, expected >= 1px")
    if not e3["cardShadow"] or e3["cardShadow"] == "none":
        fail(errors, "E3 outer .gp-input-card box-shadow is none; elevation required")
    for side in ("frameBorderTop", "frameBorderRight", "frameBorderBottom", "frameBorderLeft"):
        if parse_px(e3[side]) != 0:
            fail(errors, f"E3 inner [data-prompt-frame] {side} is {e3[side]}, expected 0")
    if e3["frameShadow"] != "none":
        fail(errors, f"E3 inner frame box-shadow is {e3['frameShadow']}, expected none")
    bg = (e3["frameBg"] or "").replace(" ", "")
    if bg not in ("transparent", "rgba(0,0,0,0)", "rgba(0,0,0,0.0)"):
        fail(errors, f"E3 inner frame background is {e3['frameBg']}, expected transparent")

    page.emulate_media(reduced_motion="reduce")
    motion = page.evaluate(
        """() => {
          const probe = document.createElement('div');
          probe.id = 'gp-scope-probe';
          probe.style.transition = 'opacity 1s linear';
          document.body.appendChild(probe);
          const card = document.querySelector('.gp-input-card');
          return {
            outside: getComputedStyle(probe).transitionDuration,
            inside: card ? getComputedStyle(card).transitionDuration : '',
            shellCount: document.querySelectorAll('.gp-shell').length,
          };
        }"""
    )
    print("E12 reduced-motion:", json.dumps(motion, ensure_ascii=False))
    if duration_max_ms(motion["outside"]) < 900:
        fail(errors, f"E12 probe outside .gp-shell was compressed to {motion['outside']}")
    if duration_max_ms(motion["inside"]) > 1:
        fail(errors, f"E12 .gp-input-card inside shell still animates ({motion['inside']})")
    page.close()
    desktop.close()

    # --- Mobile 390: E10 hit targets + no overflow ---
    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    page_m = mobile.new_page()
    page_m.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    page_m.wait_for_selector("[data-prompt-add]")
    page_m.wait_for_selector("[data-prompt-send]")

    for sel, label in (("[data-prompt-add]", "add"), ("[data-prompt-send]", "send")):
        measured = measure_hit_target(page_m, sel)
        box = measured["box"]
        before_w = parse_px(measured["pseudo"]["beforeWidth"])
        before_h = parse_px(measured["pseudo"]["beforeHeight"])
        print(f"E10 {label}:", json.dumps({"box": box, "before": measured["pseudo"]}, ensure_ascii=False))
        if not box or box["width"] < 44 or box["height"] < 44:
            fail(errors, f"E10 {label} hit target is {box}, expected >= 44×44")
        if abs(before_w - 28) > 0.5 or abs(before_h - 28) > 0.5:
            fail(errors, f"E10 {label} visual disc is {before_w}×{before_h}, expected 28×28")

    overflow_390 = page_m.evaluate(
        """() => {
          const de = document.documentElement;
          const card = document.querySelector('.gp-input-card');
          return {
            scrollWidth: de.scrollWidth,
            clientWidth: de.clientWidth,
            cardRight: card ? card.getBoundingClientRect().right : 0,
          };
        }"""
    )
    print("E10 overflow 390:", json.dumps(overflow_390))
    if overflow_390["scrollWidth"] > overflow_390["clientWidth"] + 1:
        fail(errors, f"E10 390 overflow scrollWidth={overflow_390['scrollWidth']} clientWidth={overflow_390['clientWidth']}")
    page_m.close()
    mobile.close()

    # --- 768: E11 overflow / layout ---
    tablet = browser.new_context(viewport={"width": 768, "height": 1024})
    page_t = tablet.new_page()
    page_t.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    page_t.wait_for_selector(".gp-input-card")
    layout = page_t.evaluate(
        """() => {
          const de = document.documentElement;
          const vw = de.clientWidth;
          const box = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
          };
          return {
            scrollWidth: de.scrollWidth,
            clientWidth: vw,
            topbar: box('.gp-topbar'),
            input: box('.gp-input-card'),
            examples: box('.gp-examples'),
            add: box('[data-prompt-add]'),
            send: box('[data-prompt-send]'),
          };
        }"""
    )
    print("E11 768 layout:", json.dumps(layout, ensure_ascii=False))
    if layout["scrollWidth"] > layout["clientWidth"] + 1:
        fail(errors, f"E11 768 overflow scrollWidth={layout['scrollWidth']} clientWidth={layout['clientWidth']}")
    vw = layout["clientWidth"]
    for name in ("topbar", "input", "examples"):
        rect = layout[name]
        if not rect:
            fail(errors, f"E11 768 missing {name}")
            continue
        if rect["right"] > vw + 1:
            fail(errors, f"E11 768 {name} overflows right={rect['right']} vw={vw}")
    for name in ("add", "send"):
        rect = layout[name]
        if not rect:
            fail(errors, f"E11 768 missing primary control {name}")
            continue
        if rect["width"] <= 0 or rect["height"] <= 0:
            fail(errors, f"E11 768 {name} not accessible")
        if rect["right"] > vw + 1 or rect["left"] < -1:
            fail(errors, f"E11 768 {name} outside viewport {rect}")
    page_t.close()
    tablet.close()

    # --- Content layer editorial (conflict/gap computed, not card) ---
    fx = browser.new_context(viewport={"width": 1440, "height": 900})
    page_f = fx.new_page()
    page_f.goto(f"{BASE_URL}/?fixture=conflict", wait_until="domcontentloaded")
    page_f.wait_for_selector(".gp-conflict", timeout=15000)
    page_f.wait_for_selector(".gp-gaps", timeout=15000)
    editorial = page_f.evaluate(
        """() => {
          const read = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const cs = getComputedStyle(el);
            return {
              background: cs.backgroundColor,
              radius: cs.borderRadius,
              shadow: cs.boxShadow,
              borderTop: cs.borderTopWidth,
              borderRight: cs.borderRightWidth,
              borderBottom: cs.borderBottomWidth,
              borderLeft: cs.borderLeftWidth,
            };
          };
          return {
            conflict: read('.gp-conflict'),
            gaps: read('.gp-gaps'),
          };
        }"""
    )
    print("editorial computed:", json.dumps(editorial, ensure_ascii=False))
    for name, data in editorial.items():
        if not data:
            fail(errors, f"editorial missing {name}")
            continue
        bg = (data["background"] or "").replace(" ", "")
        if bg not in ("transparent", "rgba(0,0,0,0)", "rgba(0,0,0,0.0)"):
            fail(errors, f"{name} background is {data['background']}, expected transparent")
        if parse_px(data["radius"]) != 0:
            fail(errors, f"{name} border-radius is {data['radius']}")
        if data["shadow"] != "none":
            fail(errors, f"{name} box-shadow is {data['shadow']}")
        if parse_px(data["borderRight"]) != 0 or parse_px(data["borderBottom"]) != 0:
            fail(errors, f"{name} still has a full box border {data}")
    page_f.close()
    fx.close()

    return errors


def capture_screenshots(browser) -> None:
    context_desktop = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context_desktop.new_page()

    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    page.wait_for_selector(".gp-input-card")
    time.sleep(0.4)
    desktop_input_path = os.path.join(OUT_DIR, "desktop-input.png")
    page.screenshot(path=desktop_input_path)
    print(f"Captured {desktop_input_path}")
    make_grayscale(desktop_input_path, os.path.join(OUT_DIR, "desktop-input-grayscale.png"))

    page.goto(f"{BASE_URL}/?fixture=investigating", wait_until="domcontentloaded")
    page.wait_for_selector(".gp-claim", timeout=15000)
    time.sleep(0.5)
    desktop_investigating_path = os.path.join(OUT_DIR, "desktop-investigating-shell.png")
    page.screenshot(path=desktop_investigating_path)
    print(f"Captured {desktop_investigating_path}")

    page.goto(f"{BASE_URL}/?fixture=conflict", wait_until="domcontentloaded")
    page.wait_for_selector(".gp-conflict", timeout=15000)
    page.wait_for_selector(".gp-gaps", timeout=15000)
    time.sleep(0.4)
    conflict_path = os.path.join(OUT_DIR, "desktop-investigating-conflict-gap.png")
    page.screenshot(path=conflict_path, full_page=True)
    print(f"Captured {conflict_path} (production Golden Path + deterministic fixture, not live SSE)")
    page.close()
    context_desktop.close()

    context_mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    page_m = context_mobile.new_page()
    page_m.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    page_m.wait_for_selector(".gp-input-card")
    time.sleep(0.4)
    mobile_input_path = os.path.join(OUT_DIR, "mobile-input.png")
    page_m.screenshot(path=mobile_input_path)
    print(f"Captured {mobile_input_path}")
    make_grayscale(mobile_input_path, os.path.join(OUT_DIR, "mobile-input-grayscale.png"))
    page_m.close()
    context_mobile.close()


def run(gate_only: bool) -> int:
    proc = start_vite_if_needed()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=CHROME)
            errors = run_gates(browser)
            if not gate_only:
                capture_screenshots(browser)
            browser.close()
    finally:
        if proc:
            proc.terminate()
            proc.wait()

    if errors:
        print(f"\nGATE FAILED ({len(errors)}):")
        for item in errors:
            print(f" - {item}")
        return 1
    print("\nGATE PASS: E3 computed-style, E10 44px hit targets, E11 768 overflow, E12 scoped reduced-motion")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate-only", action="store_true", help="Run browser assertions without rewriting screenshots")
    args = parser.parse_args()
    sys.exit(run(gate_only=args.gate_only))
