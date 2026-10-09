import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ArchiveRecord } from "./extract.js";
import { normalizeText, tokenize } from "./text.js";

export type { ArchiveRecord } from "./extract.js";

export interface ArchiveHit {
  url: string;
  title: string;
  publishDate: string;
  publisher: string;
  matchedStatement: string;
  keySentences: string[];
  /** 0..1, 1 = the query text is (nearly) the archived statement. Already reduced for differsOn. */
  score: number;
  /** Numbers, dates and places in the query that the matched statement does not contain. */
  differsOn: string[];
  kind: ArchiveRecord["kind"];
}

export interface LookupOptions {
  limit?: number;
  minScore?: number;
}

// ------------------------------------------------------- differences

const PLACES = [
  // provinces, municipalities, regions
  "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
  "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门",
  // large or frequently named cities
  "石家庄", "唐山", "太原", "大同", "沈阳", "大连", "长春", "哈尔滨", "大庆", "南京", "苏州", "无锡", "常州", "徐州", "南通", "杭州", "宁波", "温州", "绍兴", "金华",
  "合肥", "福州", "厦门", "泉州", "南昌", "济南", "青岛", "烟台", "临沂", "郑州", "洛阳", "许昌", "开封", "武汉", "宜昌", "襄阳", "长沙", "株洲", "广州", "深圳",
  "珠海", "佛山", "东莞", "惠州", "海口", "三亚", "成都", "绵阳", "德阳", "乐山", "甘孜", "贵阳", "遵义", "昆明", "大理", "丽江", "西安", "兰州", "西宁", "银川",
  "乌鲁木齐", "拉萨", "呼和浩特", "南宁", "桂林", "吉隆", "泰山", "济宁", "淄博", "潍坊", "保定", "邯郸", "扬州", "镇江", "嘉兴", "湖州", "台州", "芜湖", "蚌埠",
  // countries and regions abroad
  "美国", "日本", "韩国", "朝鲜", "俄罗斯", "乌克兰", "英国", "法国", "德国", "意大利", "印度", "以色列", "巴基斯坦", "泰国", "越南", "加拿大", "澳大利亚", "新加坡",
].sort((a, b) => b.length - a.length);
const PLACE_RE = new RegExp(PLACES.join("|"), "g");

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnToNumber(s: string): string | null {
  if (/^[零〇一二三四五六七八九]{2,4}$/.test(s)) return [...s].map((c) => CN_DIGIT[c]).join("");
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return String((m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0));
  return s.length === 1 && s in CN_DIGIT ? String(CN_DIGIT[s]) : null;
}

interface Quantity {
  pos: number;
  num: string;
  unit: string;
}

function quantities(text: string): Quantity[] {
  const t = normalizeText(text);
  const out: Quantity[] = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(%|[年月日号时点分秒岁元万亿倍个人吨米克度级]?)/g)) {
    out.push({ pos: m.index!, num: m[1], unit: m[2] });
  }
  for (const m of t.matchAll(/([零〇一二三四五六七八九十两]{1,4})([年月日号岁])/g)) {
    const n = cnToNumber(m[1]);
    if (n !== null) out.push({ pos: m.index!, num: n, unit: m[2] });
  }
  return out;
}

function placesIn(text: string): { pos: number; name: string }[] {
  return [...normalizeText(text).matchAll(PLACE_RE)].map((m) => ({ pos: m.index!, name: m[0] }));
}

/** Numbers, dates and places that appear in `query` but not in `text`, in query order. */
export function extractDifferences(query: string, text: string): string[] {
  const have = quantities(text);
  const havePlaces = new Set(placesIn(text).map((p) => p.name));
  const found: { pos: number; label: string }[] = [];
  for (const q of quantities(query)) {
    const ok = have.some((h) => h.num === q.num && (!q.unit || !h.unit || q.unit === h.unit));
    if (!ok) found.push({ pos: q.pos, label: q.num + q.unit });
  }
  for (const p of placesIn(query)) {
    if (!havePlaces.has(p.name)) found.push({ pos: p.pos, label: p.name });
  }
  return [...new Set(found.sort((a, b) => a.pos - b.pos).map((f) => f.label))];
}

// ------------------------------------------------------- BM25 index

const K1 = 1.2;
const B = 0.75;
const DIFFER_PENALTY = 0.7;

interface Doc {
  record: ArchiveRecord;
  statement: string;
  keySentences: string[];
  /** text the statement is judged against for differsOn */
  basis: string;
  len: number;
}

export interface ArchiveIndex {
  size: number;
  articles: number;
  lookup(claim: string, opts?: LookupOptions): ArchiveHit[];
}

/**
 * Index every rumor statement. Single-story articles also index title words the
 * statement lacks; roundup titles are never indexed because they list other stories.
 */
export function buildIndex(records: ArchiveRecord[]): ArchiveIndex {
  const docs: Doc[] = [];
  const postings = new Map<string, number[]>(); // token -> [docId, tf, docId, tf, ...]
  const seenUrls = new Set<string>();
  for (const record of records) {
    if (seenUrls.has(record.url)) continue;
    seenUrls.add(record.url);
    for (const item of record.items) {
      const stTokens = tokenize(item.statement);
      let tokens = stTokens;
      if (record.kind !== "roundup") {
        const have = new Set(stTokens);
        tokens = stTokens.concat(tokenize(record.title).filter((t) => !have.has(t)));
      }
      if (!tokens.length) continue;
      const id = docs.length;
      docs.push({
        record,
        statement: item.statement,
        keySentences: item.keySentences,
        basis: record.kind === "roundup" ? item.statement : `${item.statement} ${record.title}`,
        len: tokens.length,
      });
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, n] of tf) {
        let p = postings.get(t);
        if (!p) postings.set(t, (p = []));
        p.push(id, n);
      }
    }
  }
  const N = docs.length;
  const avgLen = N ? docs.reduce((a, d) => a + d.len, 0) / N : 1;
  const idf = (df: number) => Math.log(1 + (N - df + 0.5) / (df + 0.5));

  function lookup(claim: string, opts: LookupOptions = {}): ArchiveHit[] {
    const limit = opts.limit ?? 5;
    const minScore = opts.minScore ?? 0.2;
    const q = [...new Set(tokenize(claim))];
    if (!q.length || !N) return [];
    const scores = new Float64Array(N);
    const matched = new Uint16Array(N);
    const touched: number[] = [];
    let selfScore = 0;
    for (const t of q) {
      const p = postings.get(t);
      const w = idf(p ? p.length / 2 : 0);
      selfScore += (w * (K1 + 1)) / (1 + K1 * (1 - B + (B * q.length) / avgLen));
      if (!p) continue;
      for (let i = 0; i < p.length; i += 2) {
        const d = p[i];
        const tf = p[i + 1];
        if (matched[d] === 0) touched.push(d);
        matched[d]++;
        scores[d] += (w * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * docs[d].len) / avgLen));
      }
    }
    const needed = Math.min(2, q.length);
    const hits: ArchiveHit[] = [];
    for (const d of touched) {
      if (matched[d] < needed) continue;
      const base = Math.min(1, scores[d] / selfScore);
      if (base < minScore * 0.5) continue; // cheap pre-filter before differsOn
      const doc = docs[d];
      const differsOn = extractDifferences(claim, doc.basis);
      const score = base * Math.pow(DIFFER_PENALTY, Math.min(differsOn.length, 4));
      if (score < minScore) continue;
      hits.push({
        url: doc.record.url,
        title: doc.record.title,
        publishDate: doc.record.publishDate,
        publisher: doc.record.originalPublisher,
        matchedStatement: doc.statement,
        keySentences: doc.keySentences,
        score: Math.round(score * 10000) / 10000,
        differsOn,
        kind: doc.record.kind,
      });
    }
    hits.sort((a, b) => b.score - a.score || (a.publishDate < b.publishDate ? 1 : -1));
    return hits.slice(0, limit);
  }

  return { size: N, articles: seenUrls.size, lookup };
}

// ------------------------------------------------------- loading

export function defaultArchiveDir(): string {
  if (process.env.DEBUNK_ARCHIVE_DIR) return process.env.DEBUNK_ARCHIVE_DIR;
  // apps/server/src/lib/debunkArchive -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../data/debunk-archive");
}

export function readArchiveJsonl(file: string): ArchiveRecord[] {
  if (!existsSync(file)) return [];
  const out: ArchiveRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as ArchiveRecord;
      if (r && typeof r.url === "string" && Array.isArray(r.items)) out.push(r);
    } catch {
      // skip a torn line
    }
  }
  return out;
}

let shared: ArchiveIndex | null = null;

/** Build (once) the in-memory index from data/debunk-archive/articles.jsonl. Missing file gives an empty index. */
export function initArchive(dir = defaultArchiveDir()): ArchiveIndex {
  shared = buildIndex(readArchiveJsonl(path.join(dir, "articles.jsonl")));
  return shared;
}

export function lookupArchive(claim: string, opts?: LookupOptions): ArchiveHit[] {
  return (shared ?? initArchive()).lookup(claim, opts);
}
