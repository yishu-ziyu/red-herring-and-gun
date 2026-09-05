/**
 * semanticRecall.ts — 确定性本地语义路线（一期）。
 * 无模型调用、无外部 embedding、无付费厂商。
 * 做法：口语填充剥离 + 字级 dice（unigram 为主、bigram 加成）。
 * 字级而非词级：电瓶车/电动车零词面交集仍有 2/3 同字，可召回，不写死名单。
 */

const FILLER_RE = /我说|原来|叫谁|这是|那个|一下|真的吗|是不是|听说|据说|朋友圈|群里/g;
const PUNCT_RE = /[，。！？、；：""''（）【】《》「」『』…—\-]/g;
const FUNC_RE = /[的了是在和就把给与被]/g;

/** 去口语填充与虚字，留实义骨架。 */
export function stripColloquialFiller(text: string): string {
  return String(text || "")
    .replace(FILLER_RE, " ")
    .replace(PUNCT_RE, " ")
    .replace(FUNC_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chars(s: string): string[] {
  return [...String(s || "").replace(/\s+/g, "")];
}

function unigramSet(s: string): Set<string> {
  return new Set(chars(s));
}

function bigrams(s: string): string[] {
  const c = chars(s);
  const out: string[] = [];
  for (let i = 0; i + 2 <= c.length; i += 1) out.push(c[i] + c[i + 1]);
  return out;
}

/** 字 unigram dice 0..1。 */
export function charDice(a: string, b: string): number {
  const A = unigramSet(a);
  const B = unigramSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const ch of A) if (B.has(ch)) hit += 1;
  return (2 * hit) / (A.size + B.size);
}

/** 字 bigram dice 0..1（短文本天然偏低，只做加成）。 */
export function bigramDice(a: string, b: string): number {
  const A = bigrams(a);
  const B = new Set(bigrams(b));
  if (A.length === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return (2 * hit) / (A.length + B.size);
}

/**
 * 确定性语义分 0..1：unigram 为主 + bigram 加成。
 * 先剥口语填充再比，电瓶车/电动车这类口语改写零词面交集仍可召回。
 */
export function semanticScore(query: string, docText: string): number {
  const q = stripColloquialFiller(query);
  const d = stripColloquialFiller(docText);
  if (!q || !d) return 0;
  return 0.65 * charDice(q, d) + 0.35 * bigramDice(q, d);
}

/** 是否语义召回（默认阈值 0.25：电瓶车/电动车 ≈ 0.30 可过，无关文本过不了）。 */
export function isSemanticRecall(query: string, docText: string, threshold = 0.25): boolean {
  return semanticScore(query, docText) >= threshold;
}

/**
 * 语义改写一路：实义骨架 + 通用后缀，不新增模型调用。
 * 与短关键词一路（骨架本身）天然不同路，两路做 RRF 融合。
 */
export function buildSemanticQuery(atom: string): string {
  const skeleton = stripColloquialFiller(atom).split(" ").filter((w) => w.length >= 2).slice(0, 6).join(" ");
  const base = skeleton || String(atom || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!base) return "";
  if (/辟谣|不实|核实|通报/.test(base)) return base;
  return `${base} 辟谣 核实`;
}

/**
 * 命中段：query 实词在标题+摘要中的首个命中窗口（出处到段），上限 maxLen 字。
 * 无命中回退摘要首段，保证每页都有可回看的段。
 */
export function pickAuditionChunk(query: string, title: string, snippet: string, maxLen = 120): string {
  const text = `${String(title || "")} ${String(snippet || "")}`.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const tokens = stripColloquialFiller(query).split(" ").filter((w) => w.length >= 2);
  let at = -1;
  let hitLen = 0;
  for (const tok of tokens) {
    const i = text.indexOf(tok);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      hitLen = [...tok].length;
    }
  }
  if (at < 0) return text.slice(0, maxLen);
  const start = Math.max(0, at - 20);
  const window = text.slice(start, start + maxLen);
  return (start > 0 ? "…" : "") + window;
}

/** 公开流脱敏：遮密钥形片段，截长，不把原始错误原样抛出去。 */
export function sanitizeSearchError(message: string): string {
  const masked = String(message || "")
    .replace(/sk-[A-Za-z0-9-_]{4,}/g, "sk-****")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1****")
    .replace(/(bearer\s+)\S+/gi, "$1****")
    .replace(/\s+/g, " ")
    .trim();
  if (!masked) return "检索失败";
  return masked.slice(0, 120);
}
