/**
 * Probe production retrieveAtomSources without LLM.
 *   cd mvp/server && ./node_modules/.bin/tsx eval/probeSearch.ts
 */
import { retrieveAtomSources } from "../src/lib/searchProviders.js";
import { buildAtomSearchQueries } from "../src/lib/atomSearchQuery.js";
import { loadLocalEnv } from "./localEnv.js";

loadLocalEnv();

const atoms = [
  "我说我的电瓶车叫谁偷走了，原来送给非洲人去了",
  "群里那张P图配的侮辱性文字说的是真的",
  "短视频里说的某某婚内出轨是真的",
];

function sourceUrls(sources: unknown[]): string[] {
  return sources
    .map((s) => (s && typeof s === "object" ? String((s as { url?: string }).url || "") : ""))
    .filter((u) => /^https?:\/\//i.test(u));
}

function printSources(sources: unknown[]): void {
  for (const s of sources.slice(0, 5)) {
    const rec = s as { title?: string; url?: string };
    console.log(`    - ${(rec.title || "").slice(0, 60)} | ${(rec.url || "").slice(0, 90)}`);
  }
}

async function probeOneAtom(atom: string): Promise<void> {
  const queries = buildAtomSearchQueries(atom);
  process.stdout.write(`\n== ${atom}\n  queries: ${JSON.stringify(queries, null, 0)}\n`);
  const t0 = Date.now();
  try {
    const result = await retrieveAtomSources(process.env as Record<string, string>, atom);
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const urls = sourceUrls(sources);
    console.log(`  ${urls.length} urls in ${Date.now() - t0}ms  source=${result._source}`);
    printSources(sources);
  } catch (error) {
    console.log(`  ERROR ${Date.now() - t0}ms`, error instanceof Error ? error.message : error);
  }
}

async function main() {
  for (const atom of atoms) {
    await probeOneAtom(atom);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
