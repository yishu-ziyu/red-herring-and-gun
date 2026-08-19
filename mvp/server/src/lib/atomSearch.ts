/**
 * 可核查原子检索（decompose-then-verify 的检索侧）。
 * Pure transforms: select / build / bind.
 * I/O seam: SearchOneAtom adapter via retrieveForAtoms.
 * 整句兜底 / query 合并 / 缓存不在本模块。
 */

import {
  MAX_CLAIM_ATOMS,
  claimAtomKey,
  compactStrings,
  type NonVerifiableAtom,
  type SubclaimVerdict,
} from "./claimAtom/index.js";
import { filterAtomSources, type FilterMeta, type FilterableSource } from "./retrievalFilter.js";
import {
  bindLocalCitations,
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
};

export type AtomSearchItem = {
  atom: string;
  result: unknown;
};

export type AtomSearchBundle = {
  /** 实际发起检索的原子（截断后） */
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
  /** 筛选可观测性：过滤前→后条数 */
  filterMeta?: {
    perAtom: Record<string, FilterMeta>;
    totals: FilterMeta;
  };
};

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
    out.push({
      url,
      title: String(rec.title || rec.name || "").slice(0, 200),
      snippet: String(rec.condensedSnippet || rec.snippet || rec.summary || rec.content || "").slice(0, 320),
      credibility: typeof rec.credibility === "string" ? rec.credibility : undefined,
      providerRank: i,
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
  return typeByKey[key] ?? typeByKey[atom];
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
  typeByKey?: ReadonlyMap<string, string> | Record<string, string>
): string[] {
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
    }))
    .sort((a, b) => b.load - a.load || a.index - b.index)
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

  for (const item of items) {
    if (!item || typeof item.atom !== "string") continue;
    const atom = item.atom;
    atomsSearched.push(atom);
    const key = claimAtomKeyFn(atom);
    const rawSources = asSourceList(item.result);
    const { sources: filtered, meta } = filterAtomSources(rawSources);
    perAtomMeta[key] = meta;
    totals.before += meta.before;
    totals.afterFilter += meta.afterFilter;
    totals.afterDedupe += meta.afterDedupe;
    totals.afterTopK += meta.afterTopK;

    const sources: AtomSearchSource[] = filtered.map((s) => ({
      url: s.url,
      title: s.title,
      snippet: s.snippet,
      credibility: s.credibility,
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
        forClaimAtom: atom,
      });
    }
  }

  return {
    atomsSearched,
    byAtomKey,
    forAgent,
    filterMeta: { perAtom: perAtomMeta, totals },
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
 * - 模型写出的 URL 仅保留「该原子本轮检索」里出现过的，并按过滤结果重写 evidence [n]；
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

    const modelSupportingRaw = v.supportingSources;
    const hadModelSupporting =
      Array.isArray(modelSupportingRaw) &&
      modelSupportingRaw.some((s) => s && typeof s === "object" && String((s as AtomSearchSource).url || "").trim());

    const boundSupport = bindLocalCitations(v.evidence, modelSupportingRaw, known);
    let supporting = boundSupport.sources;
    let evidence = boundSupport.text;
    let sourcesRelatedOnly = false;

    const boundContra = bindLocalCitations("", v.contradictingSources, known);
    let contradicting = boundContra.sources;

    let gaps = Array.isArray(v.evidenceGaps)
      ? v.evidenceGaps.filter((g): g is string => typeof g === "string").slice(0, 3)
      : [];

    if (supporting.length === 0 && contradicting.length === 0) {
      if (retrieved.length > 0) {
        const related = bindRelatedSourcesOnly(hadModelSupporting ? evidence : v.evidence, retrieved);
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
    const verdictNorm = typeof v.verdict === "string" ? v.verdict.trim().toLowerCase() : "";
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
      ...(downgradeTrueFalse ? { verdict: "unverified" } : {}),
    };
  });
}

/**
 * Per-atom retrieval behind one interface.
 * Selects verifiable atoms, calls searchOne per atom, builds bundle with claimAtomKey.
 */
export async function retrieveForAtoms(options: {
  claimAtoms: unknown;
  claimAtomTypes: unknown;
  searchOne: SearchOneAtom;
  hooks?: RetrieveForAtomsHooks;
  claimAtomKeyFn?: (s: string) => string;
}): Promise<{ atomsToSearch: string[]; atomSearchBundle: AtomSearchBundle; search360Result: AtomSearchBundle["aggregate"] }> {
  const keyFn = options.claimAtomKeyFn ?? claimAtomKey;
  const listed = listAtomsForSearch(options.claimAtoms, options.claimAtomTypes);
  const atomsToSearch = selectAtomsToSearch(listed.verifiable, listed.typeByKey);
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
  return {
    atomsToSearch,
    atomSearchBundle,
    search360Result: atomSearchBundle.aggregate,
  };
}
