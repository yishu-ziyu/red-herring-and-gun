#!/usr/bin/env python3
"""Capture Evidence Settling from production Golden Path.

Uses /?fixture=settling (deterministic snapshot replay). This is NOT a live SSE run.
Real SSE evidence is left to issue #66.

Port 5182 is reserved for this agent. Do not use 5180.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/design/2026-09-06-evidence-settling")
FRAME_DIR = os.path.join(OUT_DIR, "frames")
REDUCED_FRAME_DIR = os.path.join(OUT_DIR, "frames-reduced")
os.makedirs(FRAME_DIR, exist_ok=True)
os.makedirs(REDUCED_FRAME_DIR, exist_ok=True)
BASE_URL = "http://127.0.0.1:5182"
PORT = 5182
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


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
        cwd=os.path.abspath("mvp"),
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


def save_gif(frame_paths: list[str], dest: str, duration_ms: int = 70) -> None:
    images = [Image.open(p).convert("RGB") for p in frame_paths if os.path.exists(p)]
    if not images:
        raise RuntimeError(f"no frames for {dest}")
    images[0].save(dest, save_all=True, append_images=images[1:], duration=duration_ms, loop=0)
    print(f"Saved gif: {dest}")


def pin_and_wait(page):
    page.goto(f"{BASE_URL}/?fixture=settling", wait_until="domcontentloaded")
    page.wait_for_selector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="unassessed"]', timeout=8000)
    page.wait_for_selector('[data-gp-group-role="unassessed"]')
    identity = page.evaluate(
        """() => {
          const claim = document.querySelector('[data-gp-claim-id="claim-1"]');
          const nodes = {};
          for (const id of ["src-1", "src-2", "src-3"]) {
            const el = claim.querySelector('[data-source-id="' + id + '"]');
            window["__gp_" + id] = el;
            nodes[id] = { role: el && el.getAttribute("data-gp-role"), present: !!el };
          }
          return nodes;
        }"""
    )
    print("pinned before:", json.dumps(identity, ensure_ascii=False))
    return identity


def collect_frames(page, dest_dir: str, until_selector: str, limit: int = 48) -> list[str]:
    paths: list[str] = []
    board = page.locator(".gp-evidence-board")
    extra = 0
    for i in range(limit):
        path = os.path.join(dest_dir, f"motion-{i:02d}.png")
        board.screenshot(path=path)
        paths.append(path)
        if page.locator(until_selector).count() > 0:
            extra += 1
            if extra >= 10:
                break
        page.wait_for_timeout(40)
    return paths


def capture_motion(browser, reduced: bool, errors: list[str]) -> None:
    label = "reduced" if reduced else "motion"
    video_dir = os.path.join(OUT_DIR, "video-reduced" if reduced else "video")
    os.makedirs(video_dir, exist_ok=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        record_video_dir=video_dir,
        record_video_size={"width": 1440, "height": 900},
    )
    page = context.new_page()
    page.emulate_media(reduced_motion="reduce" if reduced else "no-preference")

    pin_and_wait(page)
    before_path = os.path.join(OUT_DIR, "evidence-before-settling.png" if not reduced else "evidence-before-settling-reduced.png")
    page.locator(".gp-canvas").screenshot(path=before_path)
    print(f"Saved {before_path}")

    dest_dir = REDUCED_FRAME_DIR if reduced else FRAME_DIR
    for leftover in os.listdir(dest_dir):
        os.remove(os.path.join(dest_dir, leftover))

    page.evaluate(
        """() => {
          window.__gpTransforms = [];
          const tick = () => {
            for (const id of ["src-1", "src-2", "src-3"]) {
              const el = window["__gp_" + id];
              if (!el) continue;
              window.__gpTransforms.push({
                id,
                t: getComputedStyle(el).transform,
                role: el.getAttribute("data-gp-role"),
              });
            }
            if (!window.__gpStopSample) requestAnimationFrame(tick);
          };
          window.__gpStopSample = false;
          requestAnimationFrame(tick);
        }"""
    )

    frames = collect_frames(
        page,
        dest_dir,
        '[data-source-id="src-1"][data-gp-role="contradict"]',
    )
    page.wait_for_selector('[data-source-id="src-1"][data-gp-role="contradict"]', timeout=8000)
    page.wait_for_selector('[data-source-id="src-2"][data-gp-role="support"]')
    page.wait_for_selector('[data-source-id="src-3"][data-gp-role="context-only"]')
    page.wait_for_timeout(400)

    after_path = os.path.join(OUT_DIR, "evidence-after-settling.png" if not reduced else "evidence-after-settling-reduced.png")
    page.locator(".gp-canvas").screenshot(path=after_path)
    print(f"Saved {after_path}")

    same = page.evaluate(
        """() => {
          const claim = document.querySelector('[data-gp-claim-id="claim-1"]');
          const out = {};
          for (const id of ["src-1", "src-2", "src-3"]) {
            const now = claim.querySelector('[data-source-id="' + id + '"]');
            out[id] = {
              same: window["__gp_" + id] === now,
              role: now && now.getAttribute("data-gp-role"),
              transform: now ? getComputedStyle(now).transform : null,
            };
          }
          const board = document.querySelector(".gp-evidence-board");
          out.layoutMotion = board && board.getAttribute("data-gp-layout-motion");
          out.supportLabel = (document.querySelector('[data-gp-group-role="support"]') || {}).textContent || "";
          out.contradictLabel = (document.querySelector('[data-gp-group-role="contradict"]') || {}).textContent || "";
          out.contextLabel = (document.querySelector('[data-gp-group-role="context-only"]') || {}).textContent || "";
          out.unassessed = !!document.querySelector('[data-gp-group-role="unassessed"]');
          return out;
        }"""
    )
    print(f"{label} identity:", json.dumps(same, ensure_ascii=False))
    for source_id in ("src-1", "src-2", "src-3"):
        if not same[source_id]["same"]:
            fail(errors, f"{label}: {source_id} remounted (before !== after)")
    expected = {"src-1": "contradict", "src-2": "support", "src-3": "context-only"}
    for source_id, role in expected.items():
        if same[source_id]["role"] != role:
            fail(errors, f"{label}: {source_id} role={same[source_id]['role']} expected {role}")
    if "支持" not in same["supportLabel"]:
        fail(errors, f"{label}: support group missing 支持 text")
    if "反驳" not in same["contradictLabel"]:
        fail(errors, f"{label}: contradict group missing 反驳 text")
    if "相关材料" not in same["contextLabel"]:
        fail(errors, f"{label}: context-only group missing 相关材料 text")
    if same["unassessed"]:
        fail(errors, f"{label}: empty 待核对 group still visible")
    if reduced:
        if same["layoutMotion"] != "off":
            fail(errors, f"reduced-motion layout should be off, got {same['layoutMotion']}")
        transform = (same["src-1"]["transform"] or "none").replace(" ", "")
        if transform not in ("none", "matrix(1,0,0,1,0,0)"):
            fail(errors, f"reduced-motion still translating: {same['src-1']['transform']}")

    extra = page.locator(".gp-evidence-board")
    extra.screenshot(path=os.path.join(dest_dir, "motion-final.png"))
    frames.append(os.path.join(dest_dir, "motion-final.png"))
    gif_name = "evidence-settling-reduced.gif" if reduced else "evidence-settling.gif"
    save_gif(frames, os.path.join(OUT_DIR, gif_name))

    samples = page.evaluate(
        """() => {
          window.__gpStopSample = true;
          return window.__gpTransforms || [];
        }"""
    )
    identity = {"none", "matrix(1, 0, 0, 1, 0, 0)", "matrix(1,0,0,1,0,0)"}
    moving = [s for s in samples if (s.get("t") or "none").replace(" ", "") not in {x.replace(" ", "") for x in identity}]
    print(f"{label} transform samples={len(samples)} moving={len(moving)}")
    if moving:
        print("sample moving", json.dumps(moving[:4], ensure_ascii=False))
    if not reduced and len(moving) == 0:
        fail(errors, "non-reduced settling produced no layout transform samples")
    if reduced and len(moving) > 0:
        fail(errors, f"reduced-motion still translated: {moving[:3]}")

    page.close()
    context.close()
    webms = [os.path.join(video_dir, n) for n in os.listdir(video_dir) if n.endswith(".webm")]
    if webms:
        dest_webm = os.path.join(OUT_DIR, "evidence-settling-reduced.webm" if reduced else "evidence-settling.webm")
        os.replace(webms[0], dest_webm)
        print(f"Saved video: {dest_webm}")
        gif_from_video = os.path.join(OUT_DIR, gif_name)
        ffmpeg = subprocess.run(
            ["ffmpeg", "-y", "-i", dest_webm, "-vf", "fps=16,scale=960:-1", gif_from_video],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if ffmpeg.returncode == 0:
            print(f"Rebuilt gif from video: {gif_from_video}")
        else:
            print("ffmpeg gif rebuild skipped:", ffmpeg.stderr[-200:])


def main() -> int:
    print("NOTE: fixture=?settling is a deterministic production-component replay. It is NOT real SSE (#66).")
    errors: list[str] = []
    proc = start_vite_if_needed()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                executable_path=CHROME if os.path.exists(CHROME) else None,
            )
            capture_motion(browser, reduced=False, errors=errors)
            capture_motion(browser, reduced=True, errors=errors)
            browser.close()
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()

    required = [
        "evidence-before-settling.png",
        "evidence-after-settling.png",
        "evidence-settling.gif",
        "evidence-settling-reduced.gif",
        "README.md",
    ]
    for name in required:
        path = os.path.join(OUT_DIR, name)
        if not os.path.exists(path):
            fail(errors, f"missing {path}")

    if errors:
        print("GATE FAIL")
        for item in errors:
            print(" -", item)
        return 1
    print("GATE PASS (fixture ≠ real SSE)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
