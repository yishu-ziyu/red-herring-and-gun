// 只读导出几条已完成的调查做回放样例：事件流与结果都先过后端同一个公开清洗（publicStream.ts），再写进 public/fixtures。
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toPublicStreamEvent } from "../../../apps/server/src/http/publicStream.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DB = process.env.RHG_DB_FILE || "/Users/mahaoxuan/Desktop/AI-products/红鲱鱼/apps/server/.data/rhg.sqlite";
const RUNS = [
  { name: "sun", runId: "ff018d08-71e2-4d55-94c1-49936005ad56" },
  { name: "seafood", runId: "b31ce9c8-86af-473e-9fbf-f319e36c69c0" },
  { name: "lemon-image", runId: "ec42973b-c4b3-4043-8c92-16cde6550fbf" },
];

// 界面不渲染的检索诊断字段（通道、服务来源、模型串）在样例里也不留。
const DROP_KEYS = new Set(["model", "providerOrigins", "providers", "channels"]);
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !DROP_KEYS.has(k)).map(([k, v]) => [k, strip(v)]));
  }
  return value;
}

const db = new DatabaseSync(DB, { readOnly: true });
const out = resolve(here, "../public/fixtures");
mkdirSync(out, { recursive: true });
const index = [];
for (const { name, runId } of RUNS) {
  const run = db.prepare("SELECT runId, caseId, status, snapshot, createdAt, updatedAt FROM runs WHERE runId = ?").get(runId);
  if (!run) throw new Error(`missing run ${runId}`);
  const events = db.prepare("SELECT payload FROM run_events WHERE runId = ? ORDER BY eventSeq").all(runId)
    .map((row) => strip(toPublicStreamEvent(JSON.parse(row.payload))));
  const published = db.prepare("SELECT snapshot, report FROM run_results WHERE runId = ? AND kind = 'final' ORDER BY revision DESC LIMIT 1").get(runId);
  let report = published?.report ? JSON.parse(published.report) : null;
  if (!report) {
    const c = db.prepare("SELECT report FROM cases WHERE caseId = ?").get(run.caseId);
    if (c?.report) { try { report = JSON.parse(c.report); } catch {} }
  }
  const snapshot = JSON.parse(published?.snapshot ?? run.snapshot);
  const result = toPublicStreamEvent({ snapshot, report });
  const fixture = { name, runId, status: run.status, createdAt: run.createdAt, claim: snapshot.originalClaim, events, result };
  writeFileSync(resolve(out, `${name}.json`), JSON.stringify(fixture));
  index.push({ name, runId, createdAt: run.createdAt, claim: snapshot.originalClaim, label: snapshot.conclusion?.label ?? null, judgment: snapshot.conclusion?.judgment ?? null, events: events.length });
  console.log(name, runId, "events", events.length, "report", Boolean(report));
}
writeFileSync(resolve(out, "index.json"), JSON.stringify(index));
