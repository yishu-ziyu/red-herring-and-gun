#!/usr/bin/env python3
"""Browser acceptance of scheme two against a fixed web build and explicit HTTP fixtures.

No model calls. This verifies presentation, SSE consumption and local persistence,
not factual accuracy. Browser plugin not available; use the installed Playwright.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

from playwright.sync_api import sync_playwright

CLAIM = "某市下月所有公交永久免费，政府已增加补贴，部分线路在周末试行免费。"
FIRST_DATE = "2026-09-17T10:00:00.000Z"
SECOND_DATE = "2026-09-17T11:00:00.000Z"


def snapshot(origin: str, claim: str, phase: str, ordinal: int) -> dict:
    texts = ["全市公交下月起永久免费", "政府已增加交通补贴", "部分线路周末试行免费", "试点适用线路", "试点有效日期", "公告是否仍有效", "补贴的具体金额", "其他地区的政策"]
    complete = phase == "complete"
    evidence = phase not in ("received", "decomposed")
    claims = [{"id": f"c{i}", "order": i, "text": text, "checkability": "checkable",
               "progress": "complete" if complete else "searching" if i < 6 else "pending",
               "judgment": "refuted" if complete and i == 0 else "unresolved" if complete else None,
               "evidence": [{"sourceId": "s1", "role": "contradict" if complete else "unassessed", "finding": "验收夹具：通知仅列出试点线路与日期。"}] if evidence and i == 0 else [],
               "gaps": [{"id": f"g{i}", "claimId": f"c{i}", "description": "检索预算未覆盖", "status": "open"}] if complete and i >= 6 else []} for i, text in enumerate(texts)]
    result = {"schemaVersion": 1, "originalClaim": claim, "phase": phase,
              "claims": [] if phase == "received" else claims,
              "sources": [{"id": "s1", "url": f"{origin}/source/notice", "title": "验收用试点通知（模拟材料）", "excerpt": "这是界面验收材料，不是实际政府公告。"}] if evidence else [],
              "conflicts": []}
    if phase != "received":
        result["scope"] = {"includedClaimIds": [f"c{i}" for i in range(6)], "deferredClaimIds": ["c6", "c7"]}
    if complete:
        result["checkedAt"] = FIRST_DATE if ordinal == 1 else SECOND_DATE
        result["conclusion"] = {"directAnswer": "查到的是局部试点，不能据此认定全市公交永久免费。", "judgment": "refuted",
                                "boundaries": ["本结果使用固定验收材料，不是实际政策核查。"], "claimIds": ["c0"], "sourceIds": ["s1"]}
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    web = args.dist.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    runs: list[dict] = []
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def json(self, body, status=200):
            raw = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/api/models/health": return self.json({"status": "available"})
            if path == "/api/models/list": return self.json({"models": [{"provider": "fixture", "model": "fixture"}]})
            if path == "/api/checks/quota": return self.json({"remaining": 20, "total": 20, "used": 0, "kind": "guest"})
            if path == "/api/cases": return self.json({"cases": []})
            if path.startswith("/api/"): return self.json({"authenticated": False}, 401)
            if path == "/source/notice":
                raw = "验收用原文：本页为模拟材料。".encode()
                self.send_response(200); self.send_header("Content-Type", "text/plain; charset=utf-8"); self.end_headers(); self.wfile.write(raw); return
            target = (web / unquote(path).lstrip("/")).resolve()
            if target != web and web not in target.parents: return self.json({}, 403)
            if not target.is_file(): target = web / "index.html"
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.end_headers(); self.wfile.write(target.read_bytes())

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            if self.path.endswith("/cancel"):
                run_id = self.path.split("/")[-2]
                run = next(row for row in runs if row["id"] == run_id)
                run["stopped"] = True; run["release"].set()
                return self.json({"accepted": True, "status": "cancelling"})
            if self.path != "/api/agent/orchestrate-stream": return self.json({}, 404)
            with lock:
                ordinal = len(runs) + 1
                run = {"id": f"qa-run-{ordinal}", "release": threading.Event(), "stopped": False, "payload": payload}
                runs.append(run)
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            def emit(event):
                try:
                    self.wfile.write(("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode()); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            emit({"type": "run_started", "runId": run["id"]})
            claim = str(payload.get("claim", CLAIM))
            current = snapshot(origin, claim, "investigating", ordinal)
            emit({"type": "investigation_snapshot", "investigation": current})
            if not run["release"].wait(45): run["stopped"] = True
            if run["stopped"]:
                current["phase"] = "interrupted"
                emit({"type": "investigation_snapshot", "investigation": current})
                emit({"type": "run_state", "status": "cancelled", "terminal": True})
                return
            final = snapshot(origin, claim, "complete", ordinal)
            emit({"type": "investigation_snapshot", "investigation": final})
            emit({"type": "complete", "finalReport": {"conclusion": final["conclusion"]["directAnswer"], "investigation": final, "checkedAt": final["checkedAt"]}})
            emit({"type": "run_state", "status": "completed", "terminal": True})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin = f"http://127.0.0.1:{server.server_port}"
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    result: dict = {"fixture": True, "origin": origin, "checks": [], "pageErrors": [], "consoleErrors": []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
            page = context.new_page()
            page.on("pageerror", lambda error: result["pageErrors"].append(str(error)))
            page.on("console", lambda message: result["consoleErrors"].append(message.text) if message.type == "error" and not message.text.startswith("Failed to load resource:") else None)
            page.goto(origin, wait_until="domcontentloaded")
            page.get_by_role("textbox", name="要调查的说法").fill(CLAIM)
            page.get_by_role("button", name="开始调查", exact=True).click()
            page.locator('[data-gp-phase="investigating"] [data-gp-scope]').wait_for()
            assert "本轮未覆盖" in page.locator('[data-gp-scope]').inner_text()
            page.screenshot(path=str(out / "01-scope-desktop.png"))
            runs[0]["release"].set()
            page.locator('[data-gp-phase="complete"]').wait_for()
            page.get_by_role("button", name="查看已有依据", exact=True).click()
            assert len(runs) == 1
            page.locator('[data-gp-pill-id]').first.click()
            page.locator('[data-gp-source-close]').click()
            assert len(runs) == 1
            result["checks"].append("existing evidence: no new investigation")
            page.get_by_role("button", name="继续补查", exact=True).click()
            page.locator('.gp-followup-input').fill("请核对补贴金额")
            page.get_by_role("button", name="发送追问", exact=True).click()
            page.locator('[data-gp-thread]').wait_for()
            page.locator('[data-gp-phase="investigating"]').wait_for()
            page.get_by_role("navigation", name="调查轮次").get_by_role("button", name="首次核查", exact=False).click()
            page.locator('[data-gp-phase="complete"]').wait_for()
            assert len(runs) == 2
            page.evaluate("window.scrollTo(0,0)")
            page.screenshot(path=str(out / "02-earlier-round-desktop.png"))
            page.get_by_role("button", name="返回当前轮次", exact=True).click()
            runs[1]["release"].set()
            page.locator('[data-gp-phase="complete"]').wait_for()
            page.wait_for_timeout(350)
            result["checks"].append("earlier round accessible while follow-up is running")
            page.reload(wait_until="domcontentloaded")
            page.get_by_role("button", name="历史", exact=False).click()
            page.locator('.gp-history-item').first.wait_for()
            assert page.locator('.gp-history-item').count() == 1
            page.locator('.gp-history-item').first.click()
            page.locator('[data-gp-thread]').wait_for()
            assert len(runs) == 2
            result["checks"].append("history grouped and reopened without another POST")
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(250)
            page.evaluate("window.scrollTo(0,0)")
            page.screenshot(path=str(out / "03-current-round-mobile.png"))
            sizes = page.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth})")
            assert sizes["page"] <= sizes["viewport"], sizes
            result["mobileWidth"] = sizes
            result["mobileLayout"] = page.evaluate("""() => Object.fromEntries(['.gp-main','.gp-investigation-thread','.gp-canvas','.gp-canvas-inner','.gp-conclusion-region','.gp-hero','.gp-investigation-scope'].map(s=>{const el=document.querySelector(s);if(!el)return[s,null];const r=el.getBoundingClientRect(),c=getComputedStyle(el);return[s,{x:r.x,right:r.right,width:r.width,display:c.display,grid:c.gridTemplateColumns,overflow:c.overflow}]}))""")
            page.locator('.gp-followup-input').fill("继续核对适用日期")
            page.get_by_role("button", name="发送追问", exact=True).click()
            page.locator('[data-gp-stop]').click()
            page.locator('[data-gp-stop-state="stopped"]').wait_for()
            page.get_by_role("navigation", name="调查轮次").get_by_role("button", name="首次核查", exact=False).click()
            page.locator('[data-gp-phase="complete"]').wait_for()
            assert len(runs) == 3
            result["checks"].append("stopped follow-up retains original record")
            assert not result["pageErrors"], result["pageErrors"]
            assert not result["consoleErrors"], result["consoleErrors"]
            result["passed"] = True
            browser.close()
    except Exception as error:
        result["passed"] = False; result["failure"] = str(error)
        raise
    finally:
        for run in runs: run["release"].set()
        result["investigationPosts"] = len(runs)
        (out / "checks.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        server.shutdown(); server.server_close()
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
