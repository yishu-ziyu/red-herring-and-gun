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
OUT = Path("docs/design/2026-09-06-mode3-production/final/real-after-74").resolve()
SNAP = OUT / "snapshots"
MOTION = OUT / "motion"
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

    def url_of(snap: dict, source_id: str) -> str:
        for src in snap.get("sources") or []:
            if src.get("id") == source_id:
                return str(src.get("url") or "")
        return ""

    def id_of(snap: dict, url: str) -> str | None:
        for src in snap.get("sources") or []:
            if src.get("url") == url:
                return str(src.get("id"))
        return None

    transition = None
    inv_roles: dict[tuple[str, str], str] = {}
    inv_ids: dict[str, dict[str, str]] = {}
    for claim in investigating.get("claims") or []:
        cid = str(claim.get("id") or "")
        for link in claim.get("evidence") or []:
            sid = str(link.get("sourceId") or "")
            inv_roles[(cid, url_of(investigating, sid))] = str(link.get("role") or "")
            inv_ids.setdefault(cid, {})[url_of(investigating, sid)] = sid
    for claim in judging.get("claims") or []:
        cid = str(claim.get("id") or "")
        for link in claim.get("evidence") or []:
            sid = str(link.get("sourceId") or "")
            url = url_of(judging, sid)
            prev = inv_roles.get((cid, url))
            if prev == "unassessed" and link.get("role") == "support":
                transition = {
                    "claimId": cid,
                    "url": url,
                    "fromId": inv_ids.get(cid, {}).get(url),
                    "toId": sid,
                    "from": prev,
                    "to": link.get("role"),
                }
                break
        if transition:
            break
    print("URL transition", transition)

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
        from_id = (transition or {}).get("fromId") or "src-1"
        to_id = (transition or {}).get("toId") or "src-1"
        claim_id = (transition or {}).get("claimId") or "claim-1"
        pin = page.evaluate(
            """({ claimId, fromId }) => {
              const el = document.querySelector('[data-gp-claim-id="' + claimId + '"] [data-source-id="' + fromId + '"]');
              window.__settled = el;
              return {
                role: el && el.getAttribute('data-gp-role'),
                identity: el && el.getAttribute('data-gp-identity'),
                key: el && el.getAttribute('data-gp-evidence-key'),
                sourceId: fromId,
              };
            }""",
            {"claimId": claim_id, "fromId": from_id},
        )
        print("pin", pin)
        shot(page, "desktop-real-investigating-unassessed.png")
        for i in range(18):
            page.screenshot(path=str(FRAMES / f"real-settling-{i:02d}.png"), full_page=False)
            page.wait_for_timeout(90)
        page.wait_for_function(
            """({ claimId, toId }) => document.querySelector('[data-gp-claim-id="' + claimId + '"] [data-source-id="' + toId + '"]')?.getAttribute('data-gp-role') === 'support'""",
            arg={"claimId": claim_id, "toId": to_id},
            timeout=8000,
        )
        same = page.evaluate(
            """({ claimId, toId }) => {
              const el = document.querySelector('[data-gp-claim-id="' + claimId + '"] [data-source-id="' + toId + '"]');
              return {
                same: el === window.__settled,
                role: el && el.getAttribute('data-gp-role'),
                identity: el && el.getAttribute('data-gp-identity'),
                sourceId: toId,
              };
            }""",
            {"claimId": claim_id, "toId": to_id},
        )
        print("after", same)
        ids_stable = from_id == to_id
        (OUT / "settling-dom.json").write_text(
            json.dumps(
                {"transition": transition, "pin": pin, "after": same, "sourceIdsStable": ids_stable},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if ids_stable and same.get("same") is not True:
            errors.append("stable sourceId remounted during REAL snapshot replay")
        if same.get("role") != "support":
            errors.append(f"settled role {same.get('role')}")
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
