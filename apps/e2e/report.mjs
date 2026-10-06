// 端到端产物：对一次运行目录做机器检查，写 checks.json 和 report.html。
// 用法：node report.mjs <运行目录> [对照的旧运行目录]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const [runDir, baselineDir] = process.argv.slice(2);
if (!runDir) throw new Error("用法：node report.mjs <运行目录> [对照的旧运行目录]");
const cases = JSON.parse(readFileSync(join(runDir, "cases.json"), "utf8"));
const FACE = { false: "不能信", true: "能信", mixed_misleading: "有真有假", unverified: "证据不足" };
const BADGE_FOR = { false: "refuted", true: "supported", mixed_misleading: "mixed", unverified: "unresolved" };
// 标准答案还在等用户裁决的说法：不计入判定命中。
const DISPUTED = new Set(JSON.parse(readFileSync(new URL("./disputed.json", import.meta.url), "utf8")));

function load(dir, id) {
  const p = join(dir, `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** 每条检查只回答通过或不通过；理由写给人看。 */
function checksFor(c, rec) {
  if (!rec) return { ran: { pass: false, why: "没有跑出结果（提交失败或脚本出错）" } };
  const report = rec.stored?.finalReport ?? {};
  const verdict = report.verdictType ?? null;
  const conclusion = String(report.conclusion ?? "");
  const hero = String(rec.heroText ?? "");
  const firstSentence = conclusion.split(/[。！？]/)[0] ?? "";
  const investigation = report.investigation ?? {};
  // 旧运行没记徽章字段时，用报告里的结论快照（界面徽章就是从它来的）。
  const badge = rec.badgeJudgment ?? investigation.conclusion?.judgment ?? null;
  const judgments = (investigation.claims ?? []).filter((claim) => claim.checkability !== "not-applicable").map((claim) => claim.judgment ?? "未判");
  const out = {
    completed: { pass: rec.state === "complete", why: `运行状态：${rec.state}` },
    badge_matches_verdict: {
      pass: !verdict || badge === BADGE_FOR[verdict],
      why: `整句判定 ${FACE[verdict] ?? verdict}，徽章 ${rec.badgeText ?? badge}`,
    },
    // 整句说站不住，却没有任何一条命题站不住（或整句说站得住，却没有一条站得住）：结论和逐条说明互相打架。
    verdict_backed_by_claims: {
      pass: !(verdict === "false" && !judgments.includes("refuted")) && !(verdict === "true" && !judgments.includes("supported")),
      why: `整句 ${FACE[verdict] ?? verdict}；各命题：${judgments.join("、") || "无"}`,
    },
    lead_not_self_contradicting: {
      pass: !(verdict === "false" && /尚未查清|撑不住|还查不清/.test(firstSentence)) && !(verdict === "unverified" && /不支持这条说法|撑得住/.test(firstSentence)),
      why: `首句：${firstSentence.slice(0, 60)}`,
    },
    no_dead_link_noise: { pass: !hero.includes("来源无法打开"), why: "结论卡里出现「来源无法打开」" },
    no_process_gap_noise: { pass: !/补查后仍缺：(当事方|地点|支撑证据)/.test(hero), why: "结论卡里出现检索流程的槽位缺口" },
    no_false_leftover: { pass: !hero.includes(`这些这次没查：「${c.claim.replace(/[。！？]$/, "")}`), why: "把整句原话说成没查" },
    sentences_complete: { pass: !/[一-龥]「[^」]{2,60}」尚未查清/.test(conclusion), why: "半句话直接接上下一句" },
  };
  if (!DISPUTED.has(c.id)) {
    out.verdict_matches_gold = { pass: FACE[verdict] === FACE[c.expected], why: `标准答案 ${FACE[c.expected]}，系统 ${FACE[verdict] ?? verdict}` };
  }
  return out;
}

const rows = cases.map((c) => {
  const rec = load(runDir, c.id);
  const checks = checksFor(c, rec);
  const base = baselineDir ? load(baselineDir, c.id) : null;
  return {
    id: c.id,
    claim: c.claim,
    expected: FACE[c.expected],
    verdict: FACE[rec?.stored?.finalReport?.verdictType] ?? null,
    baselineVerdict: base ? FACE[base.stored?.finalReport?.verdictType] ?? null : undefined,
    fallback: rec?.stored?.finalReport?._fallbackReason ?? null,
    seconds: rec?.seconds ?? null,
    screenshot: rec ? relative(runDir, join(runDir, `${c.id}.png`)) : null,
    checks,
    passAll: Object.values(checks).every((check) => check.pass),
  };
});

const names = [...new Set(rows.flatMap((r) => Object.keys(r.checks)))];
const perCheck = Object.fromEntries(names.map((n) => [n, rows.filter((r) => r.checks[n]?.pass).length + "/" + rows.filter((r) => r.checks[n]).length]));
const tapeReport = join(runDir, "tape", "_replay_report.jsonl");
const replay = existsSync(tapeReport)
  ? readFileSync(tapeReport, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {})
  : null;
const summary = {
  run: basename(runDir),
  generatedAt: new Date().toISOString(),
  cases: rows.length,
  passAll: rows.filter((r) => r.passAll).length,
  perCheck,
  fallback: rows.filter((r) => r.fallback).length,
  replay,
  baseline: baselineDir ? basename(baselineDir) : null,
};
writeFileSync(join(runDir, "checks.json"), JSON.stringify({ summary, rows }, null, 1));

const LABEL = {
  completed: "跑完", verdict_matches_gold: "判定对", badge_matches_verdict: "徽章一致", verdict_backed_by_claims: "整句有命题撑", lead_not_self_contradicting: "首句不矛盾",
  no_dead_link_noise: "无打不开噪音", no_process_gap_noise: "无流程缺口噪音", no_false_leftover: "不误报没查", sentences_complete: "句子完整",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>端到端 ${esc(summary.run)}</title><style>
body{margin:0;background:#faf8f3;color:#1c1917;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}main{max-width:1280px;margin:0 auto;padding:28px}
h1{font-size:22px;margin:0 0 4px}.muted{color:#8c867f}table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e7e5df;margin-top:14px}
th,td{padding:6px 8px;border-bottom:1px solid #e7e5df;text-align:left;vertical-align:top;font-size:13px}th{background:#f5f4ef}
.ok{color:#2f6b4f}.bad{color:#8f2d2a;font-weight:600}img{width:120px;border:1px solid #e7e5df;cursor:zoom-in}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.card{background:#fff;border:1px solid #e7e5df;border-radius:8px;padding:10px 14px}
.card b{font-size:20px;display:block}.lb{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;overflow:auto;cursor:zoom-out}.lb.open{display:block}.lb img{width:min(1710px,96vw);margin:3vh auto;display:block;cursor:zoom-out}
</style></head><body><main>
<h1>端到端结果：${esc(summary.run)}</h1>
<p class="muted">生成于 ${esc(summary.generatedAt)}${summary.baseline ? ` · 对照 ${esc(summary.baseline)}` : ""}${replay ? ` · 回放命中 ${replay.hit ?? 0}，未命中 ${replay.miss ?? 0}` : ""}</p>
<div class="cards"><div class="card"><b>${summary.passAll}/${summary.cases}</b>全部检查通过</div>
${names.map((n) => `<div class="card"><b>${perCheck[n]}</b>${esc(LABEL[n] ?? n)}</div>`).join("")}
<div class="card"><b>${summary.fallback}/${summary.cases}</b>走了兜底报告</div></div>
<table><tr><th>编号</th><th>说法</th><th>标准答案</th>${baselineDir ? "<th>之前</th>" : ""}<th>这次</th>${names.map((n) => `<th>${esc(LABEL[n] ?? n)}</th>`).join("")}<th>截图</th></tr>
${rows.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.claim)}</td><td>${esc(r.expected)}</td>${baselineDir ? `<td>${esc(r.baselineVerdict ?? "—")}</td>` : ""}<td class="${r.checks.verdict_matches_gold?.pass === false ? "bad" : ""}">${esc(r.verdict ?? "—")}${r.fallback ? "<br><span class=muted>兜底</span>" : ""}</td>
${names.map((n) => (r.checks[n] ? `<td class="${r.checks[n].pass ? "ok" : "bad"}" title="${esc(r.checks[n].why)}">${r.checks[n].pass ? "✓" : "✗"}</td>` : "<td class=muted>—</td>")).join("")}
<td>${r.screenshot ? `<img src="${esc(r.screenshot)}" alt="${esc(r.id)}">` : ""}</td></tr>`).join("\n")}
</table></main><div class="lb" id="lb"><img alt=""></div><script>
const lb=document.getElementById("lb");document.querySelectorAll("td img").forEach(i=>i.onclick=()=>{lb.querySelector("img").src=i.src;lb.classList.add("open");lb.scrollTop=0});lb.onclick=()=>lb.classList.remove("open");addEventListener("keydown",e=>{if(e.key==="Escape")lb.classList.remove("open")});
</script></body></html>`;
writeFileSync(join(runDir, "report.html"), html);
console.log(JSON.stringify(summary, null, 1));
