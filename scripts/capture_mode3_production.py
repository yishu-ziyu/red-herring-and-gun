import os
import sys
import time
import subprocess
from playwright.sync_api import sync_playwright
from PIL import Image

OUT_DIR = os.path.abspath("docs/design/2026-09-06-mode3-production")
os.makedirs(OUT_DIR, exist_ok=True)
BASE_URL = "http://127.0.0.1:5180"

def make_grayscale(src_path, dest_path):
    img = Image.open(src_path).convert("L")
    img.save(dest_path)
    print(f"Saved grayscale: {dest_path}")

def run():
    # Start vite server if not running
    proc = None
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    is_open = s.connect_ex(('127.0.0.1', 5180)) == 0
    s.close()

    if not is_open:
        print("Starting Vite server on port 5180...")
        proc = subprocess.Popen(
            ["npx", "vite", "--host", "127.0.0.1", "--port", "5180"],
            cwd=os.path.abspath("mvp"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        time.sleep(2.5)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            )

            # 1. Desktop 1440x900
            context_desktop = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context_desktop.new_page()

            # Desktop input
            page.goto(f"{BASE_URL}/")
            page.wait_for_selector(".gp-input-card")
            time.sleep(0.6)
            desktop_input_path = os.path.join(OUT_DIR, "desktop-input.png")
            page.screenshot(path=desktop_input_path)
            print(f"Captured {desktop_input_path}")

            # Desktop input grayscale
            desktop_input_gray_path = os.path.join(OUT_DIR, "desktop-input-grayscale.png")
            make_grayscale(desktop_input_path, desktop_input_gray_path)

            # Desktop investigating shell
            page.goto(f"{BASE_URL}/?fixture=investigating")
            page.wait_for_selector(".gp-claim")
            time.sleep(0.8)
            desktop_investigating_path = os.path.join(OUT_DIR, "desktop-investigating-shell.png")
            page.screenshot(path=desktop_investigating_path)
            print(f"Captured {desktop_investigating_path}")

            page.close()
            context_desktop.close()

            # 2. Mobile 390x844
            context_mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
            page_m = context_mobile.new_page()

            # Mobile input
            page_m.goto(f"{BASE_URL}/")
            page_m.wait_for_selector(".gp-input-card")
            time.sleep(0.6)
            mobile_input_path = os.path.join(OUT_DIR, "mobile-input.png")
            page_m.screenshot(path=mobile_input_path)
            print(f"Captured {mobile_input_path}")

            # Mobile input grayscale
            mobile_input_gray_path = os.path.join(OUT_DIR, "mobile-input-grayscale.png")
            make_grayscale(mobile_input_path, mobile_input_gray_path)

            page_m.close()
            context_mobile.close()

            browser.close()
            print("All screenshots successfully captured!")

    finally:
        if proc:
            proc.terminate()
            proc.wait()

if __name__ == "__main__":
    run()
