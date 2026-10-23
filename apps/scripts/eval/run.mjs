// Runs every claim in claims.json through the local API and compares the
// conclusion label with the expected one. Manual measurement, not a test:
//   API_PORT=3011 node scripts/dev.mjs --port 5181   (in another terminal)
//   node scripts/eval/run.mjs [--only id1,id2] [--concurrency 2]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appsDir = join(here, "..", "..");
const API = process.env.EVAL_API || "http://127.0.0.1:3011";
const DB = process.env.RHG_DB_FILE || join(appsDir, "server", ".data", "rhg.sqlite");

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = argValue("--only")?.split(",");
const concurrency = Number(argValue("--concurrency") || 2);

const LABEL_TEXT = {
  true: "属实", "mostly-true": "基本属实", "partly-true": "部分属实", exaggerated: "夸大了", false: "不属实",
  unresolved: "还查不清", uncheckable: "无法核对", disputed: "说法不一", opinion: "是观点，不分对错",
};

const items = JSON.parse(readFileSync(join(here, "claims.json"), "utf8")).filter((c) => !only || only.includes(c.id));

async function investigate(claim) {
  const started = Date.now();
  const res = await fetch(`${API}/api/agent/orchestrate-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim, intake: { text: claim, links: [], images: [], createdAt: started } }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = "", runId = null, ended = null;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.type === "run_started") runId = event.runId;
      if (event.type === "complete") ended = "complete";
      if (event.type === "error") ended = `error: ${event.message || event.code}`;
    }
    if (ended) break;
  }
  return { runId, ended: ended || "stream closed", seconds: Math.round((Date.now() - started) / 1000) };
}

function snapshotOf(runId) {
  if (!runId) return null;
  const out = execFileSync("sqlite3", ["-json", DB, `select snapshot from runs where runId='${runId.replace(/'/g, "")}'`]).toString();
  const row = JSON.parse(out || "[]")[0];
  return row?.snapshot ? JSON.parse(row.snapshot) : null;
}

async function evaluate(item) {
  try {
    const run = await investigate(item.claim);
    const snap = snapshotOf(run.runId);
    const got = LABEL_TEXT[snap?.conclusion?.label] || "（无结论）";
    const pass = got === item.expected ? "match" : (item.acceptable || []).includes(got) ? "acceptable" : "miss";
    return {
      id: item.id, category: item.category, claim: item.claim, expected: item.expected, acceptable: item.acceptable || [],
      got, pass, seconds: run.seconds, ended: run.ended, runId: run.runId,
      answer: snap?.conclusion?.directAnswer || snap?.conclusion?.reason || "",
      parts: (snap?.claims || []).map((c) => `${LABEL_TEXT[c.label] || "?"}｜${c.text}`),
    };
  } catch (error) {
    return { id: item.id, category: item.category, claim: item.claim, expected: item.expected, got: "（失败）", pass: "miss", ended: String(error) };
  }
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
  while (next < items.length) {
    const item = items[next++];
    const r = await evaluate(item);
    results.push(r);
    console.log(`${r.pass === "miss" ? "✗" : "✓"} [${r.category}] ${r.claim}\n    期望 ${r.expected} · 得到 ${r.got} · ${r.seconds ?? "-"}s`);
  }
}));

const byCategory = {};
for (const r of results) {
  const c = (byCategory[r.category] ||= { total: 0, match: 0, acceptable: 0 });
  c.total++; if (r.pass === "match") c.match++; if (r.pass === "acceptable") c.acceptable++;
}
console.log("\n分类  条数  完全对  可接受");
for (const [k, v] of Object.entries(byCategory)) console.log(`${k}  ${v.total}  ${v.match}  ${v.acceptable}`);
const secs = results.map((r) => r.seconds).filter(Number.isFinite).sort((a, b) => a - b);
if (secs.length) console.log(`用时中位数 ${secs[Math.floor(secs.length / 2)]}s`);

const outDir = join(appsDir, "..", "out", "eval", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
console.log(`结果：${join(outDir, "results.json")}`);
