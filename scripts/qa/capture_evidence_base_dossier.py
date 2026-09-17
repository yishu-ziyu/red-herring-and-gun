#!/usr/bin/env python3
"""证据库走查的补拍：从已完成的 run 只读接回，展开案卷，截「命中知识库」活动行。

背景（为什么需要这个脚本）：完成态画布按设计不渲染实时活动流
（`InvestigationCanvas.tsx:329` 只在 `!complete && !interrupted` 时挂 ActivityFeed），
所以走查脚本的结果页截图里不会有那一行；唯一能截到「命中知识库」行的时机是调查进行中
（本批实测：第 60.82 秒出现，第 275.15 秒完成卸载）。走查脚本的截图节奏错过了那一帧，
但它每 0.25 秒的界面签名时间线证明那一行确实上屏了 214 秒。

补拍走产品自己的刷新恢复通道：`GET /api/investigations/:runId/events`（只读补发，
不跑模型、不检索、不扣额、不新建 run），再接完成态页面的「调查全案卷」展开——
`InvestigationDossier` 用同一份 `activities` 渲染 ActivityFeed，因此那一行在那里可见。

零成本：不发起任何新调查。产物 docs/reports/2026-09-12-evidence-base/real-round2-activity-hit.png
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5211/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = Path(__file__).resolve().parents[2] / "docs/reports/2026-09-12-evidence-base"

RUN_ID = sys.argv[1] if len(sys.argv) > 1 else "300a63f4-bcb4-485e-9004-1cc7dd391c42"
CLAIM = "隔夜的饭菜到底还能不能吃？听说放一夜亚硝酸盐超标会中毒"

POINTER_JS = """
(args) => {
  window.localStorage.setItem('rhg:active-run', JSON.stringify({
    runId: args.runId, claim: args.claim, intake: null, lastSeq: 0, at: Date.now(),
  }));
}
"""

PICK_JS = """
() => {
  const rows = [...document.querySelectorAll('[data-gp-activity-kind="knowledge_hit"]')];
  const marks = [...document.querySelectorAll('[data-gp-knowledge-mark]')].map((el) => el.getAttribute('data-gp-knowledge-mark'));
  return {
    hitRows: rows.map((el) => (el.textContent || '').trim()),
    markValues: marks,
    markTexts: [...document.querySelectorAll('.gp-knowledge-mark')].map((el) => (el.textContent || '').trim()),
    canvas: Boolean(document.querySelector('.gp-canvas')),
    conclusion: document.querySelector('[data-gp-conclusion-region]') ? document.querySelector('[data-gp-conclusion-region]').getAttribute('data-gp-conclusion-state') : null,
    totalActivities: document.querySelectorAll('[data-gp-activity-kind]').length,
  };
}
"""


def main() -> int:
    report: dict = {"runId": RUN_ID, "replayOnly": True, "screenshots": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME, args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_selector("#claim-input", timeout=30000)
        page.evaluate(POINTER_JS, {"runId": RUN_ID, "claim": CLAIM})
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".gp-canvas", timeout=30000)
        page.wait_for_function(
            "() => { const el = document.querySelector('[data-gp-conclusion-region]'); return el && el.getAttribute('data-gp-conclusion-state') === 'complete'; }",
            timeout=60000,
        )
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "real-round2-result-restored.png"), full_page=True)
        report["screenshots"].append("real-round2-result-restored.png")

        # 展开「调查全案卷」→ InvestigationDossier 里用同一份 activities 渲染活动流。
        page.locator(".gp-dossier-toggle").first.click()
        page.wait_for_selector('[data-gp-dossier-expanded]', timeout=15000)
        page.wait_for_timeout(400)
        report["afterExpand"] = page.evaluate(PICK_JS)
        page.screenshot(path=str(OUT / "real-round2-dossier-expanded.png"), full_page=True)
        report["screenshots"].append("real-round2-dossier-expanded.png")

        row = page.locator('[data-gp-activity-kind="knowledge_hit"]').first
        if row.count() > 0:
            row.scroll_into_view_if_needed()
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / "real-round2-activity-hit.png"), full_page=False)
            report["screenshots"].append("real-round2-activity-hit.png")
            report["hitRowText"] = (row.text_content() or "").strip()
            row.screenshot(path=str(OUT / "real-round2-activity-hit-row.png"))
            report["screenshots"].append("real-round2-activity-hit-row.png")

        mark = page.locator("[data-gp-knowledge-mark]").first
        if mark.count() > 0:
            mark.scroll_into_view_if_needed()
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / "real-round2-knowledge-mark.png"), full_page=False)
            report["screenshots"].append("real-round2-knowledge-mark.png")
            report["markValue"] = mark.get_attribute("data-gp-knowledge-mark")

        ctx.close()
        browser.close()

    report["pass"] = bool(report.get("hitRowText"))
    (OUT / "real-activity-hit-capture.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
