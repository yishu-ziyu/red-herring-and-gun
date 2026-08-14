/**
 * Per-atom retrieval queries for Case Pipeline.
 * Raw atom text is not enough for Weibo-scale rumors: also hunt 辟谣 / 规划 traces.
 */

const FILLER = /我说|原来|叫谁|这是|那个|一下|真的吗|是不是/g;
const STOP = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "吗", "吧", "呢",
]);

export function looksLikePlanOrPrediction(atom: string): boolean {
  return /将|要建|拟建|计划建|规划|即将|准备建|会上马|要修|要开通/.test(atom);
}

/** Drop first-person filler so slangy Weibo sentences still hit 辟谣 pages. */
export function compactAtomForSearch(atom: string): string {
  const stripped = atom
    .replace(FILLER, " ")
    .replace(/[，。！？、；：""''（）【】《》]/g, " ")
    .replace(/[的了是在和就把给与]/g, " ");
  const parts = stripped
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(parts)].slice(0, 6).join(" ");
}

/** Generic insult/affair captions need a public-bulletin query, not the empty “是不是真的”. */
export function extraRumorQueries(atom: string): string[] {
  const extra: string[] = [];
  if (/P图|p图|配图/.test(atom) && /侮辱|辱骂|侮辱性/.test(atom)) {
    extra.push("P图 编造 侮辱性文字 发群 警方通报 辟谣");
  }
  if (/出轨/.test(atom) && /短视频|视频/.test(atom)) {
    extra.push("短视频 散布 婚内出轨 不实言论 警方通报 辟谣");
  }
  if (/电瓶车/.test(atom) && /非洲|境外/.test(atom)) {
    extra.push("电瓶车被偷至境外 非洲 P图 辟谣 警方通报");
  }
  return extra;
}

export function buildAtomSearchQueries(atom: string): string[] {
  const t = atom.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const compact = compactAtomForSearch(t);
  const suffix = looksLikePlanOrPrediction(t) ? "规划 批复 承诺 文件 辟谣" : "辟谣 不实 谣言 官方通报";
  const extras = extraRumorQueries(t);
  const out: string[] = extras.length > 0 ? [...extras, `${t} ${suffix}`] : [t, `${t} ${suffix}`];
  if (compact && compact !== t && extras.length === 0) out.push(`${compact} ${suffix}`);
  return uniqueKeep(out, 3);
}

export function mergeParallelSearchPayloads(
  atom: string,
  payloads: Array<Record<string, unknown>>
): Record<string, unknown> {
  const sources: Record<string, unknown>[] = [];
  const seenUrl = new Set<string>();
  const answers: string[] = [];
  const traces: string[] = [];
  const gaps: string[] = [];
  const related: string[] = [];
  const models: string[] = [];

  for (const p of payloads) {
    if (!p || typeof p !== "object") continue;
    if (typeof p.answer === "string" && p.answer.trim()) answers.push(p.answer.trim());
    if (typeof p.traceText === "string" && p.traceText.trim()) traces.push(p.traceText.trim());
    if (typeof p.model === "string" && p.model.trim()) models.push(p.model.trim());
    if (Array.isArray(p.unresolvedEvidenceGaps)) {
      for (const g of p.unresolvedEvidenceGaps) {
        if (typeof g === "string" && g.trim()) gaps.push(g.trim());
      }
    }
    if (Array.isArray(p.relatedQuestions)) {
      for (const q of p.relatedQuestions) {
        if (typeof q === "string" && q.trim()) related.push(q.trim());
      }
    }
    const list = Array.isArray(p.sources) ? p.sources : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const url = String(rec.url || rec.link || "").trim();
      if (!url || seenUrl.has(url)) continue;
      seenUrl.add(url);
      sources.push(rec);
    }
  }

  sources.sort((a, b) => {
    const rank = (rec: Record<string, unknown>) => {
      const overlap = topicOverlap(atom, rec);
      const debunk = overlap > 0 ? debunkHint(rec) : 0;
      const official = overlap > 0 ? officialHint(rec) : 0;
      return debunk * 10 + official * 5 + overlap * 3 + patternBoost(atom, rec);
    };
    return rank(b) - rank(a);
  });

  const queries = buildAtomSearchQueries(atom);
  return {
    answer: answers.join("\n\n").slice(0, 2400),
    sources: sources.slice(0, 24),
    unresolvedEvidenceGaps: uniqueKeep(gaps, 8),
    relatedQuestions: uniqueKeep(related, 8),
    model: uniqueKeep(models, 6).join(" + ") || "parallel-search",
    traceText: `按原子检索「${atom.slice(0, 40)}」共 ${queries.length} 路查询，聚合 ${sources.length} 条可点开来源。${traces.join(" ")}`.slice(
      0,
      1400
    ),
    _source: "parallel-search",
    supportQuery: queries[0] || atom,
    contradictQuery: queries[1] || queries[0] || atom,
  };
}

function uniqueKeep(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function debunkHint(rec: Record<string, unknown>): number {
  const text = `${rec.title || ""} ${rec.snippet || rec.summary || ""}`;
  return /(辟谣|不实|假消息|谣言|官方声明|从未发布|系编造|联合辟谣)/.test(text) ? 1 : 0;
}

function officialHint(rec: Record<string, unknown>): number {
  const blob = `${rec.url || rec.link || ""} ${rec.title || ""}`;
  if (/piyao\.org\.cn|news\.cn|xinhuanet|gmw\.cn|people\.com\.cn|\.gov\.cn/.test(blob)) return 1;
  if (/警方通报|公安|文旅局|联合辟谣平台/.test(blob)) return 1;
  return 0;
}

/** Roundup pages often omit the rumor keywords in the title; still prefer 典型案例/警方通报 when the atom is that class of tiny rumor. */
function patternBoost(atom: string, rec: Record<string, unknown>): number {
  const text = `${rec.title || ""} ${rec.snippet || rec.summary || ""} ${rec.url || ""}`;
  if (/P图|p图|侮辱/.test(atom) && /P图|侮辱|典型案例/.test(text)) return 6;
  if (/出轨/.test(atom) && /出轨|不实言论|典型案例/.test(text)) return 6;
  if (/电瓶车/.test(atom) && /电瓶车|非洲|境外|典型案例/.test(text)) return 6;
  return 0;
}

function topicTokens(atom: string): string[] {
  const compact = compactAtomForSearch(atom)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const han = atom.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  const grams: string[] = [];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= han.length; i++) {
      const g = han.slice(i, i + n);
      if (!STOP.has(g)) grams.push(g);
    }
  }
  return [...new Set([...compact, ...grams])].slice(0, 24);
}

function topicOverlap(atom: string, rec: Record<string, unknown>): number {
  const keys = topicTokens(atom);
  const text = `${rec.title || ""} ${rec.snippet || rec.summary || ""}`;
  return keys.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
}

/** On-topic 辟谣 and no on-topic support → circulating sentence is not believable. */
export function boundTinyRumorVerdict(
  atom: string,
  sources: Array<Record<string, unknown>>
): "false" | null {
  let debunk = 0;
  let support = 0;
  for (const rec of sources) {
    if (!rec || typeof rec !== "object") continue;
    if (topicOverlap(atom, rec) <= 0) continue;
    if (debunkHint(rec)) debunk += 1;
    else if (/(属实|证实|确实发生|官方确认|已开通|已建成)/.test(`${rec.title || ""} ${rec.snippet || rec.summary || ""}`)) {
      support += 1;
    }
  }
  if (debunk > 0 && support === 0) return "false";
  return null;
}

export function isOnTopicDebunk(atom: string, rec: Record<string, unknown>): boolean {
  return topicOverlap(atom, rec) > 0 && debunkHint(rec) > 0;
}
