#!/usr/bin/env python3
"""Replay THIS run's REAL SSE snapshots through production Golden Path.

This is NOT a second live orchestrate. Snapshots came from the live #66 post-#76 run.
Label: REAL SNAPSHOT REPLAY.

Uses the #77 semantic source-identity gate. Same sourceId pointing at different
URLs is not a transition. sourceIdsStable=false or DOM before !== after fails
the final gate.json — it cannot stay PASS.
"""
from __future__ import annotations

import json
import socket
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from investigation_source_identity_gate import SETTLED_ROLES, evaluate_source_identity_gate

PORT = 5186
BASE = f"http://127.0.0.1:{PORT}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = Path("docs/design/2026-09-06-mode3-production/final/real-after-76").resolve()
SNAP = OUT / "snapshots"
MOTION = OUT / "motion"
FRAMES = MOTION / "frames"
PENDING_DOM = "Evidence DOM before === after not proven on live stream"


def load(name: str) -> dict:
    return json.loads((SNAP / name).read_text(encoding="utf-8"))


def load_numbered() -> list[dict]:
    rows = []
    for path in sorted(SNAP.glob("0*.json")):
        rows.append(json.loads(path.read_text(encoding="utf-8")))
    return rows


def shot(page, name: str) -> None:
    dest = OUT / name
    page.screenshot(path=str(dest), full_page=True)
    print(f"Saved REAL SNAPSHOT REPLAY: {dest.name}")


def open_replay(page, frames: list[dict]) -> None:
    page.add_init_script(f"window.__RHG_REPLAY = {json.dumps({'frames': frames}, ensure_ascii=False)};")
    page.goto(f"{BASE}/?fixture=replay", wait_until="domcontentloaded")
    page.set_viewport_size({"width": 1440, "height": 900})


def role_of(snapshot: dict, claim_id: str, source_id: str) -> str | None:
    for claim in snapshot.get("claims") or []:
        if str(claim.get("id") or "") != claim_id:
            continue
        for link in claim.get("evidence") or []:
            if str(link.get("sourceId") or "") == source_id:
                return str(link.get("role") or "")
    return None


def pair_for_transition(snapshots: list[dict], transition: dict) -> tuple[dict | None, dict | None]:
    claim_id = str(transition.get("claimId") or "")
    source_id = str(transition.get("sourceId") or "")
    before = None
    after = None
    for snapshot in snapshots:
        role = role_of(snapshot, claim_id, source_id)
        if role == "unassessed":
            before = snapshot
        elif before is not None and role in SETTLED_ROLES and after is None:
            after = snapshot
            break
    return before, after


def finalize_gate(errors: list[str], settling: dict) -> None:
    gate_path = OUT / "gate.json"
    live = {"ok": True, "errors": []}
    if gate_path.exists():
        live = json.loads(gate_path.read_text(encoding="utf-8"))
    merged: list[str] = list(live.get("errors") or [])
    same = (settling.get("after") or {}).get("same")
    if same is True:
        merged = [item for item in merged if PENDING_DOM not in item]
    else:
        merged.append("settling-dom.json same:false — final gate must FAIL")
    if settling.get("sourceIdsStable") is False:
        if "sourceIdsStable=false" not in merged:
            merged.append("sourceIdsStable=false")
    for item in errors:
        if item not in merged:
            merged.append(item)
    payload = {
        "ok": len(merged) == 0,
        "errors": merged,
        "settlingDomSame": same,
        "sourceIdsStable": settling.get("sourceIdsStable"),
        "transition": settling.get("transition"),
    }
    gate_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("FINAL GATE", "PASS" if payload["ok"] else "FAIL")
    for item in merged:
        print(" -", item)


def main() -> int:
    if not socket.socket().connect_ex(("127.0.0.1", PORT)) == 0:
        print("Vite 5186 is not up")
        return 1
    if not SNAP.exists():
        print(f"missing snapshots at {SNAP}")
        return 1

    snaps = load_numbered()
    identity = evaluate_source_identity_gate(snaps, require_transition=True)
    transition = identity.get("transition")
    print("identity gate", json.dumps(identity, ensure_ascii=False))
    errors: list[str] = []
    if not identity.get("ok"):
        errors.extend(identity.get("errors") or [])
    if identity.get("sourceIdsStable") is False:
        errors.append("sourceIdsStable=false")
    if not transition:
        errors.append("no observable unassessed→role transition for the same URL and sourceId")
        (OUT / "settling-dom.json").write_text(
            json.dumps(
                {
                    "transition": None,
                    "pin": None,
                    "after": {"same": False},
                    "sourceIdsStable": identity.get("sourceIdsStable"),
                    "identityGate": identity,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        finalize_gate(errors, {"after": {"same": False}, "sourceIdsStable": identity.get("sourceIdsStable")})
        return 1

    before_snap, after_snap = pair_for_transition(snaps, transition)
    if before_snap is None or after_snap is None:
        errors.append("could not pair unassessed and settled snapshots for the semantic transition")
        finalize_gate(errors, {"after": {"same": False}, "sourceIdsStable": identity.get("sourceIdsStable"), "transition": transition})
        return 1

    decomposed = next((s for s in snaps if s.get("phase") == "decomposed"), None)
    complete = load("complete.json") if (SNAP / "complete.json").exists() else next((s for s in reversed(snaps) if s.get("phase") == "complete"), after_snap)
    FRAMES.mkdir(parents=True, exist_ok=True)

    claim_id = str(transition["claimId"])
    source_id = str(transition["sourceId"])
    settled_role = str(transition["to"])

    pin = {}
    same = {"same": False}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME, args=["--disable-dev-shm-usage"])

        if decomposed:
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
                {"delayMs": 80, "investigation": before_snap},
                {"delayMs": 1600, "investigation": after_snap},
            ],
        )
        page.wait_for_selector(
            f'[data-gp-claim-id="{claim_id}"] [data-source-id="{source_id}"][data-gp-role="unassessed"]',
            timeout=10000,
        )
        page.wait_for_timeout(200)
        pin = page.evaluate(
            """({ claimId, sourceId }) => {
              const el = document.querySelector('[data-gp-claim-id="' + claimId + '"] [data-source-id="' + sourceId + '"]');
              window.__settled = el;
              return {
                role: el && el.getAttribute('data-gp-role'),
                identity: el && el.getAttribute('data-gp-identity'),
                key: el && el.getAttribute('data-gp-evidence-key'),
                sourceId,
              };
            }""",
            {"claimId": claim_id, "sourceId": source_id},
        )
        print("pin", pin)
        shot(page, "desktop-real-investigating-unassessed.png")
        for i in range(18):
            page.screenshot(path=str(FRAMES / f"real-settling-{i:02d}.png"), full_page=False)
            page.wait_for_timeout(90)
        page.wait_for_function(
            """({ claimId, sourceId, role }) => document.querySelector('[data-gp-claim-id="' + claimId + '"] [data-source-id="' + sourceId + '"]')?.getAttribute('data-gp-role') === role""",
            arg={"claimId": claim_id, "sourceId": source_id, "role": settled_role},
            timeout=8000,
        )
        same = page.evaluate(
            """({ claimId, sourceId }) => {
              const el = document.querySelector('[data-gp-claim-id="' + claimId + '"] [data-source-id="' + sourceId + '"]');
              return {
                same: el === window.__settled,
                role: el && el.getAttribute('data-gp-role'),
                identity: el && el.getAttribute('data-gp-identity'),
                sourceId,
                key: el && el.getAttribute('data-gp-evidence-key'),
              };
            }""",
            {"claimId": claim_id, "sourceId": source_id},
        )
        print("after", same)
        settling = {
            "transition": {
                "claimId": claim_id,
                "sourceId": source_id,
                "url": transition.get("url"),
                "fromId": source_id,
                "toId": source_id,
                "from": transition.get("from"),
                "to": settled_role,
                "atPhase": transition.get("atPhase"),
            },
            "pin": pin,
            "after": same,
            "sourceIdsStable": identity.get("sourceIdsStable"),
            "identityGate": identity,
        }
        (OUT / "settling-dom.json").write_text(json.dumps(settling, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if identity.get("sourceIdsStable") is not True:
            errors.append("sourceIdsStable=false")
        if same.get("same") is not True:
            errors.append("semantic transition remounted during REAL snapshot replay (before !== after)")
        if same.get("role") != settled_role:
            errors.append(f"settled role {same.get('role')} expected {settled_role}")
        if pin.get("sourceId") != source_id or same.get("sourceId") != source_id:
            errors.append("replay used a different sourceId than the semantic transition")
        shot(page, "desktop-real-judging-settled.png")
        ctx.close()

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        open_replay(
            page,
            [
                {"delayMs": 60, "investigation": after_snap},
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

    finalize_gate(errors, settling)
    return 1 if errors or same.get("same") is not True else 0


if __name__ == "__main__":
    sys.exit(main())
