// 只读地从开发库导出几次已完成核查，存成前端回放用的 fixture（dev-fixtures/，只在开发模式由 vite 提供）。
// 事件先过后端自己的公开流清洗（apps/server/src/http/publicStream.ts），和浏览器从 SSE 收到的一致。
// 运行：node --experimental-strip-types scripts/export-fixtures.mjs
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toPublicStreamEvent } from "../server/src/http/publicStream.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.RHG_DB_FILE || "/Users/mahaoxuan/Desktop/AI-products/红鲱鱼/apps/server/.data/rhg.sqlite";
const outDir = join(here, "../dev-fixtures");
mkdirSync(outDir, { recursive: true });

const PICKS = [
  { name: "sun", runId: "ff018d08-71e2-4d55-94c1-49936005ad56" },
  { name: "banana", runId: "ec66d15a-fcdd-42c5-a4a8-a5dc144fc86b" },
  { name: "lemon-image", runId: "ec42973b-c4b3-4043-8c92-16cde6550fbf" },
];

const db = new DatabaseSync(dbFile, { readOnly: true });
const index = [];
for (const { name, runId } of PICKS) {
  const run = db.prepare("SELECT runId, status, snapshot, createdAt, updatedAt FROM runs WHERE runId = ?").get(runId);
  if (!run) throw new Error(`missing run ${runId}`);
  const events = db.prepare("SELECT payload FROM run_events WHERE runId = ? ORDER BY eventSeq").all(runId)
    .map((row) => toPublicStreamEvent(JSON.parse(row.payload)));
  const activities = db.prepare("SELECT payload FROM run_activities WHERE runId = ? ORDER BY seq").all(runId)
    .map((row) => JSON.parse(row.payload));
  const result = db.prepare("SELECT revision, kind, snapshot, report, createdAt FROM run_results WHERE runId = ? ORDER BY revision DESC LIMIT 1").get(runId);
  const report = result?.report ? JSON.parse(result.report) : null;
  // 只留前端用得到的判定记录，报告其余字段（含内部诊断）不进 fixture。
  const verdictDecision = report?._verdictDecision ?? null;
  const snapshot = result ? JSON.parse(result.snapshot) : JSON.parse(run.snapshot);
  const fixture = {
    fixture: name,
    runId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    snapshot: toPublicStreamEvent({ snapshot }).snapshot,
    verdictDecision,
    events,
    activities,
  };
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(fixture));
  index.push({ fixture: name, runId, claim: snapshot.originalClaim.slice(0, 2000), label: snapshot.conclusion?.label ?? null, judgment: snapshot.conclusion?.judgment ?? null, createdAt: run.createdAt, events: events.length });
  console.log(name, runId, "events", events.length, "activities", activities.length, "label", snapshot.conclusion?.label ?? snapshot.conclusion?.judgment);
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));
