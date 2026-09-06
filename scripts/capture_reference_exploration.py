import os
import sys
import time
import subprocess
from PIL import Image
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/design/reference-pack/screenshots")
os.makedirs(OUT_DIR, exist_ok=True)

PORT = 51932
SERVER_URL = f"http://127.0.0.1:{PORT}"
PROTOTYPE_PATH = "/docs/design/prototypes/reference-exploration/index.html"
SPIKE_PATH = "/docs/design/reference-pack/kugiri-spike-test.html"

def make_grayscale(image_path, out_path):
    with Image.open(image_path) as img:
        gray = img.convert("L")
        gray.save(out_path)
    print(f"Generated grayscale review image: {os.path.basename(out_path)}")

def run():
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=os.path.abspath(".")
    )
    time.sleep(1.0)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            
            # =================================================================
            # 1. 桌面端 1440px 走查与截屏
            # =================================================================
            context_desktop = browser.new_context(viewport={"width": 1440, "height": 960})
            page = context_desktop.new_page()

            console_errors = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

            page.goto(f"{SERVER_URL}{PROTOTYPE_PATH}")
            page.wait_for_selector(".investigation-document")
            time.sleep(0.5)

            if console_errors:
                print(f"[WARN] Console errors detected: {console_errors}")
            else:
                print("[PASS] Prototype loaded with 0 console errors.")

            # 1.1 Mode 3: Hybrid 默认全貌
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.3)
            page.screenshot(path=os.path.join(OUT_DIR, "desktop-mode3-hybrid.png"))
            print("Captured desktop-mode3-hybrid.png")

            # 1.2 Mode 3: 签名交互 A: Claim Trace (Hover Claim 01，高亮原句中的 span)
            claim1 = page.locator("#chapter-claim-01")
            claim1.hover()
            time.sleep(0.3)
            page.screenshot(path=os.path.join(OUT_DIR, "desktop-mode3-claim-trace.png"))
            print("Captured desktop-mode3-claim-trace.png")

            # 1.3 Mode 3: 打开 Quiet Editorial Source Drawer 下钻
            first_evidence = page.locator("#evidence-row-src-01")
            first_evidence.click()
            page.wait_for_selector(".source-drawer.is-open")
            time.sleep(0.4)
            drawer_path = os.path.join(OUT_DIR, "desktop-mode3-source-drawer.png")
            page.screenshot(path=drawer_path)
            print("Captured desktop-mode3-source-drawer.png")

            # 生成灰度对比图用于 Grayscale Review
            make_grayscale(drawer_path, os.path.join(OUT_DIR, "desktop-mode3-source-drawer-grayscale.png"))

            # 关闭 Drawer 验证焦点恢复与 Esc
            page.keyboard.press("Escape")
            time.sleep(0.3)

            # 1.4 Mode 1: 键盘按 '1' 切换到 Editorial Calm
            page.keyboard.press("1")
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.4)
            page.screenshot(path=os.path.join(OUT_DIR, "desktop-mode1-editorial.png"))
            print("Captured desktop-mode1-editorial.png")

            # 1.5 Mode 2: 键盘按 '2' 切换到 Interactive Evidence (Complete 态)
            page.keyboard.press("2")
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.4)
            page.screenshot(path=os.path.join(OUT_DIR, "desktop-mode2-settled.png"))
            print("Captured desktop-mode2-settled.png")

            # 1.6 Mode 2: 切换到 Investigating 态 (Settling 前：所有证据归在待核对 ◌ 组)
            btn_phase = page.locator("#btn-toggle-phase")
            btn_phase.click()
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.4)
            page.screenshot(path=os.path.join(OUT_DIR, "desktop-mode2-investigating.png"))
            print("Captured desktop-mode2-investigating.png")

            # 切回 Complete 态
            btn_phase.click()
            time.sleep(0.3)

            # =================================================================
            # 2. 移动端 390px 走查与 Bottom Sheet
            # =================================================================
            context_mobile = browser.new_context(viewport={"width": 390, "height": 844})
            m_page = context_mobile.new_page()
            m_page.goto(f"{SERVER_URL}{PROTOTYPE_PATH}")
            m_page.wait_for_selector(".investigation-document")
            time.sleep(0.5)

            # 2.1 移动端 Mode 3 全貌
            m_page.screenshot(path=os.path.join(OUT_DIR, "mobile-mode3-hybrid.png"))
            print("Captured mobile-mode3-hybrid.png")

            # 2.2 移动端打开 Source Bottom Sheet (Quiet Editorial)
            m_first_evidence = m_page.locator("#evidence-row-src-01")
            m_first_evidence.click()
            m_page.wait_for_selector(".source-drawer.is-open")
            time.sleep(0.4)
            sheet_path = os.path.join(OUT_DIR, "mobile-source-sheet.png")
            m_page.screenshot(path=sheet_path)
            print("Captured mobile-source-sheet.png")

            # 生成移动端灰度图用于 Grayscale Review
            make_grayscale(sheet_path, os.path.join(OUT_DIR, "mobile-source-sheet-grayscale.png"))

            # 关闭 Sheet
            m_page.locator("#drawer-close-btn").click()
            time.sleep(0.3)

            # 2.3 移动端 Mode 1 Editorial
            m_page.keyboard.press("1")
            time.sleep(0.3)
            m_page.screenshot(path=os.path.join(OUT_DIR, "mobile-mode1-editorial.png"))
            print("Captured mobile-mode1-editorial.png")

            # 2.4 移动端 Mode 2 Interactive
            m_page.keyboard.press("2")
            time.sleep(0.3)
            m_page.screenshot(path=os.path.join(OUT_DIR, "mobile-mode2-interactive.png"))
            print("Captured mobile-mode2-interactive.png")

            # =================================================================
            # 3. kugiri 真实运行时 Spike 页面截屏
            # =================================================================
            spike_page = context_desktop.new_page()
            spike_page.goto(f"{SERVER_URL}{SPIKE_PATH}")
            time.sleep(0.5)
            spike_page.screenshot(path=os.path.join(OUT_DIR, "kugiri-spike-comparison.png"))
            print("Captured kugiri-spike-comparison.png")

            browser.close()
            print("\n[SUCCESS] All screenshots and grayscale reviews captured successfully!")
    finally:
        try:
            server_proc.terminate()
            server_proc.kill()
        except Exception:
            pass

if __name__ == "__main__":
    run()
