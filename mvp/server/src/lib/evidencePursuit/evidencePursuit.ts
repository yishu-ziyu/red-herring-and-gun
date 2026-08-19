/**
 * Evidence Pursuit — Search Policy for claim atoms (ADR-005).
 * Pure functions: portfolio, discriminability, gap, RRF, information gain.
 * Not a pipeline. Callers: atomSearchQuery (initial retrieve) + evidenceLoop (hops).
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

export type EvidenceGapSlot =
  | "actor"
  | "action"
  | "object"
  | "time"
  | "location"
  | "primary"
  | "support"
  | "refute"
  | "independent";

export type ResultKind = "primary" | "repost" | "refutation" | "unrelated" | "empty";

export type PursuitAction = "continue" | "switch" | "stop";

export type PortfolioQuery = {
  purpose: QueryPurpose;
  query: string;
  score: number;
};

export type EvidenceGap = {
  filled: EvidenceGapSlot[];
  missing: EvidenceGapSlot[];
  nextPurpose: QueryPurpose;
  goalLabel: string;
  missingEvidence: string[];
};

export type PursuitHop = {
  hop: number;
  atom: string;
  goal: string;
  purpose: QueryPurpose;
  query: string;
  resultKind: ResultKind;
  newEvidence: number;
  missingAfter: string[];
  gain: number;
  action: PursuitAction;
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

const OFFICIAL_RE = /piyao\.org\.cn|news\.cn|xinhuanet|gmw\.cn|people\.com\.cn|\.gov\.cn|警方通报|联合辟谣/;
const REFUTE_RE = /辟谣|不实|假消息|谣言|从未发布|系编造|官方声明/;
const TIME_RE = /20\d{2}|\d{1,2}\s*月|\d{1,2}\s*日/;
const PLACE_RE = /省|市|县|区|州|镇|村|北京|上海|新疆|甘南|喀什|合肥|非洲/;
const RELATE_RE = /表示|指控|宣布|告|导致|称|说|在.+中提供|持续到/;
const PLAN_RE = /将|要建|拟建|计划建|规划|即将|准备建|会上马|要修|要开通/;

export const GAIN_STOP_THRESHOLD = 0.18;
export const RRF_K = 60;

const PURPOSE_GOAL: Record<QueryPurpose, string> = {
  exact: "按原句核验",
  entity: "核对当事方",
  primary: "找原始发布",
  temporal: "核对时间锚点",
  refutation: "找反证或辟谣",
  alternative: "换一个解释框架",
};

const SLOT_LABEL: Record<EvidenceGapSlot, string> = {
  actor: "当事方",
  action: "行为",
  object: "对象",
  time: "时间",
  location: "地点",
  primary: "原始来源",
  support: "支撑证据",
  refute: "反证",
  independent: "独立来源",
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

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

export function selectPriorityQueries(
  portfolio: PortfolioQuery[],
  options?: { max?: number; exclude?: Set<string>; minScore?: number }
): PortfolioQuery[] {
  const max = options?.max ?? 3;
  const exclude = options?.exclude ?? new Set<string>();
  const minScore = options?.minScore ?? 0;
  const ranked = [...portfolio]
    .filter((p) => p.query && !exclude.has(p.query) && p.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const out: PortfolioQuery[] = [];
  const seenPurpose = new Set<QueryPurpose>();
  for (const item of ranked) {
    if (seenPurpose.has(item.purpose)) continue;
    seenPurpose.add(item.purpose);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function titleBlob(s: { title?: string; snippet?: string; url?: string }): string {
  return `${s.title ?? ""} ${s.snippet ?? ""} ${s.url ?? ""}`;
}

function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/\s+/g, "");
    const out: string[] = [];
    for (let i = 0; i + 2 <= t.length; i += 1) out.push(t.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const setB = new Set(B);
  let hit = 0;
  for (const g of A) if (setB.has(g)) hit += 1;
  return (2 * hit) / (A.length + B.length);
}

export function isReprint(
  incoming: { url: string; title?: string; snippet?: string },
  existing: Array<{ url: string; title?: string; snippet?: string }>
): boolean {
  const host = hostOf(incoming.url);
  const title = (incoming.title ?? "").trim();
  for (const prev of existing) {
    if (host && host === hostOf(prev.url)) return true;
    if (title && (prev.title ?? "").trim() && dice(title, prev.title ?? "") >= 0.82) return true;
  }
  return false;
}

export function isOfficialSource(s: { url?: string; title?: string; snippet?: string }): boolean {
  return OFFICIAL_RE.test(titleBlob(s));
}

export function assessEvidenceGap(input: {
  atom: string;
  sources: Array<{ url: string; title?: string; snippet?: string }>;
  trigger?: "unverified" | "conflict";
  supportingCount?: number;
  contradictingCount?: number;
}): EvidenceGap {
  const atom = input.atom;
  const sources = input.sources ?? [];
  const hosts = new Set(sources.map((s) => hostOf(s.url)).filter(Boolean));
  const blob = `${atom} ${sources.map((s) => titleBlob(s)).join(" ")}`;
  const filled: EvidenceGapSlot[] = [];
  const consider = (slot: EvidenceGapSlot, yes: boolean) => {
    if (yes) filled.push(slot);
  };
  consider("actor", /表示|称|说|宣布|警方|WHO|马斯克/.test(atom) || Boolean(entitySpan(atom)));
  consider("action", charLen(atom) >= 4);
  consider("object", charLen(atom) >= 4);
  consider("time", TIME_RE.test(blob));
  consider("location", PLACE_RE.test(atom));
  consider("primary", sources.some((s) => isOfficialSource(s)));
  consider("support", (input.supportingCount ?? 0) > 0 || sources.some((s) => !REFUTE_RE.test(titleBlob(s))));
  consider("refute", (input.contradictingCount ?? 0) > 0 || sources.some((s) => REFUTE_RE.test(titleBlob(s))));
  consider("independent", hosts.size >= 2);

  const all: EvidenceGapSlot[] = [
    "primary",
    "refute",
    "time",
    "actor",
    "independent",
    "support",
    "location",
    "action",
    "object",
  ];
  const missing = all.filter((s) => !filled.includes(s));
  if (input.trigger === "conflict" && !missing.includes("independent")) {
    missing.unshift("independent");
  }
  const nextSlot = missing[0] ?? "primary";
  const nextPurpose: QueryPurpose =
    nextSlot === "primary"
      ? "primary"
      : nextSlot === "refute"
        ? "refutation"
        : nextSlot === "time"
          ? "temporal"
          : nextSlot === "actor"
            ? "entity"
            : nextSlot === "independent"
              ? "alternative"
              : "exact";
  return {
    filled,
    missing,
    nextPurpose,
    goalLabel: PURPOSE_GOAL[nextPurpose],
    missingEvidence: missing.slice(0, 4).map((s) => SLOT_LABEL[s]),
  };
}

export function purposeQueries(atom: string, purpose: QueryPurpose): string[] {
  const a = atom.replace(/\s+/g, " ").trim();
  const fromPortfolio = buildQueryPortfolio(a).find((p) => p.purpose === purpose)?.query;
  if (purpose === "primary") return [`${a} 官方通报`, `${a} 辟谣`];
  if (purpose === "exact" || purpose === "temporal") return [`${a} 原文 出处`, `${a} 数据来源`];
  if (purpose === "entity" || purpose === "alternative") return [`${a} 当事方 回应`, `${a} 原始数据 发布`];
  if (purpose === "refutation") return [`${a} 辟谣`, `${a} 不实 谣言`];
  return fromPortfolio ? [fromPortfolio] : [a];
}

export function queriesForGap(input: {
  atom: string;
  gap: EvidenceGap;
  priorQueries: Iterable<string>;
  round: number;
}): string[] {
  const prior = new Set(input.priorQueries);
  const order: QueryPurpose[] =
    input.round >= 3
      ? ["entity", "alternative", "primary", "refutation", "temporal", "exact"]
      : input.round === 2
        ? ["temporal", "exact", "refutation", "alternative", "entity", "primary"]
        : [
            input.gap.nextPurpose,
            "primary",
            "refutation",
            "temporal",
            "entity",
            "alternative",
            "exact",
          ];
  const seen = new Set<QueryPurpose>();
  for (const purpose of order) {
    if (seen.has(purpose)) continue;
    seen.add(purpose);
    const fresh = purposeQueries(input.atom, purpose).filter((q) => q && !prior.has(q));
    if (fresh.length > 0) return fresh.slice(0, 2);
  }
  return [];
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

export function computeInformationGain(input: {
  existing: Array<{ url: string; title?: string; snippet?: string }>;
  incoming: Array<{ url: string; title?: string; snippet?: string }>;
  gapBefore: EvidenceGap;
  gapAfter: EvidenceGap;
  searchCost?: number;
}): { gain: number; newNonReprint: number; slotsFilled: number; newHosts: number } {
  const existing = input.existing;
  const nonReprint = input.incoming.filter((s) => s.url && !isReprint(s, existing));
  const existingHosts = new Set(existing.map((s) => hostOf(s.url)).filter(Boolean));
  const newHosts = new Set(
    nonReprint.map((s) => hostOf(s.url)).filter((h) => h && !existingHosts.has(h))
  ).size;
  const slotsFilled = Math.max(0, input.gapBefore.missing.length - input.gapAfter.missing.length);
  const newEvidenceNorm = Math.min(1, nonReprint.length / 2);
  const uncertainty = slotsFilled / 9;
  const diversity = newHosts / (1 + existingHosts.size);
  const cost = Math.max(0.5, input.searchCost ?? 1);
  const gain = (0.5 * newEvidenceNorm + 0.3 * uncertainty + 0.2 * diversity) / cost;
  return { gain, newNonReprint: nonReprint.length, slotsFilled, newHosts };
}

export function classifyResultKind(
  incoming: Array<{ url: string; title?: string; snippet?: string }>,
  existing: Array<{ url: string; title?: string; snippet?: string }>,
  atom: string
): ResultKind {
  if (incoming.length === 0) return "empty";
  if (incoming.some((s) => isOfficialSource(s))) return "primary";
  if (incoming.some((s) => REFUTE_RE.test(titleBlob(s)))) return "refutation";
  if (incoming.every((s) => isReprint(s, existing))) return "repost";
  const keys = atom.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  const overlap = incoming.some((s) => {
    const text = titleBlob(s);
    return keys.length >= 2 && [...keys].some((_, i) => i + 2 <= keys.length && text.includes(keys.slice(i, i + 2)));
  });
  if (!overlap) return "unrelated";
  return "repost";
}

export function resultKindLabel(kind: ResultKind): string {
  if (kind === "primary") return "原始来源";
  if (kind === "refutation") return "反证或辟谣";
  if (kind === "repost") return "二手转载";
  if (kind === "unrelated") return "未对上题";
  return "没有新材料";
}

export function formatHopDetail(hop: {
  goal?: string;
  query?: string;
  resultKind?: ResultKind;
  missingAfter?: string[];
  gain?: number;
  action?: PursuitAction;
}): string {
  const parts: string[] = [];
  if (hop.goal) parts.push(`目标：${hop.goal}`);
  if (hop.query) parts.push(`搜「${hop.query.slice(0, 28)}${hop.query.length > 28 ? "…" : ""}」`);
  if (hop.resultKind) parts.push(resultKindLabel(hop.resultKind));
  if (hop.missingAfter && hop.missingAfter.length > 0) parts.push(`还缺${hop.missingAfter.slice(0, 3).join("、")}`);
  else if (hop.resultKind && hop.resultKind !== "empty") parts.push("缺口已收窄");
  return parts.join(" · ") || "追索证据";
}

export function compactPursuitHops(hops: PursuitHop[]): Array<Record<string, unknown>> {
  return hops.map((h) => ({
    hop: h.hop,
    atom: h.atom,
    goal: h.goal,
    purpose: h.purpose,
    query: h.query,
    resultKind: h.resultKind,
    resultKindLabel: resultKindLabel(h.resultKind),
    newEvidence: h.newEvidence,
    missingAfter: h.missingAfter,
    gain: Number(h.gain.toFixed(3)),
    action: h.action,
  }));
}
