/**
 * 可核查原子检索（decompose-then-verify 的检索侧）。
 * Pure transforms: select / build / bind.
 * I/O seam: SearchOneAtom adapter via retrieveForAtoms.
 * 整句兜底 / query 合并 / 缓存不在本模块。
 */

import { MAX_CLAIM_ATOMS, claimAtomKey, compactStrings } from "../../../shared/claimAtomText.js";
import { alignFalseEvidenceBuckets } from "./claimAtom/merge.js";
import type { NonVerifiableAtom, SubclaimVerdict } from "./claimAtom/types.js";
import type { SearchSource } from "./search/searchAtom.js";
import {
  bindDualBucketCitations,
  bindRelatedSourcesOnly,
  stripCitationMarkers,
} from "./citationBinding.js";
import { requireCitedSource, type EvidenceGate } from "./evidenceGate.js";
const MAX_ATOM_SEARCHES = 6;
const CAUSAL_LOAD_RE = /导致|造成|引起|致使/;
const DIGIT_LOAD_RE = /\d/;
const SEARCH_BUDGET_GAP = "检索预算未覆盖";

/** Adapter at the search seam: one atom → raw search result. */
export type SearchOneAtom = (atom: string) => Promise<unknown>;

type RetrieveForAtomsHooks = {
  onAtomStart?: (atom: string) => void;
  onAtomResult?: (atom: string, result: unknown) => void;
};

export type AtomSearchSource = {
  materialId?: string;
  url: string;
  title: string;
  snippet: string;
  credibility?: string;
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

type AtomSearchItem = {
  atom: string;
  result: unknown;
};

export type AtomSearchBundle = {
  /**
   * 本次检索过的原子（截断后）。下游按「已在 atomsSearched 里」判断该原子有材料，
   * 不在这里的会被按「检索预算未覆盖」压成 unverified。
   */
  atomsSearched: string[];
  /** claimAtomKey → 该原子检索到的来源（已筛选）。每条来源只存在这里，其余视图都由它推出。 */
  byAtomKey: Record<string, AtomSearchSource[]>;
  /** 检索返回时的汇总：各轮答案、模型名、检索漏斗统计。 */
  summary: { answer: string; model: string; traceText: string };
};

/** 给核查模型的按条材料，顺序同 atomsSearched。 */
export function atomSearchesForAgent(bundle: AtomSearchBundle): Array<{ claimAtom: string; sources: AtomSearchSource[] }> {
  return bundle.atomsSearched.map((atom) => ({ claimAtom: atom, sources: bundle.byAtomKey[claimAtomKey(atom)] ?? [] }));
}

/** 各原子来源按 URL 去重后的聚合检索结果：核查模型输入里的 webSearch、报告骨架的搜索来源层读它。 */
export function searchResultOf(bundle: AtomSearchBundle) {
  const seen = new Set<string>();
  const sources: Array<Record<string, unknown>> = [];
  for (const { claimAtom, sources: list } of atomSearchesForAgent(bundle)) {
    for (const s of list) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push({
        title: s.title,
        url: s.url,
        snippet: s.snippet,
        credibility: s.credibility || "",
        ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
        ...(s.publisher ? { publisher: s.publisher } : {}),
        forClaimAtom: claimAtom,
      });
    }
  }
  return {
    ...bundle.summary,
    sources,
    relatedQuestions: [] as string[],
    _source: "per-atom-search",
    supportingEvidence: [] as string[],
    contradictingEvidence: [] as string[],
    unresolvedEvidenceGaps: [] as string[],
  };
}

/** The search seam hands over an already filtered and ranked list. */
function foundSources(result: unknown): SearchSource[] {
  const sources = (result as { sources?: unknown } | null)?.sources;
  return Array.isArray(sources) ? sources : [];
}

function atomSearchLoad(atom: string, type?: string): number {
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
 * 把「每原子一轮」的检索结果打成 bundle。键与 merge/claimItems 同为 claimAtomKey。
 */
function buildAtomSearchBundle(
  items: AtomSearchItem[],
): AtomSearchBundle {
  const byAtomKey: Record<string, AtomSearchSource[]> = {};
  const seenUrl = new Set<string>();
  const answers: string[] = [];
  const models: string[] = [];
  const atomsSearched: string[] = [];
  let keptCount = 0;
  // 本轮材料实际取得时间：bundle 组装时刻，即这批检索结果到手的时间。
  const retrievedAt = new Date().toISOString();

  for (const item of items) {
    if (!item || typeof item.atom !== "string") continue;
    const atom = item.atom;
    atomsSearched.push(atom);
    const sources: AtomSearchSource[] = foundSources(item.result).map((s) => ({
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
    keptCount += sources.length;
    byAtomKey[claimAtomKey(atom)] = sources;
    for (const s of sources) seenUrl.add(s.url);

    const res = item.result as Record<string, unknown> | null;
    if (res && typeof res.answer === "string" && res.answer.trim()) {
      answers.push(`[${atom.slice(0, 40)}] ${res.answer.slice(0, 400)}`);
    }
    if (res && typeof res.model === "string") models.push(res.model);
  }

  return {
    atomsSearched,
    byAtomKey,
    summary: {
      answer: answers.join("\n\n").slice(0, 1800),
      model: models.slice(0, 3).join(" | ") || "atom-search",
      traceText: `按可核查原子检索 ${atomsSearched.length} 轮；保留 ${keptCount} 条来源，聚合去重来源 ${seenUrl.size} 条。`,
    },
  };
}

type BindableVerdict = {
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
 * - 模型写出的 URL 只保留本轮材料里有的（EvidenceGate），标题与摘要换回材料原文；
 *   evidence [n] 按 supportingSources 再 contradictingSources 的合并顺序重写；
 * - 若支撑/反证都空且该原子检索有结果 → 填入 supportingSources 作「相关检索」，并剥离 [n]
 *   （禁止把检索填充误绑成句内引用）；
 * - 若检索也为空 → evidenceGaps 补「该原子定向检索无结果」；
 * - true / false 没有来源撑着 → unverified（规则在 EvidenceGate）。
 */
export function bindAtomEvidenceToVerdicts<T extends BindableVerdict>(
  verdicts: T[],
  gate: EvidenceGate,
): T[] {
  return verdicts.map((v) => {
    const retrieved = gate.forAtom(String(v.claimAtom ?? ""));

    const verdictNorm = typeof v.verdict === "string" ? v.verdict.trim().toLowerCase() : "";
    const supportingRaw = Array.isArray(v.supportingSources) ? v.supportingSources : [];
    const contradictingRaw = Array.isArray(v.contradictingSources) ? v.contradictingSources : [];
    const aligned = alignFalseEvidenceBuckets({
      verdict: verdictNorm,
      sourcesRelatedOnly: v.sourcesRelatedOnly === true,
      supporting: supportingRaw,
      contradicting: contradictingRaw,
    });
    const bound = bindDualBucketCitations(v.evidence, aligned.supporting, aligned.contradicting, gate.knownUrls);
    // The model's snippet is the sentence it copied from this source; keep it as `quote`.
    // The snapshot stores it only after checking it against the canonical text.
    const canonicalize = (sources: typeof bound.supportingSources) =>
      sources.map((source) => {
        const canonical = gate.material(source.url);
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

    const cited = requireCitedSource({
      verdict: verdictNorm,
      supportingSources: supporting,
      contradictingSources: contradicting,
      sourcesRelatedOnly,
      evidenceGaps: gaps,
      directionAudited: false,
    });

    return {
      ...v,
      evidence,
      supportingSources: supporting,
      contradictingSources: contradicting,
      evidenceGaps: cited.evidenceGaps,
      sourcesRelatedOnly,
      ...(cited.demoted ? { verdict: "unverified", demotedFrom: verdictNorm } : {}),
    };
  });
}

/** Per-atom retrieval behind one interface: selects verifiable atoms, calls searchOne per atom, builds the bundle. */
export async function retrieveForAtoms(options: {
  claimAtoms: unknown;
  claimAtomTypes: unknown;
  /** Priority changes order only; candidates still come from retained checkable atoms. */
  priorityClaimAtoms?: unknown;
  onPlan?: (plan: { includedAtoms: string[]; deferredAtoms: string[] }) => void;
  searchOne: SearchOneAtom;
  hooks?: RetrieveForAtomsHooks;
}): Promise<AtomSearchBundle> {
  const listed = listAtomsForSearch(options.claimAtoms, options.claimAtomTypes);
  const priorities = Array.isArray(options.priorityClaimAtoms)
    ? options.priorityClaimAtoms.filter((atom): atom is string => typeof atom === "string")
    : [];
  const atomsToSearch = selectAtomsToSearch(listed.verifiable, listed.typeByKey, priorities);
  const includedKeys = new Set(atomsToSearch.map((atom) => claimAtomKey(atom)));
  options.onPlan?.({
    includedAtoms: [...atomsToSearch],
    deferredAtoms: listed.verifiable.filter((atom) => !includedKeys.has(claimAtomKey(atom))),
  });
  // 逐条顺序检索：每条的开始 / 结果按顺序上屏。
  const items: AtomSearchItem[] = [];
  for (const atom of atomsToSearch) {
    options.hooks?.onAtomStart?.(atom);
    const result = await options.searchOne(atom);
    options.hooks?.onAtomResult?.(atom, result);
    items.push({ atom, result });
  }
  return buildAtomSearchBundle(items);
}
