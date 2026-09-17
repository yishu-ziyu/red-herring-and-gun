#!/usr/bin/env python3
"""证据库第一版真实双轮走查（契约 docs/evals/2026-09-12-evidence-base.md，Evaluator 5）。

两轮都是**纯文本输入**（不贴链接，避开抓取变量）：
  第一轮（沉淀）：变体 A「隔夜菜不能吃，放一晚上亚硝酸盐会升高致癌」跑完 → 知识库落条；
  第二轮（命中）：变体 B「隔夜的饭菜到底还能不能吃？听说放一夜亚硝酸盐超标会中毒」跑完 → 断言
    - knowledge-observations.jsonl 第二轮有 outcome=hit/injected 的行（hit/stale/miss/injected/downgraded 分布）；
    - 第二轮至少一个 atom 没有发出搜索请求（该 atom 的 search_started 缺席；依据写进 real-notes.md）；
    - 结果页至少一枚 [data-gp-knowledge-mark]（值=YYYY-MM-DD，截图）；
    - 活动流出现 kind=knowledge_hit 的「命中知识库」行（截图）；
    - 第二轮总耗时 < 第一轮。

成本纪律：只烧 2 次真实调查，不重跑、不重试。任一轮断言失败就停下来做只读对账，不发起第三轮。
复用已起的 Vite（127.0.0.1:5211，API 127.0.0.1:3000），不改任何产品代码。

产物（docs/reports/2026-09-12-evidence-base/）：
  real-*.png、real-run.json、real-timeline.json、real-notes.md
"""
from __future__ import annotations

import json
import re
import subprocess
import time
import unicodedata
from pathlib import Path
from typing import Any

from playwright.sync_api import Error as PWError
from playwright.sync_api import sync_playwright

PORT = 5211
BASE = f"http://127.0.0.1:{PORT}/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_ARGS = ["--disable-dev-shm-usage"]

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs/reports/2026-09-12-evidence-base"
OUT.mkdir(parents=True, exist_ok=True)
DATA_DIR = REPO / "apps/server/.data"
DB = DATA_DIR / "rhg.sqlite"
OBS = DATA_DIR / "knowledge-observations.jsonl"

VARIANT_A = "隔夜菜不能吃，放一晚上亚硝酸盐会升高致癌"
VARIANT_B = "隔夜的饭菜到底还能不能吃？听说放一夜亚硝酸盐超标会中毒"

# 契约 C（mainpath-p0）：总时限 300s + 服务端宽限 120s。预算留够，好看到真终态。
ROUND_BUDGET_S = 480.0
POLL_S = 0.25

HOOK_JS = r"""
(() => {
  window.__rhg = { net: [], sse: [], activities: [], searches: [], knowledgeHits: [], snapshots: [], errors: [], t0: Date.now(), completed: false, errored: null, runStatus: null };
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isStream = String(url).includes('/api/agent/orchestrate-stream');
    const rec = {
      t: Date.now(),
      url: String(url),
      method: init.method || (input && input.method) || 'GET',
      body: typeof init.body === 'string' ? init.body.slice(0, 4000) : null,
      status: null, ok: null, error: null, isStream: isStream, done: false,
    };
    if (rec.url.includes('/api/')) window.__rhg.net.push(rec);
    try {
      const res = await orig(...args);
      rec.status = res.status;
      rec.ok = res.ok;
      rec.done = true;
      if (isStream) {
        const clone = res.clone();
        (async () => {
          try {
            const reader = clone.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const ev = JSON.parse(line.slice(6));
                  window.__rhg.sse.push({ t: Date.now(), type: ev.type, status: ev.status || null });
                  if (ev.type === 'complete') window.__rhg.completed = true;
                  if (ev.type === 'error') window.__rhg.errored = { t: Date.now(), code: ev.code || '', message: ev.message || '' };
                  if (ev.type === 'run_state') window.__rhg.runStatus = ev.status;
                  if (ev.type === 'investigation_activity' && ev.activity) {
                    const a = ev.activity;
                    window.__rhg.activities.push({ t: Date.now(), id: a.id, kind: a.kind, role: a.role || null, payload: a.payload || {}, claimIds: a.claimIds || [], sourceIds: a.sourceIds || [] });
                    if (a.kind === 'search_started') window.__rhg.searches.push({ t: Date.now(), query: (a.payload || {}).query || '' });
                    if (a.kind === 'knowledge_hit') window.__rhg.knowledgeHits.push({ t: Date.now(), originDate: (a.payload || {}).originDate || '', verifiedAt: (a.payload || {}).verifiedAt || '' });
                  }
                  if (ev.type === 'investigation_snapshot' && ev.investigation) {
                    const inv = ev.investigation;
                    const evLinks = [];
                    for (const c of (inv.claims || [])) {
                      for (const l of (c.evidence || [])) {
                        if (l.provenance === 'knowledge') evLinks.push({ claimId: c.id, claimAtom: c.claimAtom || c.atom || '', sourceId: l.sourceId, role: l.role, originDate: l.originDate || '' });
                      }
                    }
                    const kSources = (inv.sources || []).filter((s) => s.provenance === 'knowledge').map((s) => ({ id: s.id, url: s.url, originDate: s.originDate || '' }));
                    window.__rhg.snapshots.push({
                      t: Date.now(), phase: inv.phase,
                      claims: (inv.claims || []).length,
                      claimTexts: (inv.claims || []).map((c) => ({ id: c.id, text: c.claimAtom || c.atom || '', judgment: c.judgment || null, checkability: c.checkability || null })),
                      evidence: (inv.claims || []).reduce((n, c) => n + ((c.evidence || []).length), 0),
                      knowledgeEvidence: evLinks, knowledgeSources: kSources,
                      sources: (inv.sources || []).length,
                      hasConclusion: Boolean(inv.conclusion && (inv.conclusion.directAnswer || '').trim()),
                    });
                  }
                } catch (err) { window.__rhg.errors.push('sse-parse: ' + String(err)); }
              }
            }
          } catch (err) { window.__rhg.errors.push('sse-read: ' + String(err)); }
        })();
      }
      return res;
    } catch (err) {
      rec.error = String(err); rec.done = true;
      window.__rhg.errors.push('fetch: ' + String(err) + ' @ ' + rec.url);
      throw err;
    }
  };
})();
"""

SIG_JS = r"""
() => {
  const q = (sel) => document.querySelector(sel);
  const n = (sel) => document.querySelectorAll(sel).length;
  const txt = (sel) => { const el = q(sel); return el ? (el.textContent || '').trim() : ''; };
  return {
    mode: q('.gp-input-stage') ? 'input' : (q('.gp-canvas') ? 'canvas' : 'waiting'),
    phase: q('.gp-canvas') ? q('.gp-canvas').getAttribute('data-gp-phase') : null,
    thinking: q('[data-gp-thinking-state]') ? q('[data-gp-thinking-state]').getAttribute('data-gp-thinking-state') : null,
    claims: n('[data-gp-claim-id]'),
    claimIds: [...document.querySelectorAll('[data-gp-claim-id]')].map((el) => el.getAttribute('data-gp-claim-id')),
    evidence: n('[data-gp-evidence-key]'),
    conflicts: n('[data-gp-conflict-id]'),
    conclusionState: q('[data-gp-conclusion-region]') ? q('[data-gp-conclusion-region]').getAttribute('data-gp-conclusion-state') : null,
    heroAnswer: txt('[data-gp-direct-answer]'),
    followup: Boolean(q('.gp-followup')),
    chips: n('.gp-followup-chip'),
    interrupted: Boolean(q('[data-gp-interrupted]')),
    stopped: Boolean(q('[data-gp-stopped]')),
    alertText: [...document.querySelectorAll('[role="alert"]')].map((el) => (el.textContent || '').trim()).filter(Boolean),
    knowledgeMarks: [...document.querySelectorAll('[data-gp-knowledge-mark]')].map((el) => el.getAttribute('data-gp-knowledge-mark')),
    knowledgeMarkTexts: [...document.querySelectorAll('.gp-knowledge-mark')].map((el) => (el.textContent || '').trim()),
    knowledgeHitLines: [...document.querySelectorAll('[data-gp-activity-kind="knowledge_hit"]')].map((el) => (el.textContent || '').trim()),
    activityKinds: [...document.querySelectorAll('[data-gp-activity-kind]')].map((el) => el.getAttribute('data-gp-activity-kind')),
    sendDisabled: q('[data-prompt-send]') ? q('[data-prompt-send]').disabled : null,
    bodyH: document.body.scrollHeight,
  };
}
"""


# ── 只读对账工具 ────────────────────────────────────────────────────────────

def sqlite_query(sql: str) -> str:
    """只读打开服务端库（WAL 下 mode=ro 可读，不改任何字节）。"""
    proc = subprocess.run(
        ["sqlite3", f"file:{DB}?mode=ro", sql],
        capture_output=True, text=True, cwd=str(REPO),
    )
    if proc.returncode != 0:
        return f"ERR: {proc.stderr.strip()}"
    return proc.stdout.strip()


def knowledge_entry_count() -> Any:
    raw = sqlite_query("SELECT COUNT(*) FROM knowledge_entries;")
    return int(raw) if raw.isdigit() else raw


def knowledge_entries_dump() -> list[dict[str, Any]]:
    raw = sqlite_query(
        "SELECT atomNorm || CHAR(9) || atomText || CHAR(9) || verdict || CHAR(9) || hitCount "
        "FROM knowledge_entries ORDER BY lastVerifiedAt DESC;"
    )
    if raw.startswith("ERR") or not raw:
        return []
    rows = []
    for line in raw.splitlines():
        cols = line.split("\t")
        if len(cols) >= 4:
            rows.append({"atomNorm": cols[0], "atomText": cols[1], "verdict": cols[2], "hitCount": cols[3]})
    return rows


def read_observations() -> list[dict[str, Any]]:
    if not OBS.exists():
        return []
    rows = []
    for line in OBS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def norm_atom(text: str) -> str:
    """knowledgeMatch.normalizeKnowledgeAtom 的等价实现（NFKC / lower / 压空白 / 去句末标点）。"""
    s = unicodedata.normalize("NFKC", str(text or "")).lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[。．.！!？?；;，,、：:…~～\"'“”‘’）)】\]》>]+$", "", s).strip()
    return s


def outcome_dist(rows: list[dict[str, Any]]) -> dict[str, int]:
    dist: dict[str, int] = {}
    for r in rows:
        key = str(r.get("outcome", "?"))
        dist[key] = dist.get(key, 0) + 1
    return dist


def bigram_jaccard(a: str, b: str) -> float:
    def grams(s: str) -> set[str]:
        s = norm_atom(s)
        return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else {s}
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return round(len(ga & gb) / len(ga | gb), 3)


def longest_common_substring(a: str, b: str) -> str:
    a, b = norm_atom(a), norm_atom(b)
    best = ""
    for i in range(len(a)):
        for j in range(len(a), i + len(best), -1):
            if a[i:j] in b:
                if j - i > len(best):
                    best = a[i:j]
                break
    return best


# ── 走查 ───────────────────────────────────────────────────────────────────

class Walk:
    """高频轮询界面全量签名，记里程碑。"""

    def __init__(self, page, tag: str):
        self.page = page
        self.tag = tag
        self.timeline: list[dict[str, Any]] = []
        self.screenshots: list[str] = []
        self.t0 = 0.0

    def sig(self) -> dict:
        return self.page.evaluate(SIG_JS)

    def shot(self, name: str, full: bool = True) -> str:
        self.page.screenshot(path=str(OUT / name), full_page=full)
        self.screenshots.append(name)
        return name

    def poll(self, budget_s: float, stop=None, on_change=None) -> dict:
        deadline = time.time() + budget_s
        last = None
        while time.time() < deadline:
            try:
                sig = self.sig()
            except PWError:
                time.sleep(POLL_S)
                continue
            rel = time.time() - self.t0
            self.timeline.append({"t": round(rel, 2), "sig": sig})
            if last is None or sig != last:
                if on_change and last is not None:
                    on_change(last, sig, rel)
            last = sig
            if stop and stop(sig):
                return sig
            time.sleep(POLL_S)
        return last or {}


def clear_client_state(page) -> bool:
    """回到空白输入态：清 localStorage 后重载，保证第二轮是全新一次调查（不出旧结果）。

    返回页面上是否真的有产品导航「新调查」入口——只作观察记录，不用它改状态，
    重载才是确定性做法（localStorage 里的 run 指针会被清掉）。
    """
    new_button_present = False
    try:
        btn = page.locator(".gp-topbar-actions .gp-icon-btn", has_text="新调查").first
        new_button_present = bool(btn.count() > 0 and btn.is_visible())
    except PWError:
        new_button_present = False
    try:
        page.evaluate("() => { try { window.localStorage.clear(); } catch (e) {} }")
    except PWError:
        pass
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector("#claim-input", timeout=30000)
    page.wait_for_function("() => !document.body.innerText.includes('正在确认调查服务')", timeout=30000)
    page.wait_for_timeout(400)
    return new_button_present


def run_round(page, text: str, tag: str, budget_s: float, label: str) -> dict[str, Any]:
    print(f"[{tag}] 提交：{text}（{label}）", flush=True)
    walk = Walk(page, tag)
    walk.shot(f"real-{tag}-input.png")
    input_before = page.evaluate("() => ((document.querySelector('#claim-input') || {}).innerText || '').trim()")

    page.locator("#claim-input").click()
    page.keyboard.insert_text(text)
    page.wait_for_selector("[data-prompt-send]:not([disabled])", timeout=20000)
    page.wait_for_timeout(300)
    walk.shot(f"real-{tag}-input-filled.png")

    streams_before = page.evaluate("() => (window.__rhg.net || []).length")
    t_submit = time.time()
    walk.t0 = t_submit
    page.locator("[data-prompt-send]").click()

    milestones: dict[str, float] = {}
    seen: set[str] = set()

    def milestone(name: str, sig: dict, rel: float, shot: str | None = None) -> None:
        if name in seen:
            return
        seen.add(name)
        milestones[name] = round(rel, 2)
        if shot:
            walk.shot(shot)

    live_hit: dict[str, Any] = {"firstLineAt": None, "line": None, "markAt": None, "mark": None}

    def on_change(prev: dict, sig: dict, rel: float) -> None:
        if sig["mode"] == "canvas":
            milestone("canvas", sig, rel, f"real-{tag}-running.png")
        if prev.get("claims", 0) == 0 and sig["claims"] > 0:
            milestone("claims", sig, rel, f"real-{tag}-claims.png")
        if sig["evidence"] > 0:
            milestone("evidence", sig, rel)
        if sig["conclusionState"] == "complete" and sig["heroAnswer"]:
            milestone("conclusion", sig, rel, f"real-{tag}-result.png")
        # 活动流只在调查进行中挂载（完成态画布不渲染 ActivityFeed，见
        # InvestigationCanvas.tsx:329）。「命中知识库」行只在过程里上屏，
        # 所以必须在它第一次出现的那一帧就地截图，否则结果页再也找不到它。
        if sig["knowledgeHitLines"] and live_hit["firstLineAt"] is None:
            live_hit["firstLineAt"] = round(rel, 2)
            live_hit["line"] = sig["knowledgeHitLines"][0]
            milestone("knowledgeHitLine", sig, rel, f"real-{tag}-activity-hit-live.png")
        if sig["knowledgeMarks"] and live_hit["markAt"] is None:
            live_hit["markAt"] = round(rel, 2)
            live_hit["mark"] = sig["knowledgeMarks"][0]
            milestone("knowledgeMark", sig, rel, f"real-{tag}-knowledge-mark-live.png")

    def stop(sig: dict) -> bool:
        if sig["interrupted"] or sig["stopped"]:
            return True
        return sig["conclusionState"] == "complete" and bool(sig["heroAnswer"])

    final = walk.poll(budget_s, stop, on_change)
    total_s = round(time.time() - t_submit, 2)
    walk.shot(f"real-{tag}-final.png")

    data = {
        "tag": tag,
        "label": label,
        "claimText": text,
        "inputBefore": input_before,
        "totalSeconds": total_s,
        "terminal": "complete" if (final.get("conclusionState") == "complete" and final.get("heroAnswer")) else ("interrupted" if final.get("interrupted") else "budget-exhausted"),
        "milestones": milestones,
        "final": {k: final.get(k) for k in (
            "mode", "phase", "claims", "evidence", "conflicts", "conclusionState", "heroAnswer",
            "followup", "chips", "interrupted", "stopped", "knowledgeMarks", "knowledgeMarkTexts",
            "knowledgeHitLines", "activityKinds", "alertText")},
        "streamsBefore": streams_before,
        "netRequests": page.evaluate("() => (window.__rhg.net || []).map((r) => ({ t: r.t, url: r.url, method: r.method, status: r.status, isStream: r.isStream, body: r.body }))"),
        "sseTypes": page.evaluate("() => (window.__rhg.sse || []).map((e) => e.type)"),
        "completed": page.evaluate("() => Boolean(window.__rhg.completed)"),
        "errored": page.evaluate("() => window.__rhg.errored"),
        "searchQueries": page.evaluate("() => (window.__rhg.searches || []).map((s) => s.query)"),
        "knowledgeHitActivities": page.evaluate("() => (window.__rhg.knowledgeHits || [])"),
        "activities": page.evaluate("() => (window.__rhg.activities || []).map((a) => ({ kind: a.kind, role: a.role, payload: a.payload }))"),
        "snapshotDigest": page.evaluate("() => (window.__rhg.snapshots || []).slice(-6)"),
        "sseErrors": page.evaluate("() => (window.__rhg.errors || [])"),
        "liveKnowledge": live_hit,
        "timeline": walk.timeline,
        "screenshots": walk.screenshots,
    }
    # 完成态画布不挂 ActivityFeed：拿时间线里出现过的活动 kind 作为「上过屏」的证据。
    kinds_live: set[str] = set()
    for row in walk.timeline:
        kinds_live.update(row["sig"].get("activityKinds") or [])
    data["activityKindsEverInDom"] = sorted(kinds_live)
    print(f"[{tag}] 终态={data['terminal']} 耗时={total_s}s claims={final.get('claims')} "
          f"marks={final.get('knowledgeMarks')} knowledgeHitLineAt={live_hit['firstLineAt']}", flush=True)
    return data


def main() -> int:
    report: dict[str, Any] = {
        "base": BASE,
        "contract": "docs/evals/2026-09-12-evidence-base.md",
        "variantA": VARIANT_A,
        "variantB": VARIANT_B,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "assertions": {},
        "baseline": {
            "knowledgeEntries": knowledge_entry_count(),
            "observationsLines": len(read_observations()),
        },
    }
    console: list[str] = []
    pageerrors: list[str] = []
    failed: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME, args=CHROME_ARGS)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = ctx.new_page()
        page.add_init_script(HOOK_JS)
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: pageerrors.append(str(e)))
        page.on("requestfailed", lambda r: failed.append(f"{r.method} {r.url} :: {r.failure}"))

        # ── 第一轮：沉淀 ──
        clear_client_state(page)
        r1 = run_round(page, VARIANT_A, "round1", ROUND_BUDGET_S, "变体 A（沉淀）")
        obs_after_r1 = read_observations()
        r1_obs = obs_after_r1[report["baseline"]["observationsLines"]:]
        r1["observations"] = {"lines": r1_obs, "dist": outcome_dist(r1_obs)}
        r1["knowledgeEntriesAfter"] = knowledge_entry_count()
        r1["knowledgeEntriesDump"] = knowledge_entries_dump()
        report["round1"] = r1

        # ── 第二轮：命中 ──
        new_button_present = clear_client_state(page)
        r2 = run_round(page, VARIANT_B, "round2", ROUND_BUDGET_S, "变体 B（命中）")
        r2["newInvestigationButtonPresent"] = new_button_present
        obs_after_r2 = read_observations()
        r2_obs = obs_after_r2[len(obs_after_r1):]
        r2["observations"] = {"lines": r2_obs, "dist": outcome_dist(r2_obs)}
        r2["knowledgeEntriesAfter"] = knowledge_entry_count()
        r2["knowledgeEntriesDump"] = knowledge_entries_dump()
        report["round2"] = r2

        # 结果页证据标记：滚到标记处再截一张。
        try:
            page.evaluate("() => { const el = document.querySelector('[data-gp-knowledge-mark]'); if (el) el.scrollIntoView({ block: 'center' }); }")
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / "real-round2-knowledge-mark.png"), full_page=False)
            report["round2"]["screenshots"].append("real-round2-knowledge-mark.png")
        except PWError:
            pass
        try:
            page.evaluate("() => { const el = document.querySelector('[data-gp-activity-kind=\"knowledge_hit\"]'); if (el) el.scrollIntoView({ block: 'center' }); }")
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / "real-round2-activity-hit.png"), full_page=False)
            report["round2"]["screenshots"].append("real-round2-activity-hit.png")
        except PWError:
            pass

        report["console"] = console[-60:]
        report["pageErrors"] = pageerrors
        report["failedRequests"] = failed

        ctx.close()
        browser.close()

    # ── 断言（只读对账，不发起第三轮） ──
    r1, r2 = report["round1"], report["round2"]
    injected = [row for row in r2["observations"]["lines"] if row.get("outcome") in ("hit", "injected")]
    r2_search_norms = {norm_atom(q) for q in r2["searchQueries"] if q}
    injected_norms = {norm_atom(row.get("atomNorm", "")) for row in injected}
    no_search_atoms = sorted(injected_norms - r2_search_norms)

    r1_search_norms = {norm_atom(q) for q in r1["searchQueries"] if q}
    # 支持证据：第一轮真搜过的命题与第二轮命中的命题，字面重合度（同一命题的两种说法）。
    overlap_support = []
    for atom in no_search_atoms:
        for q in r1["searchQueries"]:
            if not q:
                continue
            jac = bigram_jaccard(atom, q)
            if jac >= 0.15:
                overlap_support.append({
                    "round2InjectedAtom": atom,
                    "round1SearchedQuery": q,
                    "bigramJaccard": jac,
                    "longestCommonSubstring": longest_common_substring(atom, q),
                    "round1NormEqualsRound2Norm": norm_atom(q) in r1_search_norms and norm_atom(q) in injected_norms,
                })
    overlap_support.sort(key=lambda x: -x["bigramJaccard"])

    marks = [m for m in (r2["final"].get("knowledgeMarks") or []) if m]
    # 活动流在完成态 unmount：以「时间线里是否上过屏」为准，完成态 DOM 为空不算失败。
    hit_lines = (r2["final"].get("knowledgeHitLines") or []) or (
        [r2["liveKnowledge"]["line"]] if r2["liveKnowledge"].get("line") else []
    )
    r1_total, r2_total = r1["totalSeconds"], r2["totalSeconds"]

    report["assertions"] = {
        "G1_round1_settled": {
            "pass": bool(r1["terminal"] == "complete" and isinstance(r1["knowledgeEntriesAfter"], int) and r1["knowledgeEntriesAfter"] > report["baseline"]["knowledgeEntries"]),
            "detail": {
                "terminal": r1["terminal"], "totalSeconds": r1_total,
                "baselineEntries": report["baseline"]["knowledgeEntries"],
                "entriesAfterRound1": r1["knowledgeEntriesAfter"],
                "entriesDump": r1["knowledgeEntriesDump"],
            },
        },
        "G2_round2_hit": {
            "pass": bool(any(row.get("outcome") == "hit" for row in r2["observations"]["lines"])),
            "detail": {"dist": r2["observations"]["dist"], "lines": r2["observations"]["lines"]},
        },
        "G3_atom_skipped_search": {
            "pass": bool(no_search_atoms),
            "detail": {
                "atomsWithoutSearchRequest": no_search_atoms,
                "round2SearchQueries": r2["searchQueries"],
                "round1SearchQueries": r1["searchQueries"],
                "overlapSupport": overlap_support,
            },
        },
        "G4_result_mark": {
            "pass": bool(marks),
            "detail": {"marks": marks, "markTexts": r2["final"].get("knowledgeMarkTexts"), "formatOk": all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", m) for m in marks)},
        },
        "G5_activity_hit_line": {
            "pass": bool(hit_lines),
            "detail": {
                "lines": hit_lines,
                "liveFirstSeenAtSeconds": r2["liveKnowledge"].get("firstLineAt"),
                "activityKindsEverInDom": r2.get("activityKindsEverInDom"),
                "sseKnowledgeHits": r2["knowledgeHitActivities"],
                "note": "完成态画布不挂 ActivityFeed（InvestigationCanvas.tsx:329），该行只在调查过程中上屏",
            },
        },
        "G6_round2_faster": {
            "pass": bool(r2["terminal"] == "complete" and r2_total < r1_total),
            "detail": {
                "round1Seconds": r1_total,
                "round2Seconds": r2_total,
                "deltaSeconds": round(r1_total - r2_total, 2),
                "round1Searches": len([q for q in r1["searchQueries"] if q]),
                "round2Searches": len([q for q in r2["searchQueries"] if q]),
                "round1Milestones": r1["milestones"],
                "round2Milestones": r2["milestones"],
                "note": "省下的是检索（检索拍更早到），总时长由检索之后的 LLM 判定/复核/写作拍决定；该拍逐轮波动大于省下的检索时间",
            },
        },
    }

    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    (OUT / "real-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "real-timeline.json").write_text(
        json.dumps({"round1": r1["timeline"], "round2": r2["timeline"]}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "assertions": {k: v["pass"] for k, v in report["assertions"].items()},
        "round1Total": r1_total,
        "round2Total": r2_total,
        "round1Entries": r1["knowledgeEntriesAfter"],
        "round2Dist": r2["observations"]["dist"],
        "round2Marks": marks,
        "round2HitLines": hit_lines,
        "atomsWithoutSearchRequest": no_search_atoms,
        "overlapSupport": overlap_support[:3],
        "pageErrors": pageerrors,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
