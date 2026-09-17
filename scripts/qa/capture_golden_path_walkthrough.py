#!/usr/bin/env python3
"""Golden Path 六步离线回放走查（零成本，契约 2026-09-12-golden-path-smoothness Evaluator 1）。

复用 :5211 上已在跑的 dev 服务（端口没开才自己起一个 vite），用 `?fixture=first-beat`
按脚本回放完整调查流，另用 `?fixture=complete` 补完成态特写；1280x900 与 375x812 两端
各截一套，每张图登记「这一步的内容是否真的在图里」。

产物：
  docs/reports/2026-09-12-golden-path-walkthrough/step*-*.png
  docs/reports/2026-09-12-golden-path-walkthrough/offline-checks.json
  docs/reports/2026-09-12-golden-path-walkthrough/offline-timeline.json
  docs/reports/2026-09-12-golden-path-walkthrough/offline-walkthrough.log

三个刻意的取证设置（不然六拍截图会互相打架）：
  * 用 Playwright clock 把 fixture 的脚本时间**冻住**，再用 `run_for` 一拍拍推进：
    fixture 的四拍之间只隔 2.2–2.8 秒，而一次整页截图（尤其移动端）能花十几秒
    （Playwright 截图会等 document.fonts.ready），不冻住就会出现「图里已经是下一拍」。
  * `prefers-reduced-motion: reduce`：入场动画按终态渲染，截图不截半透明中间帧，
    版式本身不变（ConclusionHero / SourceDrawer / EvidenceBoard 都尊重这个偏好）。
  * 先暖一遍字体缓存：Noto Sans/Serif SC 的 CJK 子集要十几秒才落定。
每张截图都核对截图前后的 `[data-gp-phase]`，相位对不上就判 MISS，不把错位读成内容缺失。

复跑：python3 scripts/qa/capture_golden_path_walkthrough.py [--port 5211] [--viewport desktop]
（用 --viewport 只跑一端时，offline-checks.json / offline-timeline.json 里也只有那一端的记录；
完整的一套（两端各 16 张）请不带 --viewport 跑。）
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import Error as PwError
from playwright.sync_api import Page, sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "docs", "reports", "2026-09-12-golden-path-walkthrough")
APPS = os.path.join(ROOT, "apps")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
VIEWPORTS = [("desktop", 1280, 900), ("mobile", 375, 812)]
BASE = "http://127.0.0.1:5211"
SETTLE_MS = 1500  # 到达某一拍后再多走一点脚本时间，让入场动画/思考链三步骤走完

_checks: list[dict] = []
_timeline: list[dict] = []
_log_lines: list[str] = []


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    _log_lines.append(line)


# --------------------------------------------------------------------------- 服务

def port_open(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    alive = sock.connect_ex(("127.0.0.1", port)) == 0
    sock.close()
    return alive


def http_status(url: str) -> int | None:
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception:
        return None


def ensure_server(port: int):
    """已跑就复用，没跑才自己起，保证脚本可复跑。"""
    status = http_status(f"http://127.0.0.1:{port}/")
    if status == 200:
        log(f"复用已在跑的 dev 服务 http://127.0.0.1:{port}/ (HTTP {status})")
        return None
    log(f"http://127.0.0.1:{port}/ 不可用 (HTTP {status})，自己起一个 vite")
    proc = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
        cwd=APPS,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(120):
        if port_open(port):
            break
        time.sleep(0.25)
    return proc


# --------------------------------------------------------------------------- 取证 helper

def current_phase(page: Page) -> str | None:
    loc = page.locator("[data-gp-phase]")
    return loc.first.get_attribute("data-gp-phase") if loc.count() else None


def text_of(page: Page, sel: str) -> str:
    loc = page.locator(sel)
    return loc.first.inner_text().strip() if loc.count() else ""


def count_exact_text(page: Page, text: str) -> int:
    """按可点控件的精确文本计数，避免 get_by_text 把按钮和它的内层 span 各算一次。"""
    return page.evaluate(
        "(t)=>[...document.querySelectorAll('button,a,[role=button]')]"
        ".filter(e=>e.textContent.trim()===t).length",
        text,
    )


def record(
    vp: str,
    step: str,
    file: str,
    expect: str,
    found: dict,
    ok: bool,
    note: str = "",
) -> None:
    item = {
        "viewport": vp,
        "step": step,
        "file": file,
        "expect": expect,
        "found": found,
        "ok": ok,
    }
    if note:
        item["note"] = note
    _checks.append(item)
    log(f"  {'OK  ' if ok else 'MISS'} {file}  {json.dumps(found, ensure_ascii=False)}  <- {expect}")
    if note:
        log(f"       note: {note}")


def shot(
    page: Page,
    step: str,
    vp: str,
    expect: str,
    *,
    full_page: bool = True,
    selectors: dict[str, tuple[str, int]] | None = None,
    phase: str | None = None,
) -> str:
    """截图 + 自查：`selectors` 每条 (选择器, 期望最少数量) 都要真的在图里。"""
    name = f"{step}-{vp}.png"
    before_phase = current_phase(page)
    overflow = page.evaluate(
        "()=>({scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth})"
    )
    page.screenshot(path=os.path.join(OUT, name), full_page=full_page, timeout=90000)
    after_phase = current_phase(page)
    found: dict[str, object] = {}
    ok = True
    for label, (sel, want) in (selectors or {}).items():
        n = page.locator(sel).count()
        found[label] = n
        if n < want:
            ok = False
    if overflow["scrollW"] > overflow["innerW"] + 1:
        found["h_overflow_px"] = overflow["scrollW"] - overflow["innerW"]
    if phase is not None:
        found["phase_before"] = before_phase
        found["phase_after"] = after_phase
        if before_phase != phase or after_phase != phase:
            ok = False
    record(vp, step, name, expect, found, ok)
    return name


def wire_page(page: Page, sink: dict) -> None:
    """把 console 报错与 4xx/5xx 请求记下来，供摩擦清单用。"""
    page.on("console", lambda m: sink["console"].append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: sink["pageerror"].append(str(e)))
    page.on("response", lambda r: sink["http"].append(f"{r.status} {r.url}") if r.status >= 400 else None)
    page.on("requestfailed", lambda r: sink["reqfailed"].append(f"{r.failure} {r.url}"))


def warm_fonts(page: Page) -> None:
    """CJK 字体子集按用到的字**按需**拉取，要十几秒才落定。

    截图会等 `document.fonts.ready`，只要有一片子集没缓存，那一张截图就能卡住几十秒。
    所以这里把六拍会用到的字都先渲染一遍（输入态 / 完成态 / 完整回放一遍），
    之后再换页就不会有新子集要拉。
    """
    log("预热字体缓存（Noto Sans/Serif SC 子集）…")
    for label, url, wait_phase_name in [
        ("输入态", f"{BASE}/", None),
        ("完成态", f"{BASE}/?fixture=complete", "complete"),
        ("完整回放", f"{BASE}/?fixture=first-beat", "complete"),
    ]:
        t0 = time.time()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except PwError as err:
            log(f"  {label} 打不开（{err.__class__.__name__}），跳过这一页")
            continue
        if wait_phase_name:
            try:
                page.wait_for_selector(f"[data-gp-phase='{wait_phase_name}']", timeout=40000)
            except PwError:
                log(f"  {label} 未在 40s 内走到 {wait_phase_name}")
        try:
            page.wait_for_function("()=>document.fonts.status === 'loaded'", timeout=90000)
            log(f"  {label} 字体已落定，用时 {round(time.time() - t0, 1)}s")
        except PwError:
            log(f"  {label} 字体 90s 内未落定（继续，截图会用回退字体），用时 {round(time.time() - t0, 1)}s")
    try:
        page.evaluate("()=>document.fonts.ready")
    except PwError:
        log("  字体 ready 探测失败（继续）")


# --------------------------------------------------------------------------- 脚本时间控制

def advance_to(page: Page, target: str, max_ms: int = 40000, step: int = 200) -> tuple[str | None, int]:
    """用 fake clock 一拍拍推进，直到 `[data-gp-phase]` 到 target。"""
    budget = 0
    while current_phase(page) != target and budget < max_ms:
        page.clock.run_for(step)
        budget += step
    return current_phase(page), budget


def open_fixture(page: Page, fixture: str, target: str, vp: str) -> int:
    """打开 fixture、推进到 target 那一拍、再多走 SETTLE_MS 让动画落定。返回推进的脚本毫秒数。"""
    page.goto(f"{BASE}/?fixture={fixture}", wait_until="domcontentloaded", timeout=60000)
    phase, advanced = advance_to(page, target)
    if phase != target:
        log(f"  !! {vp} ?fixture={fixture} 推进 {advanced}ms 后相位是 {phase!r}，期望 {target!r}")
    page.clock.run_for(SETTLE_MS)
    return advanced


# --------------------------------------------------------------------------- 六步

def part_a_flow(page: Page, vp: str) -> None:
    """第一段：输入态 + ?fixture=first-beat 回放完整调查流。"""
    log(f"== {vp} / 输入态 + first-beat 全流 ==")

    # ①输入态（开始前）。first-beat 一挂载就 beginRun，输入态只在裸路径上出现。
    page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector(".gp-input-stage", timeout=20000)
    page.clock.run_for(500)
    shot(
        page,
        "step1-input",
        vp,
        "①输入态：标题 + 输入框 + 开始调查按钮（开始前）",
        selectors={
            ".gp-input-stage": (".gp-input-stage", 1),
            "#claim-input": ("#claim-input", 1),
            ".gp-examples-list": (".gp-examples-list", 1),
            "button[aria-label='开始调查']": ("button[aria-label='开始调查']", 1),
        },
        phase=None,
    )
    submit = page.locator("button[aria-label='开始调查']").first
    record(
        vp,
        "step1-submit-ready",
        f"step1-input-{vp}.png",
        "①开始调查按钮可见（记录它此刻是否被 disabled 挡住）",
        {"disabled": submit.is_disabled() if submit.count() else None},
        True,
        "输入态的按钮可用性依赖 /api/models/health 与 /api/checks/quota 的返回；"
        "离线 fixture 下这两个请求按未登录处理，命中不重要。",
    )

    # first-beat 脚本：received 60ms → decomposed 1.8s → investigating 4s → judging 6.8s → complete 9.8s
    page.goto(f"{BASE}/?fixture=first-beat", wait_until="domcontentloaded", timeout=60000)
    first_phase, _ = advance_to(page, "received")
    _timeline.append({"viewport": vp, "phase": "received", "phase_reached": first_phase})

    # ②思考披露 / 拆题
    adv2 = open_fixture_last(page, "decomposed", vp)
    _timeline.append({"viewport": vp, "phase": "decomposed", "advanced_ms": adv2})
    shot(
        page,
        "step2-decompose",
        vp,
        "②拆题：思考披露 + 拆出的命题列表",
        phase="decomposed",
        selectors={
            "[data-gp-thinking-state]": ("[data-gp-thinking-state]", 1),
            ".gp-thinking-row": (".gp-thinking-row", 3),
            "[data-gp-claim-id]": ("[data-gp-claim-id]", 3),
        },
    )
    record(
        vp,
        "step2-trace-marks-first-beat",
        f"step2-decompose-{vp}.png",
        "②原句里被拆出的短语有标定（first-beat fixture）",
        {"trace_marks": page.locator(".gp-trace-mark").count()},
        True,
        "无法判定：first-beat 的三条命题是原句的改写、不是字面子串；"
        "build.ts:626 用 originalClaim.indexOf(a.text) 取 span，取不到就不标定。"
        "标定本身另用 ?fixture=mixed 验证（step2b）。",
    )

    # ③证据逐条进来（活动流有内容）
    adv3 = open_fixture_last(page, "investigating", vp)
    _timeline.append(
        {
            "viewport": vp,
            "phase": "investigating",
            "advanced_ms": adv3,
            "activity_count": page.locator("[data-gp-activity-count]").get_attribute("data-gp-activity-count")
            if page.locator("[data-gp-activity-count]").count()
            else None,
            "activity_kinds": page.locator("[data-gp-activity-kind]").evaluate_all(
                "els=>els.map(e=>e.getAttribute('data-gp-activity-kind'))"
            ),
        }
    )
    shot(
        page,
        "step3-activity",
        vp,
        "③证据逐条进来：活动流有条目、每条带角色标识",
        phase="investigating",
        selectors={
            "[data-gp-activity-count]": ("[data-gp-activity-count]", 1),
            ".gp-activity-item": (".gp-activity-item", 1),
            ".gp-activity-role-badge": (".gp-activity-role-badge", 1),
        },
    )

    # ④争点两组（judging 是快照里第一次同时有支持侧与反驳侧的拍子）
    adv4 = open_fixture_last(page, "judging", vp)
    _timeline.append(
        {
            "viewport": vp,
            "phase": "judging",
            "advanced_ms": adv4,
            "conflicts": page.locator(".gp-conflict").count(),
            "conflict_activities": page.locator("[data-gp-activity-kind='conflict_detected']").count(),
            "expanded": page.locator(".gp-claim-head").evaluate_all(
                "els=>els.map(e=>e.getAttribute('aria-expanded'))"
            ),
        }
    )
    shot(
        page,
        "step4-conflict",
        vp,
        "④争点：支持侧与反驳侧各自成组（judging 拍，未做任何点击）",
        phase="judging",
        selectors={
            "[data-gp-conflict-id]": ("[data-gp-conflict-id]", 1),
            "[data-gp-conflict-side]": ("[data-gp-conflict-side]", 2),
        },
    )

    # ⑤完成态结论卡
    adv5 = open_fixture_last(page, "complete", vp)
    _timeline.append({"viewport": vp, "phase": "complete", "advanced_ms": adv5})
    direct = text_of(page, "[data-gp-direct-answer]")
    judgment = text_of(page, ".gp-hero-judgment")
    boundaries = page.locator("[data-gp-boundaries]").count()
    log(f"  结论第一句：{direct[:70]!r} / 判断标签 {judgment!r} / 适用边界 {boundaries}")
    shot(
        page,
        "step5-conclusion",
        vp,
        "⑤完成态：第一句直接回答 + 判断标签 + 适用边界",
        phase="complete",
        selectors={
            "[data-gp-direct-answer]": ("[data-gp-direct-answer]", 1),
            ".gp-hero-judgment": (".gp-hero-judgment", 1),
            "[data-gp-boundaries]": ("[data-gp-boundaries]", 1),
        },
    )
    # 就在 first-beat 这一页上量：完整走完六拍之后，命题卡对用户还可不可达。
    flow_heads = page.locator(".gp-claim-head")
    record(
        vp,
        "step5-flow-complete-claim-expandable",
        f"step5-conclusion-{vp}.png",
        "⑤按真实顺序走完全流之后，完成态命题的证据/争点/边界还看不看得到",
        {
            "claim_head_display": flow_heads.evaluate_all("els=>els.map(e=>getComputedStyle(e).display)")
            if flow_heads.count()
            else [],
            "claim_expanded": flow_heads.evaluate_all("els=>els.map(e=>e.getAttribute('aria-expanded'))")
            if flow_heads.count()
            else [],
            "claim_detail_count": page.locator(".gp-claim-detail").count(),
            "evidence_rows": page.locator(".gp-evidence-item").count(),
            "dom_conflicts": page.locator("[data-gp-conflict-id]").count(),
            "gaps": page.locator("[data-gp-gap-status]").count(),
        },
        page.locator(".gp-claim-detail").count() >= 1,
        "first-beat 的命题卡在 decomposed 拍就挂载了（那时 progress=pending → defaultExpanded=false），"
        "之后不重挂载，所以完成态仍是收起；而 .gp-claim-head 在完成态被 CSS 设为 display:none，"
        "用户连点开的地方都没有。?fixture=complete 里卡片是 investigating 拍挂载的，所以默认展开——"
        "两条路径的差别只在「卡片什么时候第一次出现」。",
    )

    # ⑥追问区：3 个推荐胶囊 + 输入框 + 全页唯一「重新调查」
    page.locator(".gp-followup").first.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    chips = page.locator(".gp-followup-chip").count()
    entries = {t: count_exact_text(page, t) for t in ("重新调查", "重新核查", "重新开始", "再查一次")}
    log(f"  追问胶囊 {chips} 个 / 同类重查入口 {entries}")
    shot(
        page,
        "step6-followup",
        vp,
        "⑥追问区：3 个推荐胶囊 + 输入框 + 唯一重新调查入口",
        phase="complete",
        selectors={
            ".gp-followup": (".gp-followup", 1),
            ".gp-followup-chip": (".gp-followup-chip", 3),
            ".gp-followup-input": (".gp-followup-input", 1),
        },
    )
    record(
        vp,
        "step6-reverify-unique",
        f"step6-followup-{vp}.png",
        "全页只有一处「重新调查」入口",
        entries,
        entries["重新调查"] == 1,
    )


def open_fixture_last(page: Page, target: str, vp: str) -> int:
    """first-beat 已经在同一个 page 上跑着：继续往前推到 target 那一拍。"""
    phase, advanced = advance_to(page, target)
    if phase != target:
        log(f"  !! {vp} first-beat 推进 {advanced}ms 后相位是 {phase!r}，期望 {target!r}")
    page.clock.run_for(SETTLE_MS)
    return advanced


def part_a2_closeups(page: Page, vp: str) -> None:
    """补拍：first-beat 里默认收起 / 缺 span 的内容，换单相 fixture 端出来看。"""
    log(f"== {vp} / 单相 fixture 补拍 ==")

    # first-beat 的命题是原句的改写、不是字面子串，标定无从产生；
    # mixed fixture 的原子是原句子串，用它看「原句短语标定」本身。
    open_fixture(page, "mixed", "complete", vp)
    marks = page.locator("[data-gp-trace-claim]")
    traced = marks.evaluate_all("els=>els.map(e=>e.textContent)")
    original_block = page.locator(".gp-original").first
    original_display = (
        original_block.evaluate("el=>getComputedStyle(el).display") if original_block.count() else "missing"
    )
    marks_visible = marks.first.evaluate("el=>el.checkVisibility()") if marks.count() else False
    shot(
        page,
        "step2b-trace-marks",
        vp,
        "②补拍（mixed fixture 完成态）：原句短语标定的元素是否存在、在图里可不可见",
        phase="complete",
        selectors={"[data-gp-trace-claim]": ("[data-gp-trace-claim]", 1)},
    )
    record(
        vp,
        "step2b-trace-marks-dom",
        f"step2b-trace-marks-{vp}.png",
        "②标定按原句字面子串生成（DOM 断言）",
        {"traced_segments": traced, "original_block_display": original_display},
        len(traced) >= 1,
        "两个 mark 段分别等于两个原子，说明标定本身工作正常。",
    )
    record(
        vp,
        "step2b-trace-marks-visible",
        f"step2b-trace-marks-{vp}.png",
        "②标定在图里看得见",
        {
            "marks_in_dom": marks.count(),
            "marks_visible": marks_visible,
            "original_block_display": original_display,
        },
        marks_visible,
        "看不到，两个原因叠加：① 完成态 `.gp-original` 被 CSS 设为 display:none"
        "（goldenPath.css:1911），标定连同原句一起被藏起来；② first-beat 的三条命题不是"
        "原句子串，本来就没有标定。→ 「原句里被拆出的短语有标定」这一步离线只能验到 DOM 层，"
        "「调查中看得见」要真实走查（Evaluator 2）在 decomposed/investigating 拍确认。",
    )

    open_fixture(page, "investigating", "investigating", vp)
    shot(
        page,
        "step3b-evidence-groups",
        vp,
        "③补拍：investigating 拍的证据分组（判词未到，全部还在「待核对」）",
        phase="investigating",
        selectors={
            "[data-gp-group-role]": ("[data-gp-group-role]", 2),
            ".gp-evidence-item": (".gp-evidence-item", 1),
        },
    )
    record(
        vp,
        "step3b-role-groups",
        f"step3b-evidence-groups-{vp}.png",
        "③investigating 拍证据只分到「待核对」，四类语义要等判词落地（对照 step4d）",
        {
            "group_roles": page.locator("[data-gp-group-role]").evaluate_all(
                "els=>els.map(e=>e.getAttribute('data-gp-group-role'))"
            ),
            "evidence_roles": page.locator("[data-gp-role]").evaluate_all(
                "els=>els.map(e=>e.getAttribute('data-gp-role'))"
            ),
        },
        True,
        "契约第 3 步写「支持、反驳、只是相关、还缺四类语义可分辨」。实测：investigating 拍"
        "证据角色一律 unassessed（待核对），四类分不分得清要等 judging 拍的判词（step4d 有数据："
        "支持 / 反驳 / 只是相关 / 待核对 四类并存，「还缺」在 gaps 块）。所以第 3 步的这句"
        "标准在「看证据」这一拍本身不成立，要往后延到「作判断」拍。",
    )

    # judging 是终态：没有时间压力，先原样截，再模拟用户点开命题卡看争点会不会出现。
    open_fixture(page, "judging", "judging", vp)
    conflict_activities = page.locator("[data-gp-activity-kind='conflict_detected']").count()
    shot(
        page,
        "step4b-conflict-judging-probe",
        vp,
        "④补拍：judging 快照已含争点，界面是否摆出两组（未点击）",
        phase="judging",
        selectors={
            "[data-gp-conflict-id]": ("[data-gp-conflict-id]", 1),
            "[data-gp-conflict-side]": ("[data-gp-conflict-side]", 2),
        },
    )
    heads = page.locator(".gp-claim-head")
    for i in range(heads.count()):
        try:
            if heads.nth(i).get_attribute("aria-expanded") == "false":
                heads.nth(i).click(timeout=2000)
        except PwError as err:
            log(f"  (judging 展开第 {i + 1} 条命题卡失败：{err.__class__.__name__})")
    page.clock.run_for(400)
    expanded_state = heads.evaluate_all("els=>els.map(e=>e.getAttribute('aria-expanded'))")
    evidence_rows = page.locator(".gp-evidence-item").count()
    shot(
        page,
        "step4d-conflict-judging-expanded",
        vp,
        "④探针：调查中点开命题卡之后，争点两组是否出现",
        phase="judging",
        selectors={
            "[data-gp-conflict-id]": ("[data-gp-conflict-id]", 1),
            "[data-gp-conflict-side]": ("[data-gp-conflict-side]", 2),
        },
    )
    record(
        vp,
        "step4d-suppression-evidence",
        f"step4d-conflict-judging-expanded-{vp}.png",
        "④争点是「界面不摆」还是「快照没有」：快照侧的 conflict_detected 活动 vs 界面上的争点块",
        {
            "claim_expanded": expanded_state,
            "evidence_rows": evidence_rows,
            "snapshot_conflict_activities": conflict_activities,
            "dom_conflicts": page.locator("[data-gp-conflict-id]").count(),
            "group_roles": page.locator("[data-gp-group-role]").evaluate_all(
                "els=>els.map(e=>e.getAttribute('data-gp-group-role'))"
            ),
            "evidence_roles": page.locator("[data-gp-role]").evaluate_all(
                "els=>els.map(e=>e.getAttribute('data-gp-role'))"
            ),
            "gap_items": page.locator("[data-gp-gap-status]").count(),
        },
        True,
        "判词落地后证据角色才分成支持/反驳/只是相关；「还缺」在 gaps 块里。"
        "同一拍快照已有 conflict_detected 活动，但争点块一个都没渲染 —— 界面层在调查中根本不摆争点。",
    )


def part_b_complete(page: Page, vp: str) -> None:
    """第二段：?fixture=complete 完成态特写。"""
    log(f"== {vp} / complete 完成态特写 ==")
    open_fixture(page, "complete", "complete", vp)

    # 来源胶囊悬停预览
    strip = page.locator("[data-gp-sources-strip]")
    if strip.count():
        toggle = strip.locator("button").first
        if toggle.get_attribute("aria-expanded") == "false":
            toggle.click()
            page.clock.run_for(300)
        pill = page.locator(".gp-hero-sources-list [data-gp-source-pill]").first
        pill.scroll_into_view_if_needed()
        pill.hover()
        page.wait_for_timeout(500)
        hover_visible = page.locator(".gp-source-container:hover .gp-source-popover").count()
        shot(
            page,
            "step5b-pill-hover",
            vp,
            "⑤来源胶囊悬停预览：浮层卡片（标题 / 摘录 / 立场徽标）",
            full_page=False,
            selectors={
                ".gp-source-popover": (".gp-source-popover", 1),
                ".gp-source-popover-title": (".gp-source-popover-title", 1),
            },
        )
        record(
            vp,
            "step5b-popover-hover-visible",
            f"step5b-pill-hover-{vp}.png",
            "悬停时浮层真的显示（:hover 生效，不是只有一个 opacity:0 的壳）",
            {"hover_visible": hover_visible},
            hover_visible >= 1,
        )

    # 来源抽屉打开（点胶囊）
    page.mouse.move(2, 2)
    page.wait_for_timeout(300)
    pill = page.locator(".gp-hero-sources-list [data-gp-source-pill]").first
    if pill.count() == 0:
        pill = page.locator("[data-gp-source-pill]").first
    pill.scroll_into_view_if_needed()
    pill.click()
    page.wait_for_selector("[data-gp-source-layer] .gp-drawer--source", timeout=8000)
    page.clock.run_for(400)
    shot(
        page,
        "step5c-source-drawer",
        vp,
        "⑤来源抽屉打开：立场徽标 + 引文摘录 + 针对命题",
        full_page=False,
        selectors={
            "[data-gp-source-layer]": ("[data-gp-source-layer]", 1),
            ".gp-drawer--source": (".gp-drawer--source", 1),
            "[data-gp-source-close]": ("[data-gp-source-close]", 1),
        },
    )

    # 抽屉里点开原文链接
    open_link = page.locator(".gp-source-open")
    href = open_link.get_attribute("href") if open_link.count() else None
    if open_link.count():
        open_link.scroll_into_view_if_needed()
        page.clock.run_for(200)
        shot(
            page,
            "step5d-drawer-original-link",
            vp,
            "⑤抽屉里的「前往官方原文核验」链接（点开前）",
            full_page=False,
            selectors={".gp-source-open": (".gp-source-open", 1)},
        )
        try:
            with page.context.expect_page(timeout=10000) as new_page_info:
                open_link.click()
            new_page = new_page_info.value
            new_page.wait_for_timeout(3000)
            new_page.screenshot(path=os.path.join(OUT, f"step5e-original-link-opened-{vp}.png"))
            opened_url = new_page.url
            record(
                vp,
                "step5e-original-link-opened",
                f"step5e-original-link-opened-{vp}.png",
                "⑤抽屉里的原文链接真的能点开（新开标签页）",
                {"href": href, "opened_url": opened_url},
                False,
                "无法判定：fixture 的来源 URL 是 example.org / example.cn 占位域名，"
                "新标签页确实开了但 DNS 不解析（chrome-error），所以「能不能打开真原文」"
                "离线验不了，得由真实走查（Evaluator 2）判。",
            )
            new_page.close()
        except PwError as err:
            record(
                vp,
                "step5e-original-link-opened",
                "(none)",
                "⑤抽屉里的原文链接真的能点开（新开标签页）",
                {"href": href, "error": err.__class__.__name__},
                False,
                "无法判定：新标签页在 10s 内没出现（fixture 占位域名无 DNS）。",
            )
    page.locator("[data-gp-source-close]").click()
    page.clock.run_for(300)

    # 争点两侧成组
    conflict = page.locator("[data-gp-conflict-id]").first
    if conflict.count():
        conflict.scroll_into_view_if_needed()
        page.clock.run_for(200)
    shot(
        page,
        "step4c-conflict-sides-complete",
        vp,
        "④完成态：争点支持侧与反驳侧各自成组",
        selectors={
            "[data-gp-conflict-id]": ("[data-gp-conflict-id]", 1),
            "[data-gp-conflict-side='support']": ("[data-gp-conflict-side='support']", 1),
            "[data-gp-conflict-side='contradict']": ("[data-gp-conflict-side='contradict']", 1),
        },
    )

    # 追问胶囊点击后只填入输入框（按 Enter 前）
    chip = page.locator(".gp-followup-chip").first
    chip_text = chip.inner_text().strip() if chip.count() else ""
    before = text_of(page, ".gp-followup-input")
    chip.click()
    page.clock.run_for(300)
    after = page.locator(".gp-followup-input").input_value()
    still_complete = page.locator("[data-gp-phase='complete']").count()
    shot(
        page,
        "step6b-chip-fill",
        vp,
        "⑥点推荐胶囊只是把问题填进输入框（未发送、未开新调查）",
        full_page=False,
        selectors={
            ".gp-followup-chip": (".gp-followup-chip", 3),
            ".gp-followup-input": (".gp-followup-input", 1),
            "[data-gp-phase='complete']": ("[data-gp-phase='complete']", 1),
        },
    )
    log(f"  胶囊文案={chip_text[:40]!r} → 填入值={after[:40]!r}（填入前输入框={before!r}）")
    record(
        vp,
        "step6b-chip-fills-only",
        f"step6b-chip-fill-{vp}.png",
        "点胶囊只填入输入框：不发新调查、页面仍停在完成态",
        {"chip": chip_text, "filled": after, "still_complete": still_complete},
        bool(after) and after.strip() in chip_text and still_complete == 1,
    )

    # 追问输入框：placeholder 会不会被框子截掉（移动端 375px 实测出现过）
    clipped = page.locator(".gp-followup-input").evaluate(
        "el=>({clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,"
        " placeholder: el.getAttribute('placeholder')})"
    )
    record(
        vp,
        "step6-followup-placeholder-clipped",
        f"step6-followup-{vp}.png",
        "⑥追问输入框的 placeholder 完整可见、不被框高截断",
        clipped,
        clipped["scrollHeight"] <= clipped["clientHeight"] + 1,
        "375px 下 placeholder「针对此结论追问，或展开未尽命题…（按 Enter 发送）」折成两行，"
        "第二行被输入框下沿切掉一半（见 step5-conclusion-mobile.png / step6-followup-mobile.png）。"
        "桌面端不出现。",
    )

    # 完成态下命题卡是否可展开（这里是 ?fixture=complete 的基线，不是真实顺序那条路径）
    heads = page.locator(".gp-claim-head")
    display = (
        heads.evaluate_all("els=>els.map(e=>getComputedStyle(e).display)") if heads.count() else []
    )
    detail = page.locator(".gp-claim-detail").count()
    record(
        vp,
        "step5c-complete-fixture-claim-expandable",
        f"step5-conclusion-{vp}.png",
        "⑤?fixture=complete 基线：卡片在 investigating 拍挂载 → 完成态默认展开",
        {
            "claim_head_display": display,
            "claim_detail_count": detail,
            "claim_expanded": heads.evaluate_all("els=>els.map(e=>e.getAttribute('aria-expanded'))")
            if heads.count()
            else [],
            "evidence_rows": page.locator(".gp-evidence-item").count(),
            "dom_conflicts": page.locator("[data-gp-conflict-id]").count(),
        },
        detail >= 1,
        "与 step5-flow-complete-claim-expandable 对照：同是完成态，展开与否取决于卡片首次挂载的拍子。",
    )


# --------------------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5211)
    parser.add_argument("--viewport", choices=[v[0] for v in VIEWPORTS], default=None)
    args = parser.parse_args()

    global BASE
    BASE = f"http://127.0.0.1:{args.port}"
    os.makedirs(OUT, exist_ok=True)
    server = ensure_server(args.port)
    targets = [v for v in VIEWPORTS if args.viewport in (None, v[0])]

    try:
        with sync_playwright() as p:
            for vp, width, height in targets:
                profile = f"/tmp/gp-walkthrough-{vp}-{os.getpid()}"
                shutil.rmtree(profile, ignore_errors=True)
                ctx = p.chromium.launch_persistent_context(
                    profile,
                    headless=True,
                    executable_path=CHROME,
                    viewport={"width": width, "height": height},
                    reduced_motion="reduce",
                )
                ctx.set_default_timeout(30000)
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                sink = {"console": [], "pageerror": [], "http": [], "reqfailed": []}
                wire_page(page, sink)
                try:
                    warm_fonts(page)
                except PwError as err:
                    log(f"!! {vp} 字体预热失败（继续）：{err.__class__.__name__}")
                # 冻住 fixture 的脚本时间：推进只能靠 run_for，截图再慢也不会跨拍。
                page.clock.install()
                page.clock.pause_at(page.evaluate("()=>Date.now()"))
                for part_name, part in [
                    ("first-beat 全流", part_a_flow),
                    ("单相 fixture 补拍", part_a2_closeups),
                    ("complete 完成态特写", part_b_complete),
                ]:
                    try:
                        part(page, vp)
                    except PwError as err:
                        log(f"!! {vp} / {part_name} 中断：{err}")
                        record(vp, f"aborted-{part_name}", "(none)", f"{part_name} 跑完", {"error": str(err)[:400]}, False)
                _timeline.append(
                    {
                        "viewport": vp,
                        "console_errors": sorted(set(sink["console"]))[:15],
                        "page_errors": sink["pageerror"][:10],
                        "http_4xx_5xx": sorted(set(sink["http"]))[:15],
                        "request_failed": sorted(set(sink["reqfailed"]))[:15],
                    }
                )
                ctx.close()
    finally:
        if server:
            server.terminate()
            log("已停掉自己起的 vite")

    with open(os.path.join(OUT, "offline-checks.json"), "w", encoding="utf-8") as fh:
        json.dump(_checks, fh, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT, "offline-timeline.json"), "w", encoding="utf-8") as fh:
        json.dump(_timeline, fh, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT, "offline-walkthrough.log"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(_log_lines) + "\n")

    bad = [c for c in _checks if not c["ok"]]
    log(f"自查条目 {len(_checks)} 条；未过 {len(bad)} 条")
    for c in bad:
        log(f"  MISS {c['step']} [{c['viewport']}] {c['expect']} -> {json.dumps(c['found'], ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
