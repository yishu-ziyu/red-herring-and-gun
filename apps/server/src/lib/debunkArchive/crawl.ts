/**
 * Crawl the 中国互联网联合辟谣平台 (piyao.org.cn) into data/debunk-archive/.
 *
 *   cd apps/server && npx tsx src/lib/debunkArchive/crawl.ts [options]
 *
 *   --out <dir>          output dir (default <repo>/data/debunk-archive)
 *   --since YYYY-MM-DD   oldest publish date to import (default: 3 years ago)
 *   --until YYYY-MM-DD   newest publish date (default: today)
 *   --max <n>            max new articles to fetch this run (default 3000)
 *   --max-minutes <n>    stop fetching after n minutes (default 40)
 *   --delay-ms <n>       gap between requests, never below 1000 (default 1000)
 *   --discover-only      only list what the column pages offer, fetch no articles
 *   --reextract          re-parse saved raw pages into articles.jsonl, no network
 *
 * Import is by site column and date range only; nothing here searches by claim.
 * Column pages embed a `ds_<id>.json` file (the site's own "查看更多" data source)
 * listing every item of the column with its publish time.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultArchiveDir, readArchiveJsonl } from "./index.js";
import { extractPiyaoArticle, type ArchiveRecord } from "./extract.js";

const ORIGIN = "https://www.piyao.org.cn";
const USER_AGENT = "RedHerringArchiveBot/0.1 (local non-commercial research; polite crawler, 1 request/second)";
const SEEDS = [
  "/index.htm", "/ld.htm", "/rm.htm", "/gz.htm", "/ft.htm", "/zt.htm", "/dsspy.htm", "/xzbb.htm", "/jrpy/index.htm", "/jj.htm",
  "/sq/index.htm", "/rm/bd.htm", "/rm/ndbd.htm", "/rm/zs.htm",
];
const ARTICLE_PATH = /^(\d{8})\/([0-9a-f]{32})\/c\.html$/;

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    max: { type: "string" },
    "max-minutes": { type: "string" },
    "delay-ms": { type: "string" },
    "discover-only": { type: "boolean" },
    reextract: { type: "boolean" },
  },
});

const outDir = args.out ?? defaultArchiveDir();
const rawDir = path.join(outDir, "raw");
const jsonlPath = path.join(outDir, "articles.jsonl");
const failPath = path.join(outDir, "failures.jsonl");
const today = new Date().toISOString().slice(0, 10);
const since = args.since ?? `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`;
const until = args.until ?? today;
const maxNew = Number(args.max ?? 3000);
const deadline = Date.now() + Number(args["max-minutes"] ?? 40) * 60_000;
const delayMs = Math.max(1000, Number(args["delay-ms"] ?? 1000));

mkdirSync(rawDir, { recursive: true });

// Request starts are spaced at least delayMs apart (slot reserved synchronously), so
// a few requests may be in flight while the site still sees <= 1 request/second.
let nextSlot = 0;
async function politeGet(url: string): Promise<{ status: number; body: string }> {
  for (let attempt = 0; ; attempt++) {
    const start = Math.max(Date.now(), nextSlot);
    nextSlot = start + delayMs;
    if (start > Date.now()) await new Promise((r) => setTimeout(r, start - Date.now()));
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" }, signal: AbortSignal.timeout(30_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
        continue;
      }
      return { status: res.status, body: await res.text() };
    } catch (e) {
      if (attempt >= 3) return { status: 0, body: String(e) };
      await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt));
    }
  }
}

interface Listed {
  id: string;
  date: string;
  title: string;
  column: string;
}

async function discover(): Promise<Listed[]> {
  const dsIds = new Map<string, string>(); // ds id -> seed page
  for (const seed of SEEDS) {
    const r = await politeGet(ORIGIN + seed);
    if (r.status !== 200) {
      console.warn(`seed ${seed}: HTTP ${r.status}`);
      continue;
    }
    for (const m of r.body.matchAll(/data="datasource:([0-9a-f]{32})"\s+datatype="ds"/g)) if (!dsIds.has(m[1])) dsIds.set(m[1], seed);
  }
  console.log(`discovered ${dsIds.size} list data sources from ${SEEDS.length} column pages`);
  const byId = new Map<string, Listed>();
  for (const [ds, seed] of dsIds) {
    const r = await politeGet(`${ORIGIN}/ds_${ds}.json`);
    if (r.status !== 200) {
      console.warn(`ds ${ds} (${seed}): HTTP ${r.status}`);
      continue;
    }
    let json: { categoryName?: string; datasource?: Array<Record<string, string>> };
    try {
      json = JSON.parse(r.body);
    } catch {
      continue;
    }
    const items = json.datasource ?? [];
    let usable = 0;
    let oldest = "9999";
    let newest = "0000";
    for (const it of items) {
      const rel = (it.publishUrl ?? "").replace(/^https?:\/\/www\.piyao\.org\.cn/, "").replace(/^\//, "");
      const m = rel.match(ARTICLE_PATH);
      if (!m || it.contentType === "Link") continue;
      const date = (it.publishTime ?? "").slice(0, 10) || `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
      usable++;
      if (date < oldest) oldest = date;
      if (date > newest) newest = date;
      if (!byId.has(rel)) byId.set(rel, { id: rel, date, title: it.title ?? "", column: json.categoryName ?? seed });
    }
    console.log(`  ${(json.categoryName ?? seed).padEnd(14)} ${String(items.length).padStart(5)} items, ${String(usable).padStart(5)} article links, ${oldest} .. ${newest}`);
  }
  return [...byId.values()];
}

function urlOf(id: string): string {
  return `${ORIGIN}/${id}`;
}
function rawName(id: string): string {
  const m = id.match(ARTICLE_PATH)!;
  return `${m[1]}_${m[2]}.html`;
}

function reextract(): void {
  const records: ArchiveRecord[] = [];
  let bad = 0;
  for (const f of readdirSync(rawDir).filter((n) => n.endsWith(".html")).sort()) {
    const m = f.match(/^(\d{8})_([0-9a-f]{32})\.html$/);
    if (!m) continue;
    const r = extractPiyaoArticle(readFileSync(path.join(rawDir, f), "utf8"), urlOf(`${m[1]}/${m[2]}/c.html`));
    if (r) records.push(r);
    else bad++;
  }
  writeFileSync(jsonlPath, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  console.log(`re-extracted ${records.length} records (${bad} unparseable) -> ${jsonlPath}`);
}

async function main(): Promise<void> {
  if (args.reextract) return reextract();
  const listed = (await discover()).filter((l) => l.date >= since && l.date <= until);
  writeFileSync(path.join(outDir, "discovered.json"), JSON.stringify(listed, null, 1));
  console.log(`${listed.length} article links within ${since} .. ${until}`);
  if (args["discover-only"]) return;

  const have = new Set(readArchiveJsonl(jsonlPath).map((r) => r.url));
  const dead = new Set<string>();
  if (existsSync(failPath)) {
    for (const line of readFileSync(failPath, "utf8").split("\n")) {
      try {
        const f = JSON.parse(line) as { url: string; status: number };
        if (f.status === 404 || f.status === 410) dead.add(f.url);
      } catch {
        // ignore
      }
    }
  }
  const todo = listed.filter((l) => !have.has(urlOf(l.id)) && !dead.has(urlOf(l.id))).sort((a, b) => (a.date < b.date ? 1 : -1));
  console.log(`${have.size} already archived; ${todo.length} to fetch (newest first, cap ${maxNew}, ${process.env.TZ ?? ""}deadline ${new Date(deadline).toLocaleTimeString()})`);

  let fetched = 0;
  let failed = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (fetched >= maxNew || Date.now() > deadline || cursor >= todo.length) return;
      await fetchOne(todo[cursor++]);
    }
  };
  const fetchOne = async (l: Listed): Promise<void> => {
    const url = urlOf(l.id);
    const r = await politeGet(url);
    if (r.status !== 200) {
      failed++;
      appendFileSync(failPath, JSON.stringify({ url, status: r.status, at: new Date().toISOString() }) + "\n");
      return;
    }
    writeFileSync(path.join(rawDir, rawName(l.id)), r.body);
    const rec = extractPiyaoArticle(r.body, url);
    if (!rec) {
      failed++;
      appendFileSync(failPath, JSON.stringify({ url, status: 200, error: "unparseable", at: new Date().toISOString() }) + "\n");
      return;
    }
    appendFileSync(jsonlPath, JSON.stringify(rec) + "\n");
    fetched++;
    if (fetched % 50 === 0) console.log(`  fetched ${fetched} (${failed} failed), at ${l.date}`);
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`done: fetched ${fetched}, failed ${failed}, archive now ${have.size + fetched} articles`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
