/**
 * Probe production retrieveAtomSources without LLM.
 *   cd mvp/server && ./node_modules/.bin/tsx eval/probeSearch.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { retrieveAtomSources } from "../src/handlers.js";
import { buildAtomSearchQueries } from "../src/lib/atomSearchQuery.js";

function loadLocalEnv() {
  const cwd = process.cwd();
  const candidates = [".env.local", "server/.env.local", "../.env.local"];
  const found = candidates.map((p) => join(cwd, p)).find((p) => existsSync(p));
  if (!found) return;
  const text = readFileSync(found, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

const atoms = [
  "我说我的电瓶车叫谁偷走了，原来送给非洲人去了",
  "群里那张P图配的侮辱性文字说的是真的",
  "短视频里说的某某婚内出轨是真的",
];

async function main() {
  for (const atom of atoms) {
    const queries = buildAtomSearchQueries(atom);
    process.stdout.write(`\n== ${atom}\n  queries: ${JSON.stringify(queries, null, 0)}\n`);
    const t0 = Date.now();
    try {
      const result = await retrieveAtomSources(process.env as Record<string, string>, atom);
      const sources = Array.isArray(result.sources) ? result.sources : [];
      const urls = sources
        .map((s) => (s && typeof s === "object" ? String((s as { url?: string }).url || "") : ""))
        .filter((u) => /^https?:\/\//i.test(u));
      console.log(`  ${urls.length} urls in ${Date.now() - t0}ms  source=${result._source}`);
      for (const s of sources.slice(0, 5)) {
        const rec = s as { title?: string; url?: string };
        console.log(`    - ${(rec.title || "").slice(0, 60)} | ${(rec.url || "").slice(0, 90)}`);
      }
    } catch (error) {
      console.log(`  ERROR ${Date.now() - t0}ms`, error instanceof Error ? error.message : error);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
