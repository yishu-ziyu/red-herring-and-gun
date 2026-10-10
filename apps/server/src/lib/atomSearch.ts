/**
 * 可核查原子检索（decompose-then-verify 的检索侧）。
 * Pure transforms: select / build / bind.
 * I/O seam: SearchOneAtom adapter via retrieveForAtoms.
 * 整句兜底 / query 合并 / 缓存不在本模块。
 */

import {
  MAX_CLAIM_ATOMS,
  alignFalseEvidenceBuckets,
  claimAtomKey,
  compactStrings,
  type NonVerifiableAtom,
  type SubclaimVerdict,
} from "./claimAtom/index.js";
import { canonicalizeUrl, filterAtomSources, type FilterMeta, type FilterableSource } from "./retrievalFilter.js";
import { isOffTopicSource } from "./atomSearchQuery.js";
import { normalizeInvestigationSourceUrl } from "./investigation/sourceIdentity.js";
import {
  bindDualBucketCitations,
  bindRelatedSourcesOnly,
  stripCitationMarkers,
} from "./citationBinding.js";
export const MAX_ATOM_SEARCHES = 6;
/** @deprecated 用 claimAtom.MAX_CLAIM_ATOMS */
export const MAX_CLAIM_ATOMS_LISTED = MAX_CLAIM_ATOMS;
const CAUSAL_LOAD_RE = /导致|造成|引起|致使/;
const DIGIT_LOAD_RE = /\d/;
export const SEARCH_BUDGET_GAP = "检索预算未覆盖";

/** Adapter at the search seam: one atom → raw search result. */
export type SearchOneAtom = (atom: string) => Promise<unknown>;

export type RetrieveForAtomsHooks = {
  onAtomStart?: (atom: string) => void;
  onAtomResult?: (atom: string, result: unknown) => void;
  /** parallel (default) or sequential (SSE-friendly) */
  mode?: "parallel" | "sequential";
};

export type AtomSearchSource = {
  url: string;
  title: string;
  snippet: string;
  credibility?: string;
  /**
   * 复用来源标记：prior-round 是同一案上一轮的证据。
   * 走联网检索拿到的来源没有这两个字段，两边的下游（快照 / 报告）行为完全一致。
   */
  provenance?: "prior-round";
  originDate?: string;
  /** 来源自身发布日期（检索方给出才填；没有就是缺省，不可用抓取日顶替）。 */
  publishedAt?: string;
  /** 发布者/站点名；检索方实际给出才填。 */
  publisher?: string;
  /** 本次取得这份材料的时间（ISO）；复用/旧数据缺省按未知显示。 */
  retrievedAt?: string;
  /** snippet 字段的真实来历：目前检索路径只拿到摘要，标 search-snippet；读到正文才可标 page-excerpt。 */
  excerptKind?: "search-snippet" | "page-excerpt";
  /** 获取状态：检索路径只有摘要 → snippet-only；拿不到正文的原因进 fetchNote。 */
  fetchStatus?: "snippet-only" | "fetched" | "truncated" | "restricted" | "failed";
  fetchNote?: string;
};

/**
 * 复用注入材料：同一案上一轮的已核日期 + 当时绑定的真实来源。
 * 类型名沿用证据库时期的叫法；证据库已删除（2026-10-09），现在只有上一轮复用会产生它。
 */
export type KnowledgeInjection = {
  /** YYYY-MM-DD（上一轮的核查日期）；进快照 originDate 与活动行。 */
  originDate: string;
  evidence: Array<{ url: string; title: string; snippet: string }>;
  /** 上次沉淀的判词；没有就不写，判定拍当普通核查。 */
  priorVerdict?: string;
};

/** 判定拍用的可复核初稿（记忆只加速，不代替本轮核查）。 */
export type KnowledgeDraft = {
  claimAtom: string;
  originDate: string;
  priorVerdict: string;
  evidence: Array<{ url: string; title: string; snippet: string }>;
};

/** 一个 atom 复用了上一轮证据并真的注入了。 */
export type KnowledgeHit = {
  atom: string;
  originDate: string;
  sourceCount: number;
};

export type AtomSearchItem = {
  atom: string;
  result: unknown;
};

export type AtomSearchBundle = {
  /**
   * 本次做过材料收集的原子（截断后）：联网检索到的 + 复用上一轮注入的
   * （后者不发起联网、也不占 MAX_ATOM_SEARCHES 名额）。
   * 下游按「已在 atomsSearched 里」判断该原子有材料，所以注入的原子必须在这里，
   * 否则报告会被按「检索预算未覆盖」压成 unverified，证据循环也看不到它。
   */
  atomsSearched: string[];
  /** claimAtomKey → 该原子检索到的来源（已筛选） */
  byAtomKey: Record<string, AtomSearchSource[]>;
  /** 供 fact_checker / source_validator 兼容的聚合 search360 形 */
  aggregate: {
    answer: string;
    sources: Array<Record<string, unknown>>;
    relatedQuestions: string[];
    model: string;
    traceText: string;
    _source: string;
    supportingEvidence: string[];
    contradictingEvidence: string[];
    unresolvedEvidenceGaps: string[];
  };
  /** 注入 Agent 的按条材料 */
  forAgent: Array<{ claimAtom: string; sources: AtomSearchSource[] }>;
  /** 复用上一轮的原子：上次判词与证据，供判定拍当可复核初稿。 */
  knowledgeDrafts?: KnowledgeDraft[];
  /** 筛选可观测性：过滤前→后条数 */
  filterMeta?: {
    perAtom: Record<string, FilterMeta>;
    totals: FilterMeta;
  };
  /**
   * 只供评测度量（#144）：规范化 URL → 找到它的搜索引擎。
   * 不进模型输入、快照和界面；复用上一轮注入的来源没有引擎。
   */
  enginesByUrl?: Record<string, string[]>;
  /** 只供评测度量（#144）：claimAtomKey → 各引擎返回 / 筛后留下的来源条数；Total 是来源条数，一条来源被几个引擎找到也只算一次。 */
  enginesPerAtom?: Record<string, AtomEngineCounts>;
};

export type AtomEngineCounts = {
  returned: Record<string, number>;
  kept: Record<string, number>;
  returnedTotal: number;
  keptTotal: number;
};

/**
 * 检索结果里每条来源的引擎归属。键用筛选同款 canonicalizeUrl：留下的来源 URL 已被它改写，
 * 快照里的 URL 也是改写后的，用原始 URL 当键会对不上。与 asSourceList 同样只看前 24 条。
 */
function originsByUrl(result: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const sources = (result as { sources?: unknown })?.sources;
  if (!Array.isArray(sources)) return out;
  for (let i = 0; i < sources.length && i < 24; i += 1) {
    const rec = sources[i] as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    const url = String(rec.url || rec.link || "").trim();
    if (!url) continue;
    const key = normalizeInvestigationSourceUrl(canonicalizeUrl(url) ?? url);
    const list = out.get(key) ?? [];
    const origins = Array.isArray(rec.providerOrigins) ? rec.providerOrigins : [];
    for (const o of origins) if (typeof o === "string" && !list.includes(o)) list.push(o);
    out.set(key, list);
  }
  return out;
}

function countEngines(urls: string[], origins: Map<string, string[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const url of urls) {
    for (const engine of origins.get(normalizeInvestigationSourceUrl(canonicalizeUrl(url) ?? url)) ?? []) {
      counts[engine] = (counts[engine] ?? 0) + 1;
    }
  }
  return counts;
}

function asSourceList(result: unknown): FilterableSource[] {
  const sources = (result as { sources?: unknown })?.sources;
  if (!Array.isArray(sources)) return [];
  const out: FilterableSource[] = [];
  for (let i = 0; i < sources.length && i < 24; i += 1) {
    const raw = sources[i];
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const url = String(rec.url || rec.link || "").trim();
    if (!url) continue;
    const publishedAt = String(rec.publishedAt || rec.date || rec.time || rec.publishDate || "").trim();
    const publisher = String(rec.publisher || rec.siteName || rec.site || "").trim();
    out.push({
      url,
      title: String(rec.title || rec.name || "").slice(0, 200),
      // 关系核验需要看到转折后的限制条件；320 字很容易只留下「虽然」前半句。
      snippet: String(rec.snippet || rec.summary || rec.content || "").slice(0, 900),
      credibility: typeof rec.credibility === "string" ? rec.credibility : undefined,
      providerRank: i,
      ...(publishedAt ? { publishedAt } : {}),
      ...(publisher ? { publisher } : {}),
    });
  }
  return out;
}

export function atomSearchLoad(atom: string, type?: string): number {
  if (type === "causal" || CAUSAL_LOAD_RE.test(atom)) return 2;
  if (DIGIT_LOAD_RE.test(atom)) return 1;
  return 0;
}

function typeOfAtom(
  atom: string,
  typeByKey?: ReadonlyMap<string, string> | Record<string, string>
): string | undefined {
  if (!typeByKey) return undefined;
  const key = claimAtomKey(atom);
  if (typeByKey instanceof Map) return typeByKey.get(key) ?? typeByKey.get(atom);
  const record = typeByKey as Record<string, string>;
  return record[key] ?? record[atom];
}

/**
 * 可核查原子全表（不被检索上限先切）。立场条进 nonVerifiable，不进检索。
 */
export function listAtomsForSearch(
  claimAtoms: unknown,
  claimAtomTypes: unknown
): {
  verifiable: string[];
  nonVerifiable: NonVerifiableAtom[];
  typeByKey: Map<string, string>;
} {
  const atoms = compactStrings(claimAtoms, MAX_CLAIM_ATOMS, 180).map((s) => claimAtomKey(s));
  const typed = new Map<string, { verifiable: boolean; type: string }>();
  if (Array.isArray(claimAtomTypes)) {
    for (const item of claimAtomTypes) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const text = typeof rec.text === "string" ? rec.text : "";
      if (!text) continue;
      typed.set(claimAtomKey(text), {
        verifiable: rec.verifiable !== false,
        type: typeof rec.type === "string" ? rec.type.slice(0, 40) : "",
      });
    }
  }
  const verifiable: string[] = [];
  const nonVerifiable: NonVerifiableAtom[] = [];
  const typeByKey = new Map<string, string>();
  for (const atom of atoms) {
    const info = typed.get(atom);
    if (info && info.verifiable === false) {
      nonVerifiable.push({ text: atom, type: info.type });
      continue;
    }
    verifiable.push(atom);
    if (info?.type) typeByKey.set(atom, info.type);
  }
  return { verifiable, nonVerifiable, typeByKey };
}

/** 按负荷排序再取 MAX_ATOM_SEARCHES。同分保持原句序。 */
export function selectAtomsToSearch(
  verifiableAtoms: string[],
  typeByKey?: ReadonlyMap<string, string> | Record<string, string>,
  priorityAtoms?: readonly string[],
): string[] {
  const priorityKeys = new Map((priorityAtoms ?? []).map((atom, index) => [claimAtomKey(atom), index]));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const atom of verifiableAtoms) {
    if (typeof atom !== "string" || !atom.trim()) continue;
    const key = atom.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique
    .map((atom, index) => ({
      atom,
      index,
      load: atomSearchLoad(atom, typeOfAtom(atom, typeByKey)),
      priority: priorityKeys.get(claimAtomKey(atom)) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.priority - b.priority || b.load - a.load || a.index - b.index)
    .slice(0, MAX_ATOM_SEARCHES)
    .map((row) => row.atom);
}

/** 未进检索名额的可核查条只能是 unverified。 */
export function applyUnsearchedAtomVerdicts(
  merged: SubclaimVerdict[],
  verifiable: string[],
  searched: string[]
): SubclaimVerdict[] {
  const searchedKeys = new Set(searched.map((atom) => claimAtomKey(atom)));
  const byKey = new Map<string, SubclaimVerdict>();
  for (const verdict of merged) {
    const key = claimAtomKey(verdict.claimAtom);
    if (searchedKeys.has(key)) {
      byKey.set(key, verdict);
      continue;
    }
    const gaps = Array.isArray(verdict.evidenceGaps) ? verdict.evidenceGaps : [];
    byKey.set(key, {
      ...verdict,
      verdict: "unverified",
      evidenceGaps: gaps.some((gap) => gap.includes(SEARCH_BUDGET_GAP))
        ? gaps
        : [SEARCH_BUDGET_GAP, ...gaps].slice(0, 3),
    });
  }
  return verifiable.map((atom) => {
    const key = claimAtomKey(atom);
    return (
      byKey.get(key) ?? {
        claimAtom: atom,
        verdict: "unverified" as const,
        evidence: "",
        boundary: "",
        supportingSources: [],
        contradictingSources: [],
        evidenceGaps: [SEARCH_BUDGET_GAP],
      }
    );
  });
}

/**
 * 把「每原子一轮」的检索结果打成 bundle。
 * claimAtomKeyFn：与 merge/claimItems 同一套键（由调用方注入 claimAtomKey）。
 */
export function buildAtomSearchBundle(
  items: AtomSearchItem[],
  claimAtomKeyFn: (s: string) => string
): AtomSearchBundle {
  const byAtomKey: Record<string, AtomSearchSource[]> = {};
  const forAgent: AtomSearchBundle["forAgent"] = [];
  const aggregateSources: Array<Record<string, unknown>> = [];
  const seenUrl = new Set<string>();
  const answers: string[] = [];
  const models: string[] = [];
  const atomsSearched: string[] = [];
  const perAtomMeta: Record<string, FilterMeta> = {};
  const totals: FilterMeta = { before: 0, afterFilter: 0, afterDedupe: 0, afterTopK: 0 };
  const enginesByUrl: Record<string, string[]> = {};
  const enginesPerAtom: Record<string, AtomEngineCounts> = {};
  // 本轮材料实际取得时间：bundle 组装时刻，即这批检索结果到手的时间。
  const retrievedAt = new Date().toISOString();

  for (const item of items) {
    if (!item || typeof item.atom !== "string") continue;
    const atom = item.atom;
    atomsSearched.push(atom);
    const key = claimAtomKeyFn(atom);
    const listed = asSourceList(item.result);
    const rawSources = listed.filter((s) => !isOffTopicSource(atom, s));
    const { sources: filtered, meta } = filterAtomSources(rawSources);
    perAtomMeta[key] = meta;
    const origins = originsByUrl(item.result);
    for (const [url, engines] of origins) {
      const list = (enginesByUrl[url] ??= []);
      for (const e of engines) if (!list.includes(e)) list.push(e);
    }
    enginesPerAtom[key] = {
      returned: countEngines(listed.map((s) => s.url), origins),
      kept: countEngines(filtered.map((s) => s.url), origins),
      returnedTotal: listed.length,
      keptTotal: filtered.length,
    };
    totals.before += meta.before;
    totals.afterFilter += meta.afterFilter;
    totals.afterDedupe += meta.afterDedupe;
    totals.afterTopK += meta.afterTopK;

    const sources: AtomSearchSource[] = filtered.map((s) => ({
      url: s.url,
      title: s.title,
      snippet: s.snippet,
      credibility: s.credibility,
      ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
      ...(s.publisher ? { publisher: s.publisher } : {}),
      // 本轮实际取得材料的时间；检索路径只拿到摘要，不是原文。
      retrievedAt,
      excerptKind: "search-snippet" as const,
      fetchStatus: "snippet-only" as const,
    }));
    byAtomKey[key] = sources;
    forAgent.push({ claimAtom: atom, sources });

    const res = item.result as Record<string, unknown> | null;
    if (res && typeof res.answer === "string" && res.answer.trim()) {
      answers.push(`[${atom.slice(0, 40)}] ${res.answer.slice(0, 400)}`);
    }
    if (res && typeof res.model === "string") models.push(res.model);

    for (const s of sources) {
      if (seenUrl.has(s.url)) continue;
      seenUrl.add(s.url);
      aggregateSources.push({
        title: s.title,
        url: s.url,
        snippet: s.snippet,
        credibility: s.credibility || "",
        ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
        ...(s.publisher ? { publisher: s.publisher } : {}),
        forClaimAtom: atom,
      });
    }
  }

  return {
    atomsSearched,
    byAtomKey,
    forAgent,
    knowledgeDrafts: [],
    filterMeta: { perAtom: perAtomMeta, totals },
    enginesByUrl,
    enginesPerAtom,
    aggregate: {
      answer: answers.join("\n\n").slice(0, 1800),
      sources: aggregateSources.slice(0, 24),
      relatedQuestions: [],
      model: models.slice(0, 3).join(" | ") || "atom-search",
      traceText: `按可核查原子检索 ${atomsSearched.length} 轮；筛选 ${totals.before}→${totals.afterTopK} 条（滤/去重/topK），聚合去重来源 ${aggregateSources.length} 条。`,
      _source: "per-atom-search",
      supportingEvidence: [],
      contradictingEvidence: [],
      unresolvedEvidenceGaps: [],
    },
  };
}

export type BindableVerdict = {
  claimAtom: string;
  evidence?: string;
  supportingSources?: AtomSearchSource[];
  contradictingSources?: AtomSearchSource[];
  evidenceGaps?: string[];
  /** true when supportingSources came from retrieval fill, not model citation */
  sourcesRelatedOnly?: boolean;
  [key: string]: unknown;
};

/**
 * 报告按条绑证据：
 * - 模型写出的 URL 仅保留「该原子本轮检索」里出现过的；
 *   evidence [n] 按 supportingSources 再 contradictingSources 的合并顺序重写；
 *   始终传入该原子 known 集合，空集合不是 null，以免幻觉 URL 留下；
 * - 若支撑/反证都空且检索有结果 → 填入 supportingSources 作「相关检索」，并剥离 [n]
 *   （禁止把检索填充误绑成句内引用）；
 * - 若检索也为空 → evidenceGaps 补「该原子定向检索无结果」。
 * - 仅 related-only，或两侧都无 http(s)，且 verdict 为 true/false → unverified，补「待补证」。
 */
export function bindAtomEvidenceToVerdicts<T extends BindableVerdict>(
  verdicts: T[],
  byAtomKey: Record<string, AtomSearchSource[]>,
  claimAtomKeyFn: (s: string) => string
): T[] {
  return verdicts.map((v) => {
    const key = claimAtomKeyFn(String(v.claimAtom ?? ""));
    const retrieved = byAtomKey[key] ?? [];
    const known = new Set(retrieved.map((s) => s.url));

    const verdictNorm = typeof v.verdict === "string" ? v.verdict.trim().toLowerCase() : "";
    const supportingRaw = Array.isArray(v.supportingSources) ? v.supportingSources : [];
    const contradictingRaw = Array.isArray(v.contradictingSources) ? v.contradictingSources : [];
    const aligned = alignFalseEvidenceBuckets({
      verdict: verdictNorm,
      sourcesRelatedOnly: v.sourcesRelatedOnly === true,
      supporting: supportingRaw,
      contradicting: contradictingRaw,
    });
    const bound = bindDualBucketCitations(v.evidence, aligned.supporting, aligned.contradicting, known);
    const canonicalByUrl = new Map(retrieved.map((source) => [source.url, source]));
    // A valid URL proves identity only. The model is not allowed to rewrite the
    // page title/snippet that later appears in reports or drawers.
    // The model's snippet is the sentence it copied from this source; keep it as `quote`.
    // The snapshot stores it only after checking it against the canonical text.
    const canonicalize = (sources: typeof bound.supportingSources) =>
      sources.map((source) => {
        const canonical = canonicalByUrl.get(source.url);
        if (!canonical) return source;
        const quote = source.quote ?? (source.snippet !== canonical.snippet ? source.snippet : "");
        return { ...canonical, url: canonical.url, title: canonical.title, snippet: canonical.snippet, ...(quote ? { quote } : {}) };
      });
    let supporting = canonicalize(bound.supportingSources);
    let contradicting = canonicalize(bound.contradictingSources);
    let evidence = bound.text;
    // Rebinding cannot promote explicitly related material into directional evidence.
    let sourcesRelatedOnly = v.sourcesRelatedOnly === true;
    if (sourcesRelatedOnly) evidence = stripCitationMarkers(evidence);

    let gaps = Array.isArray(v.evidenceGaps)
      ? v.evidenceGaps.filter((g): g is string => typeof g === "string").slice(0, 3)
      : [];

    if (supporting.length === 0 && contradicting.length === 0) {
      if (retrieved.length > 0) {
        const related = bindRelatedSourcesOnly(evidence, retrieved);
        supporting = related.sources;
        evidence = related.text;
        sourcesRelatedOnly = true;
      } else if (!gaps.some((g) => g.includes("定向检索"))) {
        gaps = [...gaps, "该原子定向检索无结果，待补证"].slice(0, 3);
        evidence = stripCitationMarkers(typeof v.evidence === "string" ? v.evidence : evidence);
      }
    }

    const hasHttpUrl = [...supporting, ...contradicting].some(
      (s) => typeof s?.url === "string" && /^https?:\/\//i.test(s.url)
    );
    const downgradeTrueFalse =
      (verdictNorm === "true" || verdictNorm === "false") && (sourcesRelatedOnly || !hasHttpUrl);
    if (downgradeTrueFalse && !gaps.some((g) => g.includes("待补证"))) {
      gaps = ["待补证", ...gaps].slice(0, 3);
    }

    return {
      ...v,
      evidence,
      supportingSources: supporting,
      contradictingSources: contradicting,
      evidenceGaps: gaps,
      sourcesRelatedOnly,
      ...(downgradeTrueFalse ? { verdict: "unverified", demotedFrom: verdictNorm } : {}),
    };
  });
}

export function attachKnowledgeDrafts(
  agentInput: Record<string, unknown>,
  bundle: Pick<AtomSearchBundle, "knowledgeDrafts"> | null | undefined
): void {
  const drafts = bundle?.knowledgeDrafts;
  if (drafts && drafts.length > 0) agentInput.knowledgeDrafts = drafts;
}

/** 复用材料至少要有 1 条真实 http(s) 证据才配得上「免于本次检索」（没证据不出结论）。 */
function usableKnowledgeEvidence(injection: KnowledgeInjection): KnowledgeInjection["evidence"] {
  return (Array.isArray(injection?.evidence) ? injection.evidence : []).filter((item) =>
    /^https?:\/\//i.test(String(item?.url ?? "").trim())
  );
}

/**
 * 把上一轮证据注入 bundle（线上检索路径之外的唯一入口，纯函数）。
 *
 * 注入纪律：
 * - 只留真实 http(s) URL；没有可用来源返回 0（调用方据此不记 injected）。
 * - 证据位先、检索垫后：注入的是「上次核过这条命题时绑过的证据」，排在本次检索材料之前。
 * - 同时写进 `aggregate.sources`：`mergeSubclaimVerdicts` 用聚合来源当 URL 白名单，
 *   少写一处模型引用就会被当幻觉剥掉，注入等于白做。
 * - 注入的原子追加进 `atomsSearched`：它是「这次该原子有材料」的既有信号（见类型注释）。
 * - 不改 traceText / filterMeta：那两项统计的是本次联网检索做了多少轮、滤掉多少条，
 *   注入没走那条漏斗，硬算进去反而让数字变假。
 */
export function injectKnowledgeEvidence(
  bundle: AtomSearchBundle,
  atom: string,
  injection: KnowledgeInjection,
  claimAtomKeyFn: (s: string) => string,
  provenance: "prior-round" = "prior-round"
): number {
  const key = claimAtomKeyFn(atom);
  const existing = bundle.byAtomKey[key] ?? [];
  const seen = new Set(existing.map((s) => s.url));
  const aggregateSeen = new Set(
    bundle.aggregate.sources.map((s) => String((s as { url?: unknown }).url ?? ""))
  );
  const added: AtomSearchSource[] = [];
  for (const item of usableKnowledgeEvidence(injection)) {
    const url = String(item?.url ?? "").trim();
    if (seen.has(url)) continue;
    seen.add(url);
    added.push({
      url,
      title: String(item?.title ?? "").slice(0, 200),
      snippet: String(item?.snippet ?? "").slice(0, 900),
      provenance,
      originDate: injection.originDate,
    });
  }
  if (added.length === 0) return 0;

  const merged = [...added, ...existing];
  bundle.byAtomKey[key] = merged;
  const forAgentItem = bundle.forAgent.find((f) => claimAtomKeyFn(f.claimAtom) === key);
  if (forAgentItem) forAgentItem.sources = merged;
  else bundle.forAgent.push({ claimAtom: atom, sources: merged });

  for (const source of added) {
    if (aggregateSeen.has(source.url)) continue;
    aggregateSeen.add(source.url);
    bundle.aggregate.sources.push({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      credibility: "",
      forClaimAtom: atom,
    });
  }

  if (!bundle.atomsSearched.some((entry) => claimAtomKeyFn(entry) === key)) {
    bundle.atomsSearched.push(atom);
  }
  if (!bundle.knowledgeDrafts) bundle.knowledgeDrafts = [];
  const priorVerdict = String(injection.priorVerdict ?? "").trim();
  if (priorVerdict) {
    bundle.knowledgeDrafts.push({
      claimAtom: atom,
      originDate: injection.originDate,
      priorVerdict,
      evidence: added.map((source) => ({ url: source.url, title: source.title, snippet: source.snippet })),
    });
  }
  return added.length;
}

/**
 * Per-atom retrieval behind one interface.
 * Selects verifiable atoms, calls searchOne per atom, builds bundle with claimAtomKey.
 *
 * 同一案追问：`priorRound` 命中的 atom 用上一轮证据替换这次联网（也不占 MAX_ATOM_SEARCHES 名额），
 * 名额让给后面的原子。其余 atom 一律联网检索。
 */
export async function retrieveForAtoms(options: {
  claimAtoms: unknown;
  claimAtomTypes: unknown;
  /** Priority changes order only; candidates still come from retained checkable atoms. */
  priorityClaimAtoms?: unknown;
  onPlan?: (plan: { includedAtoms: string[]; deferredAtoms: string[] }) => void;
  searchOne: SearchOneAtom;
  hooks?: RetrieveForAtomsHooks;
  claimAtomKeyFn?: (s: string) => string;
  /** 同一案上一轮证据（契约 docs/evals/2026-09-13-followup-fast-path.md）。 */
  priorRound?: {
    lookup: (atom: string) => KnowledgeInjection | null;
    onInjected?: (hit: KnowledgeHit) => void;
  };
}): Promise<{
  atomsToSearch: string[];
  atomSearchBundle: AtomSearchBundle;
  search360Result: AtomSearchBundle["aggregate"];
  /** 复用同一案上一轮证据的原子。 */
  priorRoundHits: KnowledgeHit[];
}> {
  const keyFn = options.claimAtomKeyFn ?? claimAtomKey;
  const listed = listAtomsForSearch(options.claimAtoms, options.claimAtomTypes);

  const collectInjections = (
    atoms: string[],
    channel: { lookup: (atom: string) => KnowledgeInjection | null } | undefined
  ): Array<{ atom: string; injection: KnowledgeInjection }> => {
    if (!channel) return [];
    const out: Array<{ atom: string; injection: KnowledgeInjection }> = [];
    for (const atom of atoms) {
      let injection: KnowledgeInjection | null = null;
      try {
        injection = channel.lookup(atom);
      } catch (error) {
        console.warn(`[atomSearch] 复用查库失败，按未命中处理: ${String(error)}`);
        injection = null;
      }
      if (injection && usableKnowledgeEvidence(injection).length > 0) {
        out.push({ atom, injection });
      }
    }
    return out;
  };

  // 上一轮命中的原子退出联网候选，名额自然让给新问题。
  const injections = collectInjections(listed.verifiable, options.priorRound);
  const injectedKeys = new Set(injections.map(({ atom }) => keyFn(atom)));
  const candidates =
    injectedKeys.size === 0
      ? listed.verifiable
      : listed.verifiable.filter((atom) => !injectedKeys.has(keyFn(atom)));
  const priorities = Array.isArray(options.priorityClaimAtoms)
    ? options.priorityClaimAtoms.filter((atom): atom is string => typeof atom === "string")
    : [];
  const atomsToSearch = selectAtomsToSearch(candidates, listed.typeByKey, priorities);
  const includedAtoms = [...injections.map(({ atom }) => atom), ...atomsToSearch];
  const includedKeys = new Set(includedAtoms.map((atom) => keyFn(atom)));
  options.onPlan?.({
    includedAtoms,
    deferredAtoms: listed.verifiable.filter((atom) => !includedKeys.has(keyFn(atom))),
  });
  const mode = options.hooks?.mode ?? "parallel";
  const items: AtomSearchItem[] = [];

  if (mode === "sequential") {
    for (const atom of atomsToSearch) {
      options.hooks?.onAtomStart?.(atom);
      const result = await options.searchOne(atom);
      options.hooks?.onAtomResult?.(atom, result);
      items.push({ atom, result });
    }
  } else {
    const settled = await Promise.all(
      atomsToSearch.map(async (atom) => {
        options.hooks?.onAtomStart?.(atom);
        const result = await options.searchOne(atom);
        options.hooks?.onAtomResult?.(atom, result);
        return { atom, result };
      })
    );
    items.push(...settled);
  }

  const atomSearchBundle = buildAtomSearchBundle(items, keyFn);
  const priorRoundHits: KnowledgeHit[] = [];
  for (const { atom, injection } of injections) {
    const sourceCount = injectKnowledgeEvidence(atomSearchBundle, atom, injection, keyFn, "prior-round");
    if (sourceCount === 0) continue;
    const hit: KnowledgeHit = { atom, originDate: injection.originDate, sourceCount };
    priorRoundHits.push(hit);
    options.priorRound?.onInjected?.(hit);
  }
  return {
    atomsToSearch,
    atomSearchBundle,
    search360Result: atomSearchBundle.aggregate,
    priorRoundHits,
  };
}
