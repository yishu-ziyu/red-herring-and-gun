import os
import sys
import time
from playwright.sync_api import sync_playwright

OUT_DIR = os.path.abspath("docs/design/2026-09-06-golden-path")
os.makedirs(OUT_DIR, exist_ok=True)
BASE_URL = "http://127.0.0.1:5180"

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 1. Desktop input
        context_desktop = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context_desktop.new_page()
        page.goto(f"{BASE_URL}/")
        page.wait_for_selector(".gp-input-card")
        time.sleep(0.5)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-1-input.png"))
        print("Captured desktop-1-input.png")

        # 2. Desktop investigating (fixture)
        page.goto(f"{BASE_URL}/?fixture=investigating")
        page.wait_for_selector(".gp-claim")
        time.sleep(0.6)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-2-investigating.png"))
        print("Captured desktop-2-investigating.png")

        # 3. Desktop complete (fixture)
        page.goto(f"{BASE_URL}/?fixture=complete")
        page.wait_for_selector("[data-gp-direct-answer]")
        time.sleep(1.2)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-3-complete.png"))
        print("Captured desktop-3-complete.png")

        # 4. Desktop conflict + gap (fixture conflict)
        page.goto(f"{BASE_URL}/?fixture=conflict")
        page.wait_for_selector("[data-gp-direct-answer]")
        time.sleep(1.2)
        # Expand claim 2 to show conflict & gap
        claim2_button = page.locator('[data-gp-claim-id="claim-2"] .gp-claim-head')
        if claim2_button.count() > 0:
            claim2_button.click()
            time.sleep(0.5)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-4-conflict-gap.png"))
        print("Captured desktop-4-conflict-gap.png")

        # 5. Desktop source drawer
        page.goto(f"{BASE_URL}/?fixture=complete")
        page.wait_for_selector("[data-gp-direct-answer]")
        time.sleep(1.2)
        page.locator(".gp-evidence-item").first.click()
        page.wait_for_selector(".gp-drawer--source")
        time.sleep(0.5)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-5-source-drawer.png"))
        print("Captured desktop-5-source-drawer.png")

        # 6. Desktop interrupted
        page.goto(f"{BASE_URL}/?fixture=interrupted")
        page.wait_for_selector("[data-gp-interrupted]")
        time.sleep(0.8)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-6-interrupted.png"))
        print("Captured desktop-6-interrupted.png")

        # 7. Desktop image-origin
        page.goto(f"{BASE_URL}/?fixture=image-found")
        page.wait_for_selector("[data-gp-direct-answer]")
        time.sleep(1.2)
        page.screenshot(path=os.path.join(OUT_DIR, "desktop-7-image-origin.png"))
        print("Captured desktop-7-image-origin.png")

        page.close()
        context_desktop.close()

        # Mobile views (390 x 844)
        context_mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        page_m = context_mobile.new_page()

        # 8. Mobile input
        page_m.goto(f"{BASE_URL}/")
        page_m.wait_for_selector(".gp-input-card")
        time.sleep(0.5)
        page_m.screenshot(path=os.path.join(OUT_DIR, "mobile-1-input.png"))
        print("Captured mobile-1-input.png")

        # 9. Mobile investigating
        page_m.goto(f"{BASE_URL}/?fixture=investigating")
        page_m.wait_for_selector(".gp-claim")
        time.sleep(0.6)
        page_m.screenshot(path=os.path.join(OUT_DIR, "mobile-2-investigating.png"))
        print("Captured mobile-2-investigating.png")

        # 10. Mobile complete
        page_m.goto(f"{BASE_URL}/?fixture=complete")
        page_m.wait_for_selector("[data-gp-direct-answer]")
        time.sleep(1.2)
        page_m.screenshot(path=os.path.join(OUT_DIR, "mobile-3-complete.png"))
        print("Captured mobile-3-complete.png")

        # 11. Mobile source drawer
        page_m.locator(".gp-evidence-item").first.click()
        page_m.wait_for_selector(".gp-drawer--source")
        time.sleep(0.5)
        page_m.screenshot(path=os.path.join(OUT_DIR, "mobile-4-source-drawer.png"))
        print("Captured mobile-4-source-drawer.png")

        page_m.close()
        context_mobile.close()

        browser.close()

if __name__ == "__main__":
    run()
