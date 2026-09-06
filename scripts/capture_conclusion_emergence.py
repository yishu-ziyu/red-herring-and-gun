#!/usr/bin/env python3
"""Capture Golden Path Conclusion Emergence evidence on port 5184.

Fixture-driven production components only. Real SSE investigating → complete
is left to Issue #66. Do not rewrite capture_mode3_production.py.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image

PORT = 5184
BASE_URL = f"http://127.0.0.1:{PORT}"
OUT_DIR = os.path.abspath("docs/design/2026-09-06-conclusion-emergence")
FRAMES_DIR = os.path.join(OUT_DIR, "frames")
REDUCED_FRAMES_DIR = os.path.join(OUT_DIR, "frames-reduced-motion")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def fail(errors: list[str], msg: str) -> None:
    print(f"FAIL: {msg}")
    errors.append(msg)


def start_vite_if_needed():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    is_open = sock.connect_ex(("127.0.0.1", PORT)) == 0
    sock.close()
    if is_open:
        print(f"Reusing existing listener on {PORT}")
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


def write_gif(paths: list[str], dest: str, duration_ms: int = 80) -> None:
    frames = [Image.open(p).convert("P", palette=Image.ADAPTIVE) for p in paths if os.path.exists(p)]
    if not frames:
        raise RuntimeError(f"no frames for {dest}")
    frames[0].save(
        dest,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
    )
    print(f"Saved gif: {dest} ({len(frames)} frames)")


def capture_frames(page, dest_dir: str, prefix: str, n: int = 12, interval_ms: int = 40) -> list[str]:
    os.makedirs(dest_dir, exist_ok=True)
    paths = []
    for i in range(n):
        path = os.path.join(dest_dir, f"{prefix}-{i:02d}.png")
        page.screenshot(path=path, full_page=False)
        paths.append(path)
        page.wait_for_timeout(interval_ms)
    return paths


def run_gates(page) -> list[str]:
    errors: list[str] = []
    identity = page.evaluate(
        """() => {
          const region = document.querySelector('[data-gp-conclusion-region]');
          const answer = document.querySelector('[data-gp-direct-answer]');
          const hero = document.querySelector('.gp-hero');
          const cs = hero ? getComputedStyle(hero) : null;
          const acs = answer ? getComputedStyle(answer) : null;
          const j = document.querySelector('[data-gp-judgment]');
          const jcs = j ? getComputedStyle(j) : null;
          const b = document.querySelector('[data-gp-boundaries]');
          return {
            hasRegion: Boolean(region),
            state: region && region.getAttribute('data-gp-conclusion-state'),
            answer: answer && answer.textContent,
            answerSize: acs && parseFloat(acs.fontSize),
            answerWeight: acs && acs.fontWeight,
            judgmentSize: jcs && parseFloat(jcs.fontSize),
            heroBg: cs && cs.backgroundColor,
            heroRadius: cs && cs.borderRadius,
            heroShadow: cs && cs.boxShadow,
            boundaryRole: b && b.getAttribute('role'),
            kicker: Boolean(document.querySelector('.gp-hero-kicker')),
            emergeToken: getComputedStyle(document.documentElement).getPropertyValue('--gp-motion-emerge').trim(),
          };
        }"""
    )
    print("complete gate:", identity)
    if not identity["hasRegion"]:
        fail(errors, "complete missing [data-gp-conclusion-region]")
    if identity["state"] != "complete":
        fail(errors, f"complete region state is {identity['state']}")
    if not identity["answer"]:
        fail(errors, "complete missing directAnswer")
    if identity["kicker"]:
        fail(errors, "complete still shows .gp-hero-kicker")
    if identity["answerSize"] and identity["judgmentSize"] and identity["answerSize"] <= identity["judgmentSize"]:
        fail(errors, f"directAnswer {identity['answerSize']}px is not larger than judgment {identity['judgmentSize']}px")
    if identity["heroShadow"] not in (None, "none"):
        fail(errors, f"hero box-shadow is {identity['heroShadow']}; conclusion must not be a result card")
    if identity["boundaryRole"] in ("alert", "warning"):
        fail(errors, f"boundary role is {identity['boundaryRole']}")
    if identity["emergeToken"] != "320ms":
        fail(errors, f"--gp-motion-emerge is {identity['emergeToken']}, expected 320ms")
    return errors


def capture(browser) -> list[str]:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(FRAMES_DIR, exist_ok=True)
    os.makedirs(REDUCED_FRAMES_DIR, exist_ok=True)
    errors: list[str] = []

    desktop = browser.new_context(viewport={"width": 1440, "height": 900})
    page = desktop.new_page()

    page.goto(f"{BASE_URL}/?fixture=investigating", wait_until="domcontentloaded")
    page.wait_for_selector("[data-gp-conclusion-region]", state="attached", timeout=15000)
    page.wait_for_selector(".gp-claim", timeout=15000)
    page.wait_for_timeout(400)
    investigating = page.evaluate(
        """() => {
          const region = document.querySelector('[data-gp-conclusion-region]');
          const r = region.getBoundingClientRect();
          return {
            state: region.getAttribute('data-gp-conclusion-state'),
            hidden: region.getAttribute('aria-hidden'),
            height: r.height,
            hasAnswer: Boolean(region.querySelector('[data-gp-direct-answer]')),
            text: (region.textContent || '').trim(),
          };
        }"""
    )
    print("investigating gate:", investigating)
    if investigating["state"] != "pending":
        fail(errors, f"investigating region state is {investigating['state']}")
    if investigating["hasAnswer"]:
        fail(errors, "investigating pre-rendered directAnswer")
    if investigating["text"]:
        fail(errors, "investigating region is not empty")
    if investigating["height"] > 8:
        fail(errors, f"investigating region height {investigating['height']} takes obvious space")
    inv_path = os.path.join(OUT_DIR, "conclusion-investigating.png")
    page.screenshot(path=inv_path, full_page=True)
    print(f"Captured {inv_path}")
    page.close()
    desktop.close()

    motion_ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        record_video_dir=OUT_DIR,
        record_video_size={"width": 1440, "height": 900},
    )
    motion_page = motion_ctx.new_page()
    motion_page.goto(f"{BASE_URL}/?fixture=complete", wait_until="domcontentloaded")
    motion_page.wait_for_selector(".gp-claim", timeout=15000)
    # fixture: investigating ~60ms, judging ~360ms, complete snapshot ~900ms.
    motion_page.wait_for_timeout(650)
    frame_paths = capture_frames(motion_page, FRAMES_DIR, "emergence", n=18, interval_ms=40)
    motion_page.wait_for_selector("[data-gp-direct-answer]", timeout=15000)
    motion_page.wait_for_timeout(400)
    complete_path = os.path.join(OUT_DIR, "conclusion-complete.png")
    motion_page.screenshot(path=complete_path, full_page=True)
    print(f"Captured {complete_path}")
    errors.extend(run_gates(motion_page))
    video = motion_page.video
    motion_page.close()
    webm = video.path() if video else None
    motion_ctx.close()
    if webm and os.path.exists(webm):
        dest_webm = os.path.join(OUT_DIR, "conclusion-emergence.webm")
        os.replace(webm, dest_webm)
        print(f"Saved video: {dest_webm}")
        gif = os.path.join(OUT_DIR, "conclusion-emergence.gif")
        write_gif(frame_paths, gif, duration_ms=70)
        mp4 = os.path.join(OUT_DIR, "conclusion-emergence.mp4")
        ffmpeg = subprocess.run(
            [
                "ffmpeg", "-y", "-i", dest_webm,
                "-vf", "fps=12,scale=960:-1",
                "-an", mp4,
            ],
            capture_output=True,
            text=True,
        )
        if ffmpeg.returncode != 0:
            print("ffmpeg mp4 skipped:", (ffmpeg.stderr or "")[-400:])
        else:
            print(f"Saved mp4: {mp4}")
    else:
        write_gif(frame_paths, os.path.join(OUT_DIR, "conclusion-emergence.gif"), duration_ms=80)

    reduced = browser.new_context(
        viewport={"width": 1440, "height": 900},
        reduced_motion="reduce",
        record_video_dir=OUT_DIR,
        record_video_size={"width": 1440, "height": 900},
    )
    rpage = reduced.new_page()
    rpage.emulate_media(reduced_motion="reduce")
    rpage.goto(f"{BASE_URL}/?fixture=complete", wait_until="domcontentloaded")
    rpage.wait_for_selector(".gp-claim", timeout=15000)
    rpage.wait_for_timeout(650)
    reduced_frames = capture_frames(rpage, REDUCED_FRAMES_DIR, "reduced", n=14, interval_ms=40)
    rpage.wait_for_selector("[data-gp-direct-answer]", timeout=15000)
    opacity = rpage.evaluate(
        """() => {
          const el = document.querySelector('[data-gp-direct-answer]');
          return el ? getComputedStyle(el).opacity : null;
        }"""
    )
    print("reduced-motion answer opacity:", opacity)
    if opacity not in ("1", "1.0"):
        fail(errors, f"reduced-motion directAnswer opacity is {opacity}, expected 1")
    reduced_path = os.path.join(OUT_DIR, "conclusion-reduced-motion-complete.png")
    rpage.screenshot(path=reduced_path, full_page=True)
    print(f"Captured {reduced_path}")
    rvideo = rpage.video
    rpage.close()
    rwebm = rvideo.path() if rvideo else None
    reduced.close()
    if rwebm and os.path.exists(rwebm):
        dest = os.path.join(OUT_DIR, "conclusion-reduced-motion.webm")
        os.replace(rwebm, dest)
        print(f"Saved video: {dest}")
    write_gif(reduced_frames, os.path.join(OUT_DIR, "conclusion-reduced-motion.gif"), duration_ms=80)

    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    mpage = mobile.new_page()
    mpage.goto(f"{BASE_URL}/?fixture=complete", wait_until="domcontentloaded")
    mpage.wait_for_selector("[data-gp-direct-answer]", timeout=15000)
    mpage.wait_for_timeout(400)
    mobile_path = os.path.join(OUT_DIR, "conclusion-mobile-complete.png")
    mpage.screenshot(path=mobile_path, full_page=True)
    print(f"Captured {mobile_path}")
    overflow = mpage.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")
    print("mobile overflow:", overflow)
    if overflow["sw"] > overflow["cw"] + 1:
        fail(errors, f"mobile 390 horizontal overflow scrollWidth={overflow['sw']} clientWidth={overflow['cw']}")
    mpage.close()
    mobile.close()

    required = [
        "conclusion-investigating.png",
        "conclusion-complete.png",
        "conclusion-mobile-complete.png",
        "conclusion-reduced-motion-complete.png",
        "conclusion-emergence.gif",
        "conclusion-reduced-motion.gif",
    ]
    for name in required:
        path = os.path.join(OUT_DIR, name)
        if not os.path.exists(path) or os.path.getsize(path) < 100:
            fail(errors, f"missing or tiny evidence file: {name}")
    return errors


def main() -> int:
    proc = start_vite_if_needed()
    try:
        with sync_playwright() as p:
            launch_kwargs = {"headless": True}
            if os.path.exists(CHROME):
                launch_kwargs["executable_path"] = CHROME
            browser = p.chromium.launch(**launch_kwargs)
            errors = capture(browser)
            browser.close()
    finally:
        if proc:
            proc.terminate()
            proc.wait()
    if errors:
        print("CAPTURE FAILED:")
        for e in errors:
            print(" -", e)
        return 1
    print("CAPTURE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
