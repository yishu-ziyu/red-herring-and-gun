/**
 * Per search engine, over a recorded run: how much of the evidence the result actually uses did it find? (#144)
 *   npx tsx eval/answerBenchEngines.ts <label>
 * Reads outputs/answer-bench/<label>/results.jsonl, writes engines.json next to it. Used = relation 支持 or 反驳.
 * "soleKeyParts" = (case, part) pairs where every 支持/反驳 source of that part was found by this engine alone.
 * Also prints, per case, parts that kept ≤3 sources, with each engine's returned/kept counts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PipelineResult } from "./answerBenchScore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(resolve(HERE, "../../.."), "outputs", "answer-bench");

const label = process.argv[2];
if (!label) throw new Error("usage: answerBenchEngines.ts <label>");
const rows = readFileSync(join(OUT, label, "results.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { id: string; result: PipelineResult });

type EngineStats = { casesWithKept: number; kept: number; used: number; exclusiveUsed: number; soleKeyParts: number };
const engines: Record<string, EngineStats> = {};
const stat = (e: string) => (engines[e] ??= { casesWithKept: 0, kept: 0, used: 0, exclusiveUsed: 0, soleKeyParts: 0 });
const thinParts: Record<string, Array<{ part: string; keptTotal: number; returned: Record<string, number>; kept: Record<string, number> }>> = {};

for (const { id, result } of rows) {
  const perAtom = result.enginesPerAtom ?? {};
  const keptInCase = new Set<string>();
  for (const [part, c] of Object.entries(perAtom)) {
    for (const [e, n] of Object.entries(c.kept)) {
      stat(e).kept += n;
      if (n > 0) keptInCase.add(e);
    }
    if (c.keptTotal <= 3) (thinParts[id] ??= []).push({ part, keptTotal: c.keptTotal, returned: c.returned, kept: c.kept });
  }
  for (const e of keptInCase) stat(e).casesWithKept += 1;

  const used = (result.evidenceSources ?? []).filter((s) => s.relation === "支持" || s.relation === "反驳");
  for (const s of used) {
    const by = s.foundBy ?? [];
    for (const e of by) stat(e).used += 1;
    if (by.length === 1) stat(by[0]!).exclusiveUsed += 1;
  }
  for (const part of new Set(used.flatMap((s) => s.parts ?? []))) {
    const by = used.filter((s) => s.parts?.includes(part)).map((s) => s.foundBy ?? []);
    const sole = by[0]?.length === 1 ? by[0][0]! : null;
    if (sole && by.every((b) => b.length === 1 && b[0] === sole)) stat(sole).soleKeyParts += 1;
  }
}

writeFileSync(join(OUT, label, "engines.json"), JSON.stringify({ label, cases: rows.length, engines, thinParts }, null, 2));
console.log(JSON.stringify({ cases: rows.length, engines }, null, 2));
for (const [id, parts] of Object.entries(thinParts)) {
  console.log(`\n${id}`);
  for (const p of parts) console.log(`  kept ${p.keptTotal}  ${p.part.slice(0, 40)}  returned=${JSON.stringify(p.returned)} kept=${JSON.stringify(p.kept)}`);
}
