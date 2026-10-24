// Replays stored events of completed runs through the public-stream filter and counts
// search-service, model-provider and model names that would still reach the browser.
// Read-only on the dev database. Not a test; run it by hand after touching publicStream:
//   cd apps && server/node_modules/.bin/tsx scripts/public-names-check.mjs [--runs 20] [--examples 3]
// Exit code 1 when any name is found.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { toPublicStreamEvent } from "../server/src/http/publicStream.ts";
import { SEARCH_PROVIDERS } from "../server/src/lib/search/providers.ts";
import { MODEL_PROVIDERS } from "../server/src/lib/models/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..", "server");
const DB = process.env.RHG_DB_FILE || join(process.env.DATA_DIR || join(serverDir, ".data"), "rhg.sqlite");

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const runLimit = Number(argValue("--runs") || 0);
const exampleLimit = Number(argValue("--examples") || 3);

// Names from the provider registries, plus the spellings models write on their own.
const ALIASES = [
  "360 AI Search", "360 Search", "360 智搜", "360智搜", "search360", "AnySearch", "Metaso", "秘塔",
  "Tavily", "Exa", "MiniMax", "StepFun", "阶跃", "Step Plan", "Token Plan", "coding-plan", "coding plan",
  "Anthropic", "claude-",
];
const terms = [
  ...SEARCH_PROVIDERS.flatMap((p) => [p.id, p.label]),
  ...MODEL_PROVIDERS.map((p) => p.id),
  ...ALIASES,
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
const unique = [...new Set(terms.map((t) => t.toLowerCase()))].sort((a, b) => b.length - a.length);
// ASCII names must not sit inside a longer word ("exa" in "example").
// A bare 360 counts only next to search output words; elsewhere it is a number.
const BARE_360 = String.raw`(?<![\w.-])360(?=\s*(?:sources?|answers?|results?|snippets?|says|来源|答案|结果|返回)(?![A-Za-z]))`;
const NAME_RE = new RegExp(
  [BARE_360, ...unique.map((t) => (/^[\x00-\x7f]+$/.test(t) ? `(?<![A-Za-z])${escape(t)}(?![A-Za-z])` : escape(t)))].join("|"),
  "gi",
);

const db = new DatabaseSync(DB, { readOnly: true });
const runs = db.prepare(
  `SELECT r.runId FROM runs r
   WHERE r.status = 'completed' AND EXISTS (SELECT 1 FROM run_events e WHERE e.runId = r.runId)
   ORDER BY r.createdAt DESC ${runLimit > 0 ? `LIMIT ${runLimit}` : ""}`,
).all().map((r) => r.runId);
const eventsOf = db.prepare("SELECT payload FROM run_events WHERE runId = ? ORDER BY eventSeq");

const byName = new Map();
const byPath = new Map();
let events = 0;
let hits = 0;

function walk(value, path, type) {
  if (typeof value === "string") {
    for (const m of value.matchAll(NAME_RE)) {
      hits += 1;
      const name = m[0].toLowerCase().replace(/\s+/g, " ");
      byName.set(name, (byName.get(name) ?? 0) + 1);
      const key = `${type} ${path.replace(/\[\d+\]/g, "[]")}`;
      const entry = byPath.get(key) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < exampleLimit) {
        entry.examples.push(value.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " "));
      }
      byPath.set(key, entry);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, type));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, type);
  }
}

for (const runId of runs) {
  for (const { payload } of eventsOf.all(runId)) {
    events += 1;
    const event = toPublicStreamEvent(JSON.parse(payload));
    walk(event, "", String(event.type));
  }
}

console.log(`database: ${DB}`);
console.log(`completed runs: ${runs.length}, events replayed: ${events}`);
console.log(`names found in public output: ${hits}`);
if (hits > 0) {
  console.log("\nby name:");
  for (const [name, n] of [...byName].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${name}`);
  console.log("\nby event field:");
  for (const [key, { count, examples }] of [...byPath].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
    for (const ex of examples) console.log(`          …${ex}…`);
  }
}
process.exitCode = hits > 0 ? 1 : 0;
