"""
红鲱鱼与枪 · 视觉研究与交互原型行为断言测试套件
严格验证：
1. Evidence DOM identity before === after (真正同一 HTMLElement 实例持久存在)
2. Conclusion DOM identity before === after (同一 Conclusion 节点平滑过渡)
3. Claim Trace derives from originalSpan (hover claim 01 精确高亮对应文本)
4. missing originalSpan => no highlight (无 span 绝不高亮、不伪造)
5. kugiri runtime actually loaded & API actually invoked (证明真实执行了 kugiri 0.4.0)
6. fixture correctly labeled (标记为 production-shaped design fixture)
7. modal Tab containment (连续 Tab 永远不离开 Drawer 区域)
8. Escape 关闭 Drawer
9. focus return (关闭后焦点严格归位到原触发 Evidence 按钮)
10. reduced motion 行为
"""

import os
import sys
import time
import subprocess
from playwright.sync_api import sync_playwright

PORT = 51930
SERVER_URL = f"http://127.0.0.1:{PORT}"

def run_tests():
    print("=" * 70)
    print("启动红鲱鱼与枪原型核心行为断言测试套件...")
    print("=" * 70)

    # 启动后台测试 HTTP 服务
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=os.path.abspath(".")
    )
    time.sleep(0.8)

    passed_count = 0
    total_count = 10

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})

            # =================================================================
            # 测试 1: kugiri 0.4.0 运行时加载与公开 API 调用
            # =================================================================
            page.goto(f"{SERVER_URL}/docs/design/reference-pack/kugiri-spike-test.html")
            page.wait_for_selector("#runtime-status")
            time.sleep(0.4)
            
            kugiri_loaded = page.evaluate("() => Boolean(window.splitText && window.spikeResults && window.spikeResults.loaded)")
            assert kugiri_loaded, "断言失败: kugiri@0.4.0 未能在浏览器内存中成功加载"
            
            # 检查 splitText 执行结果
            cases = page.evaluate("() => window.spikeResults.cases")
            assert "cjk1" in cases and cases["cjk1"]["lines"] > 0, "断言失败: kugiri.splitText() 未能成功切分中文长句"
            assert "repeatTest" in cases and cases["repeatTest"]["passed"] is True, "断言失败: kugiri revert 幂等性测试未通过"
            print("✓ [TEST 1 PASS] kugiri runtime actually loaded & API splitText/revert actually invoked")
            passed_count += 1

            # =================================================================
            # 加载主探索原型
            # =================================================================
            page.goto(f"{SERVER_URL}/docs/design/prototypes/reference-exploration/index.html")
            page.wait_for_selector(".investigation-document")
            time.sleep(0.4)

            # =================================================================
            # 测试 2: Fixture 准确性声明 (production-shaped design fixture)
            # =================================================================
            fixture_type = page.evaluate("() => window.__RHG_PROTOTYPE__.fixture.fixtureType")
            assert fixture_type == "production-shaped design fixture", f"断言失败: fixtureType 应为 production-shaped design fixture, 实为 {fixture_type}"
            print("✓ [TEST 2 PASS] fixture correctly labeled as 'production-shaped design fixture'")
            passed_count += 1

            # =================================================================
            # 测试 3: Evidence DOM Identity: before === after (同一 HTMLElement 实例)
            # =================================================================
            # 初始获取 src-01 节点引用
            page.evaluate("window.__RHG_PROTOTYPE__.nodeRefBefore = window.__RHG_PROTOTYPE__.getEvidenceNode('src-01');")
            
            # 切换到 investigating 态（所有节点归入待核对）
            page.evaluate("window.__RHG_PROTOTYPE__.syncPhaseState(false);")
            page.locator("#btn-toggle-phase").click() # 切换到 investigating
            time.sleep(0.2)
            
            # 触发 Settling 动画
            page.locator("#btn-replay-settling").click()
            time.sleep(0.6) # 等待 Settling 完成

            # 再次获取 src-01 节点引用，比较引用一致性
            is_same_evidence_node = page.evaluate("() => { const nodeAfter = window.__RHG_PROTOTYPE__.getEvidenceNode('src-01'); const domAfter = document.querySelector('[data-source-id=\"src-01\"]'); return window.__RHG_PROTOTYPE__.nodeRefBefore === nodeAfter && nodeAfter === domAfter; }")
            assert is_same_evidence_node, "断言失败: Evidence Settling 销毁了旧 DOM 并重建了新元素，未保持同一 DOM identity！"
            print("✓ [TEST 3 PASS] Evidence DOM identity: before === after (Strict Reference Equality)")
            passed_count += 1

            # =================================================================
            # 测试 4: Conclusion DOM Identity: before === after
            # =================================================================
            page.evaluate("window.__RHG_PROTOTYPE__.conclusionRefBefore = window.__RHG_PROTOTYPE__.getConclusionNode();")
            # 切换状态
            page.locator("#btn-toggle-phase").click()
            time.sleep(0.2)
            page.locator("#btn-toggle-phase").click()
            time.sleep(0.2)
            
            is_same_conclusion_node = page.evaluate("() => { const nodeAfter = window.__RHG_PROTOTYPE__.getConclusionNode(); const domAfter = document.querySelector('.conclusion-region'); return window.__RHG_PROTOTYPE__.conclusionRefBefore === nodeAfter && nodeAfter === domAfter; }")
            assert is_same_conclusion_node, "断言失败: Conclusion 区域在 phase 切换时被重新构建！"
            print("✓ [TEST 4 PASS] Conclusion DOM identity: before === after (Strict Reference Equality)")
            passed_count += 1

            # =================================================================
            # 测试 5: Claim Trace 严格由 originalSpan 生成并激活高亮
            # =================================================================
            # 验证 buildTraceSegments 函数逻辑
            trace_check = page.evaluate("""() => {
                const quote = "ABCDEF";
                const claims = [{ id: "c1", originalSpan: [1, 4] }];
                const segs = window.__RHG_PROTOTYPE__.buildTraceSegments(quote, claims);
                return segs.length === 3 && segs[1].text === "BCD" && segs[1].claimId === "c1";
            }""")
            assert trace_check, "断言失败: buildTraceSegments 未按 originalSpan 正确切分"

            # 真实 DOM 联动检查：hover 命题 01
            claim1_head = page.locator("#chapter-claim-01 .claim-header")
            claim1_head.hover()
            time.sleep(0.2)
            
            mark1_highlighted = page.locator('mark[data-trace-claim="claim-01"]').evaluate("el => el.classList.contains('is-highlighted')")
            assert mark1_highlighted, "断言失败: Hover 命题 01 时，原句中对应的 span 未能激活高亮！"
            print("✓ [TEST 5 PASS] Claim Trace strictly derived from originalSpan & hover联动成立")
            passed_count += 1

            # =================================================================
            # 测试 6: missing originalSpan => no highlight (不伪造高亮)
            # =================================================================
            # 命题 03 故意设置 originalSpan: null
            claim3_head = page.locator("#chapter-claim-03-missing-span .claim-header")
            claim3_head.hover()
            time.sleep(0.2)
            
            mark3_count = page.locator('mark[data-trace-claim="claim-03-missing-span"]').count()
            assert mark3_count == 0, "断言失败: 无 originalSpan 的 claim 却伪造了高亮 mark 节点！"
            print("✓ [TEST 6 PASS] missing originalSpan => no mark highlight (坚守命题透明不伪造)")
            passed_count += 1

            # =================================================================
            # 测试 7: Source Drawer Modal Tab Containment (Tab 闭环锁定)
            # =================================================================
            # 点击证据条打开 Drawer
            evidence_btn = page.locator("#evidence-row-src-01")
            evidence_btn.click()
            time.sleep(0.3)

            # 验证背景被设为 inert
            doc_inert = page.locator("#doc-container").evaluate("el => el.hasAttribute('inert')")
            assert doc_inert, "断言失败: Drawer 打开时背景未设置 inert"

            # 焦点应在关闭按钮上
            assert page.locator("#drawer-close-btn").evaluate("el => document.activeElement === el"), "断言失败: 打开后焦点未置于关闭按钮"

            # 在外部链接（最后一个可聚焦元素）按 Tab，焦点应循环回第一个元素（关闭按钮）
            external_link = page.locator("#drawer-external-link")
            external_link.focus()
            page.keyboard.press("Tab")
            time.sleep(0.1)
            is_focus_wrapped = page.locator("#drawer-close-btn").evaluate("el => document.activeElement === el")
            assert is_focus_wrapped, "断言失败: Tab 键未在 Drawer 内循环，焦点发生逃逸！"
            print("✓ [TEST 7 PASS] Modal Tab containment: 焦点严格闭环锁定在 Drawer 内部")
            passed_count += 1

            # =================================================================
            # 测试 8 & 9: Escape 关闭与 Focus 精确恢复到触发按钮
            # =================================================================
            page.keyboard.press("Escape")
            time.sleep(0.3)

            drawer_closed = page.locator("#source-drawer").evaluate("el => !el.classList.contains('is-open')")
            assert drawer_closed, "断言失败: 按 Escape 键未能关闭 Drawer"

            focus_returned = evidence_btn.evaluate("el => document.activeElement === el")
            assert focus_returned, "断言失败: Drawer 关闭后焦点未返回至原触发的 Evidence 按钮！"
            print("✓ [TEST 8 & 9 PASS] Escape 关闭成立，焦点精确恢复至原 Evidence 节点")
            passed_count += 2

            # =================================================================
            # 测试 10: prefers-reduced-motion 支持
            # =================================================================
            reduced_page = browser.new_page(
                viewport={"width": 1440, "height": 900},
                forced_colors="none"
            )
            reduced_page.emulate_media(reduced_motion="reduce")
            reduced_page.goto(f"{SERVER_URL}/docs/design/prototypes/reference-exploration/index.html")
            reduced_page.wait_for_selector(".investigation-document")
            time.sleep(0.3)

            # 在减弱动画下触发 Settling，验证 transform 位移被跳过 (0ms 即时生效)
            reduced_page.locator("#btn-replay-settling").click()
            time.sleep(0.4)
            row_transform = reduced_page.locator("#evidence-row-src-01").evaluate("el => el.style.transform")
            assert row_transform == "" or row_transform == "none" or "translate(0" in row_transform, "断言失败: reduced-motion 场景下仍在执行大幅 transform 位移！"
            print("✓ [TEST 10 PASS] prefers-reduced-motion: 自动跳过过渡位移，即时完成归位")
            passed_count += 1

            browser.close()

        print("=" * 70)
        print(f"[ALL PASS] 全部 {passed_count}/{total_count} 项核心行为断言测试 100% 通过！零伪造！")
        print("=" * 70)
    finally:
        try:
            server_proc.terminate()
            server_proc.kill()
        except Exception:
            pass

if __name__ == "__main__":
    run_tests()
