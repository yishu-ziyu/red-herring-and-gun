/**
 * For each case of a recorded run: did the benchmark's key-source host / host+path appear anywhere in the raw
 * search responses on tape (before the pipeline's filtering)?  npx tsx eval/answerBenchRawHits.ts <label>
 * Writes outputs/answer-bench/<label>/raw-search-key-hits.json. Scans tapes of search hosts only.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUrlKey, type BenchCase } from "./answerBenchScore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(resolve(HERE, "../../.."), "outputs", "answer-bench");
const SEARCH_TAPE = /anysearch|metaso|tavily|exa\.ai|360\.cn\/v2|coding_plan\/search|web_search/;

const label = process.argv[2];
if (!label) throw new Error("usage: answerBenchRawHits.ts <label>");
const bench = JSON.parse(readFileSync(join(HERE, "answerBench.json"), "utf8")) as BenchCase[];
const out: Record<string, { rawUrls: number; keyHost: boolean; keyHostPath: boolean }> = {};
for (const c of bench) {
  const dir = join(OUT, "tapes", label, c.id);
  if (!existsSync(dir)) continue;
  const urls = new Set<string>();
  for (const key of readdirSync(dir)) {
    for (const f of readdirSync(join(dir, key)).filter((n) => n.endsWith(".json"))) {
      const t = JSON.parse(readFileSync(join(dir, key, f), "utf8")) as { url?: string; body?: string };
      if (!t.body || !SEARCH_TAPE.test(t.url ?? "")) continue;
      for (const m of t.body.replace(/\\\//g, "/").matchAll(/https?:\/\/[^\s"'<>\\)\]]+/g)) urls.add(m[0]);
    }
  }
  const keys = c.parts.flatMap((p) => p.quotes ?? []).map((q) => normalizeUrlKey(q.url)).filter((k) => k !== null);
  const got = [...urls].map(normalizeUrlKey).filter((k) => k !== null);
  out[c.id] = {
    rawUrls: urls.size,
    keyHost: got.some((g) => keys.some((k) => k.host === g.host)),
    keyHostPath: got.some((g) => keys.some((k) => k.hostPath === g.hostPath)),
  };
}
writeFileSync(join(OUT, label, "raw-search-key-hits.json"), JSON.stringify(out, null, 2));
const v = Object.values(out);
console.log(JSON.stringify({ cases: v.length, keyHost: v.filter((x) => x.keyHost).length, keyHostPath: v.filter((x) => x.keyHostPath).length }));
