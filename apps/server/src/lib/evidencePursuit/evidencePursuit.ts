/**
 * Evidence Pursuit — query portfolio and RRF fusion for the initial claim-atom retrieve (ADR-005).
 * Pure functions. Caller: atomSearchQuery.
 */

export const QUERY_PURPOSES = [
  "exact",
  "entity",
  "primary",
  "temporal",
  "refutation",
  "alternative",
] as const;

export type QueryPurpose = (typeof QUERY_PURPOSES)[number];

export type PortfolioQuery = {
  purpose: QueryPurpose;
  query: string;
  score: number;
};

export type RankedDoc = {
  url: string;
  rec: Record<string, unknown>;
};

const COMMON = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "也", "很", "到", "说", "要", "去", "你",
  "会", "着", "没有", "看", "好", "自己", "这", "那", "吗", "吧", "呢", "与", "把", "被", "让", "给",
  "人生", "痛苦", "可以", "这个", "一个", "我们", "他们", "什么", "不是", "真的", "表示", "提供", "持续",
  "因为", "所以", "如果", "还是", "或者", "以及", "进行", "通过", "相关", "问题", "情况",
]);

const TIME_RE = /20\d{2}|\d{1,2}\s*月|\d{1,2}\s*日/;
const PLACE_RE = /省|市|县|区|州|镇|村|北京|上海|新疆|甘南|喀什|合肥|非洲/;
const RELATE_RE = /表示|指控|宣布|告|导致|称|说|在.+中提供|持续到/;
const PLAN_RE = /将|要建|拟建|计划建|规划|即将|准备建|会上马|要修|要开通/;

export const RRF_K = 60;

function charLen(s: string): number {
  return [...s].length;
}

function tokens(q: string): string[] {
  const parts = q
    .replace(/[，。！？、；：""''「」『』（）【】《》]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const han = q.replace(/[^\u4e00-\u9fff]/g, "");
  const grams: string[] = [];
  for (let i = 0; i + 2 <= han.length; i += 1) grams.push(han.slice(i, i + 2));
  return [...parts, ...grams];
}

/** Score(q)=0.30 Rarity + 0.25 Entity + 0.20 Specificity + 0.15 Relation + 0.10 LengthQuality */
export function scoreQueryDiscriminability(q: string): number {
  const text = q.replace(/\s+/g, " ").trim();
  if (!text) return 0;
  const toks = tokens(text);
  const rare = toks.length ? toks.filter((t) => !COMMON.has(t)).length / toks.length : 0;
  const entityHits =
    (text.match(/[A-Za-z][A-Za-z0-9.\-]{1,}/g) ?? []).length +
    (text.match(/\d+(?:\.\d+)?/g) ?? []).length +
    (TIME_RE.test(text) ? 1 : 0) +
    (PLACE_RE.test(text) ? 1 : 0) +
    (/警方|卫健委|WHO|马斯克|Cursor/.test(text) ? 1 : 0);
  const entity = Math.min(1, entityHits / 3);
  const specHits =
    (/"[^"]+"|「[^」]+」|『[^』]+』/.test(text) ? 1 : 0) +
    (/\bsite:/.test(text) ? 1 : 0) +
    (/\d/.test(text) ? 1 : 0) +
    (TIME_RE.test(text) ? 1 : 0);
  const specificity = Math.min(1, specHits / 3);
  const relation = RELATE_RE.test(text) ? 1 : /被|把|向|对/.test(text) ? 0.5 : 0;
  const n = charLen(text.replace(/\s/g, ""));
  const lengthQuality = n < 4 ? 0.2 : n <= 8 ? 0.65 : n <= 32 ? 1 : n <= 48 ? 0.55 : 0.25;
  return (
    0.3 * rare +
    0.25 * entity +
    0.2 * specificity +
    0.15 * relation +
    0.1 * lengthQuality
  );
}

function quotedSpan(atom: string): string {
  const m = atom.match(/[「『"]([^」』"]{4,40})[」』"]/);
  return m?.[1]?.trim() ?? "";
}

function entitySpan(atom: string): string {
  const latin = (atom.match(/[A-Za-z][A-Za-z0-9.\-]{1,}/g) ?? []).slice(0, 4);
  const who = atom.match(/([\u4e00-\u9fff]{2,6})(?:表示|称|说|宣布)/);
  const parts = [...(who ? [who[1]] : []), ...latin].filter(Boolean);
  return [...new Set(parts)].slice(0, 4).join(" ");
}

function timeSpan(atom: string): string {
  const hits = atom.match(/20\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*月|\d{1,2}\s*日/g) ?? [];
  return hits.slice(0, 3).join(" ");
}

export function buildQueryPortfolio(atom: string, claim = ""): PortfolioQuery[] {
  const a = atom.replace(/\s+/g, " ").trim();
  if (!a) return [];
  const quoted = quotedSpan(a) || quotedSpan(claim);
  const entities = entitySpan(a) || entitySpan(claim);
  const when = timeSpan(a) || timeSpan(claim);
  const plan = PLAN_RE.test(a);
  const exact = quoted ? `"${quoted}" ${when}`.trim() : a;
  const entity = entities || a;
  const primary = plan ? `${a} 规划 批复 承诺 文件 辟谣` : `${a} 官方通报 发布 原文`;
  const temporal = when ? `${a} ${when}` : `${a} 时间 日期`;
  const refutation = plan ? `${a} 辟谣 不实` : `${a} 辟谣 不实 谣言 官方通报`;
  const alternative = plan ? `${a} 规划 批复` : `${a} 当事方 回应 原始数据`;
  const raw: Array<{ purpose: QueryPurpose; query: string }> = [
    { purpose: "exact", query: exact },
    { purpose: "entity", query: entity },
    { purpose: "primary", query: primary },
    { purpose: "temporal", query: temporal },
    { purpose: "refutation", query: refutation },
    { purpose: "alternative", query: alternative },
  ];
  return raw.map((row) => ({
    ...row,
    query: row.query.replace(/\s+/g, " ").trim(),
    score: scoreQueryDiscriminability(row.query),
  }));
}

export function fuseByRrf(lists: RankedDoc[][], k = RRF_K): Array<RankedDoc & { rrf: number }> {
  const scores = new Map<string, { rec: Record<string, unknown>; rrf: number }>();
  for (const list of lists) {
    list.forEach((doc, index) => {
      const url = doc.url.trim();
      if (!url) return;
      const add = 1 / (k + index + 1);
      const prev = scores.get(url);
      if (prev) prev.rrf += add;
      else scores.set(url, { rec: doc.rec, rrf: add });
    });
  }
  return [...scores.entries()]
    .map(([url, v]) => ({ url, rec: v.rec, rrf: v.rrf }))
    .sort((a, b) => b.rrf - a.rrf);
}
