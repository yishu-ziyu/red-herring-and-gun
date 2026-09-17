"""Real-browser input regression with local HTTP fixtures; never calls a model.

Run after `npm --prefix apps run build`:
  python3 scripts/qa/verify_input_menu.py --out /tmp/rhg-menu-qa
Screenshots and receipts stay outside the repository. Requires installed Playwright/Chrome.
"""
import argparse
import base64
import json
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    dist = root / "apps/dist"
    if not (dist / "index.html").exists():
        raise RuntimeError("Build apps before running browser verification")
    posts = []

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *values, **kwargs):
            super().__init__(*values, directory=str(dist), **kwargs)

        def log_message(self, *_values):
            pass

        def json_response(self, value, status=200):
            data = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            if path.startswith("/api/"):
                if "/models/list" in path:
                    self.json_response({"models": [{"provider": "deepseek", "model": "deepseek-v4-pro", "label": "QA model (not called)"}]})
                elif "/models/health" in path:
                    self.json_response({"status": "available", "message": ""})
                elif "/checks/quota" in path:
                    self.json_response({"remaining": 10, "total": 10, "used": 0, "kind": "guest"})
                elif "/cases" in path:
                    self.json_response({"cases": []})
                elif "/auth/" in path:
                    self.json_response({"enabled": False, "authenticated": False}, 401 if path.endswith("/me") else 200)
                else:
                    self.json_response({})
                return
            if path == "/" or not (dist / path.lstrip("/")).is_file():
                self.path = "/index.html"
            super().do_GET()

        def do_POST(self):
            data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            posts.append({"path": self.path, "body": json.loads(data) if data else {}})
            if "orchestrate-stream" not in self.path:
                self.json_response({})
                return
            frame = {"type": "error", "message": "验收夹具：没有调用模型。"}
            payload = ("data: " + json.dumps(frame, ensure_ascii=False) + "\n\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    report = {"fixture": True, "browser": "Chrome via Playwright; Browser plugin not available", "origin": origin,
              "checks": [], "pageErrors": [], "consoleErrors": []}
    image = {"name": "qa-capture.png", "mimeType": "image/png", "buffer": base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZl0AAAAASUVORK5CYII=")}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            for route, surface in [("/", "default"), ("/?legacy=1", "legacy")]:
                context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
                context.route("**/*", lambda request: request.continue_() if request.request.url.startswith(origin)
                              or request.request.url.startswith(("data:", "blob:")) else request.fulfill(status=204, body=""))
                page = context.new_page()
                page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
                page.on("console", lambda message: report["consoleErrors"].append(message.text)
                        if message.type == "error" and "401" not in message.text else None)
                page.goto(origin + route)
                page.locator("[data-prompt-add]").wait_for()
                assert page.locator("vite-error-overlay").count() == 0
                assert len(page.locator("body").inner_text()) > 20
                report["checks"].append({"surface": surface, "page": page.url, "title": page.title(), "notBlank": True})
                page.locator("[data-prompt-add]").click()
                expect(page.get_by_role("menuitem")).to_have_count(1)
                expect(page.get_by_role("menuitem", name="添加图片或视频")).to_be_visible()
                expect(page.get_by_text("视频按画面抽帧核查，不读取音轨；暂不支持 PDF、Word。")).to_be_visible()
                page.screenshot(path=str(out / f"{surface}-desktop.png"))
                page.get_by_role("menu").screenshot(path=str(out / f"{surface}-menu.png"))
                page.keyboard.press("Escape")
                expect(page.get_by_role("menu")).to_have_count(0)
                editor = page.locator("#claim-input")
                editor.fill("/路径 https://example.org/a/b")
                expect(page.get_by_role("listbox")).to_have_count(0)
                assert editor.inner_text() == "/路径 https://example.org/a/b"
                editor.fill("第一行")
                editor.press("End")
                editor.press("Shift+Enter")
                editor.press_sequentially("第二行")
                assert editor.inner_text() == "第一行\n第二行", editor.inner_text()
                upload = page.locator("input[type=file]")
                expect(upload).to_have_attribute("accept", "image/*,video/*")
                upload.set_input_files(image)
                expect(page.get_by_role("button", name="移除 qa-capture.png")).to_be_visible()
                page.get_by_role("button", name="移除 qa-capture.png").click()
                expect(page.get_by_role("button", name="移除 qa-capture.png")).to_have_count(0)
                upload.set_input_files({"name": "report.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-QA"})
                expect(page.get_by_text("只支持图片和视频文件。")).to_be_visible()
                assert page.locator('[aria-label^="移除 "]').count() == 0
                editor.fill("/原始说法/保留斜杠")
                expect(page.locator("[data-prompt-send]")).to_be_enabled()
                before = len(posts)
                editor.press("Enter")
                # Legacy loads its workbench before opening the investigation stream.
                deadline = time.monotonic() + 12
                while len(posts) == before and time.monotonic() < deadline:
                    page.wait_for_timeout(100)
                assert len(posts) == before + 1, {"posts": posts, "page": page.locator("body").inner_text()}
                assert posts[-1]["body"]["claim"] == "/原始说法/保留斜杠"
                report["checks"].append({"surface": surface, "menu": "media only", "slashAndURL": "preserved",
                                         "newline": "preserved", "imageAddRemove": "PASS", "pdfRejected": "PASS", "rawSubmission": "PASS"})
                context.close()
            context = browser.new_context(viewport={"width": 390, "height": 844}, locale="zh-CN")
            context.route("**/*", lambda request: request.continue_() if request.request.url.startswith(origin)
                          or request.request.url.startswith(("data:", "blob:")) else request.fulfill(status=204, body=""))
            page = context.new_page()
            page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
            page.on("console", lambda message: report["consoleErrors"].append(message.text)
                    if message.type == "error" and "401" not in message.text else None)
            page.goto(origin)
            page.locator("[data-prompt-add]").click()
            expect(page.get_by_role("menuitem", name="添加图片或视频")).to_be_visible()
            dimensions = page.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth})")
            assert dimensions["page"] == dimensions["viewport"], dimensions
            report["mobile"] = dimensions
            page.screenshot(path=str(out / "default-mobile.png"))
            browser.close()
        report["passed"] = not report["pageErrors"] and not report["consoleErrors"]
    except Exception as error:
        report["passed"] = False
        report["failure"] = str(error)
        traceback.print_exc()
    finally:
        server.shutdown()
        server.server_close()
        report["postCount"] = len(posts)
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
