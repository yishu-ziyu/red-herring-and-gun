#!/usr/bin/env python3
"""Replay REAL SSE snapshots through production Golden Path (DEV fixture=replay).

This is NOT a second live orchestrate. Snapshots came from the live #66 run.
Label: REAL SNAPSHOT REPLAY.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

PORT = 5186
BASE = f"http://127.0.0.1:{PORT}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = Path("docs/design/2026-09-06-mode3-production/final").resolve()
SNAP = OUT / "real/snapshots"
MOTION = OUT / "real/motion"
FRAMES = MOTION / "frames"


def load(name: str) -> dict:
    return json.loads((SNAP / name).read_text(encoding="utf-8"))


def shot(page, name: str) -> None:
    dest = OUT / name
    page.screenshot(path=str(dest), full_page=True)
    print(f"Saved REAL SNAPSHOT REPLAY: {dest.name}")


def open_replay(page, frames: list[dict]) -> None:
    page.add_init_script(f"window.__RHG_REPLAY = {json.dumps({'frames': frames}, ensure_ascii=False)};")
    page.goto(f"{BASE}/?fixture=replay", wait_until="domcontentloaded")
    page.set_viewport_size({"width": 1440, "height": 900})


def main() -> int:
    if not socket.socket().connect_ex(("127.0.0.1", PORT)) == 0:
        print("Vite 5186 is not up")
        return 1
    decomposed = load("02-decomposed.json")
    investigating = load("05-investigating-5.json")
    judging = load("06-judging.json")
    complete = load("complete.json")
    FRAMES.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME, args=["--disable-dev-shm-usage"])

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        open_replay(page, [{"delayMs": 80, "investigation": decomposed}])
        page.wait_for_selector('.gp-canvas[data-gp-phase="decomposed"]', timeout=10000)
        page.wait_for_timeout(250)
        shot(page, "desktop-real-decomposed.png")
        ctx.close()

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        open_replay(
            page,
            [
                {"delayMs": 80, "investigation": investigating},
                {"delayMs": 1600, "investigation": judging},
            ],
        )
        page.wait_for_selector('[data-gp-role="unassessed"]', timeout=10000)
        page.wait_for_timeout(200)
        pin = page.evaluate(
            """() => {
              const el = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]');
              window.__src1 = el;
              return {
                role: el && el.getAttribute('data-gp-role'),
                identity: el && el.getAttribute('data-gp-identity'),
                key: el && el.getAttribute('data-gp-evidence-key'),
              };
            }"""
        )
        print("pin src-1", pin)
        shot(page, "desktop-real-investigating-unassessed.png")
        for i in range(18):
            page.screenshot(path=str(FRAMES / f"real-settling-{i:02d}.png"), full_page=False)
            page.wait_for_timeout(90)
        page.wait_for_function(
            """() => document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]')?.getAttribute('data-gp-role') === 'support'""",
            timeout=8000,
        )
        same = page.evaluate(
            """() => {
              const el = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]');
              return {
                same: el === window.__src1,
                role: el && el.getAttribute('data-gp-role'),
                identity: el && el.getAttribute('data-gp-identity'),
              };
            }"""
        )
        print("after src-1", same)
        (OUT / "real/settling-dom.json").write_text(json.dumps({"pin": pin, "after": same}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if same.get("same") is not True:
            errors.append("src-1 remounted during REAL snapshot replay")
        if same.get("role") != "support":
            errors.append(f"src-1 role {same.get('role')}")
        shot(page, "desktop-real-judging-settled.png")
        ctx.close()

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        open_replay(
            page,
            [
                {"delayMs": 60, "investigation": judging},
                {"delayMs": 900, "investigation": complete, "complete": True},
            ],
        )
        page.wait_for_selector("[data-gp-direct-answer]", timeout=10000)
        page.wait_for_timeout(280)
        shot(page, "desktop-real-complete-replay.png")
        ctx.close()
        browser.close()

    from PIL import Image

    frames = sorted(FRAMES.glob("real-settling-*.png"))
    images = [Image.open(p).convert("RGB") for p in frames]
    if images:
        dest = MOTION / "real-settling-replay.gif"
        images[0].save(dest, save_all=True, append_images=images[1:], duration=90, loop=0)
        print(f"Saved gif {dest}")

    print("REPLAY GATE", "FAIL" if errors else "PASS")
    for e in errors:
        print(" -", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
