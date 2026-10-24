// 只读导出：从本地 SQLite 取已完成 run 的事件和结果，按公开流同一清洗规则（server/src/http/publicStream.ts）处理后存成回放用 fixture。
// 运行：node --import <tsx loader> scripts/export-fixtures.ts <db file>
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { toPublicStreamEvent } from "../../../apps/server/src/http/publicStream.ts";

const PICKS: Record<string, string> = {
  sun: "ff018d08-71e2-4d55-94c1-49936005ad56",
  ham: "d33aaa6d-a048-4e6c-a55d-179e70ce7b65",
  meat: "cd02e5d1-398f-4fe1-871e-c5d87a0bd0e8",
  dates: "95baf46b-5e4d-4a53-aff3-f7638df4d771",
};

const db = new DatabaseSync(process.argv[2]!, { readOnly: true });
const index: unknown[] = [];
for (const [name, runId] of Object.entries(PICKS)) {
  const run = db.prepare("SELECT * FROM runs WHERE runId = ?").get(runId) as Record<string, any>;
  const events = (db.prepare("SELECT payload FROM run_events WHERE runId = ? ORDER BY eventSeq").all(runId) as { payload: string }[])
    .map((row) => toPublicStreamEvent(JSON.parse(row.payload)));
  const res = db.prepare("SELECT * FROM run_results WHERE runId = ? AND kind = 'final' ORDER BY revision DESC LIMIT 1").get(runId) as Record<string, any>;
  const result = toPublicStreamEvent({
    protocolVersion: 2, resultId: res.resultId, runId, revision: res.revision, kind: res.kind,
    snapshot: JSON.parse(res.snapshot), report: res.report ? JSON.parse(res.report) : null, createdAt: res.createdAt,
  });
  const snapshot = JSON.parse(run.snapshot);
  const meta = { fixture: name, runId, claim: snapshot.originalClaim, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt };
  writeFileSync(new URL(`../public/fixtures/${name}.json`, import.meta.url), JSON.stringify({ meta, events, result }));
  index.push({ ...meta, label: snapshot.conclusion?.label ?? null });
  console.log(name, runId, events.length, "events", snapshot.conclusion?.label);
}
writeFileSync(new URL(`../public/fixtures/index.json`, import.meta.url), JSON.stringify(index, null, 1));
