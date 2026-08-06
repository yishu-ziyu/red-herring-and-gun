/**
 * 可核查原子检索（decompose-then-verify 的检索侧）。
 * 最小可演示：每个可核查原子一轮检索；整句兜底 / query 合并 / 缓存不在本模块。
 */

export const MAX_ATOM_SEARCHES = 6;

export type AtomSearchSource = {
  url: string;
  title: string;
  snippet: string;
};

export type AtomSearchItem = {
  atom: string;
  result: unknown;
};

export type AtomSearchBundle = {
  /** 实际发起检索的原子（截断后） */
  atomsSearched: string[];
  /** claimAtomKey → 该原子检索到的来源 */
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
};

function asSourceList(result: unknown): AtomSearchSource[] {
  const sources = (result as { sources?: unknown })?.sources;
  if (!Array.isArray(sources)) return [];
  const out: AtomSearchSource[] = [];
  for (const raw of sources.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const url = String(rec.url || rec.link || "").trim();
    if (!url) continue;
    out.push({
      url,
      title: String(rec.title || rec.name || "").slice(0, 200),
      snippet: String(rec.condensedSnippet || rec.snippet || rec.summary || rec.content || "").slice(0, 320),
    });
  }
  return out;
}

/** 选取要检索的可核查原子（上限 MAX_ATOM_SEARCHES） */
export function selectAtomsToSearch(verifiableAtoms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const atom of verifiableAtoms) {
    if (typeof atom !== "string" || !atom.trim()) continue;
    const key = atom.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_ATOM_SEARCHES) break;
  }
  return out;
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

  for (const item of items) {
    if (!item || typeof item.atom !== "string") continue;
    const atom = item.atom;
    atomsSearched.push(atom);
    const key = claimAtomKeyFn(atom);
    const sources = asSourceList(item.result);
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
        credibility: "",
        forClaimAtom: atom,
      });
    }
  }

  return {
    atomsSearched,
    byAtomKey,
    forAgent,
    aggregate: {
      answer: answers.join("\n\n").slice(0, 1800),
      sources: aggregateSources.slice(0, 24),
      relatedQuestions: [],
      model: models.slice(0, 3).join(" | ") || "atom-search",
      traceText: `按可核查原子检索 ${atomsSearched.length} 轮，合计去重来源 ${aggregateSources.length} 条。`,
      _source: "per-atom-search",
      supportingEvidence: [],
      contradictingEvidence: [],
      unresolvedEvidenceGaps: [],
    },
  };
}

export type BindableVerdict = {
  claimAtom: string;
  supportingSources?: AtomSearchSource[];
  contradictingSources?: AtomSearchSource[];
  evidenceGaps?: string[];
  [key: string]: unknown;
};

/**
 * 报告按条绑证据：
 * - 模型写出的 URL 仅保留「该原子本轮检索」里出现过的；
 * - 若支撑/反证都空且检索有结果 → 把检索来源填入 supportingSources（相关检索，供用户展开看）；
 * - 若检索也为空 → evidenceGaps 补「该原子定向检索无结果」。
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

    const filterKnown = (list: unknown): AtomSearchSource[] => {
      if (!Array.isArray(list)) return [];
      const out: AtomSearchSource[] = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const url = typeof rec.url === "string" ? rec.url.trim() : "";
        if (!url || !known.has(url)) continue;
        out.push({
          url,
          title: typeof rec.title === "string" ? rec.title.slice(0, 200) : "",
          snippet: typeof rec.snippet === "string" ? rec.snippet.slice(0, 320) : "",
        });
      }
      return out.slice(0, 5);
    };

    let supporting = filterKnown(v.supportingSources);
    let contradicting = filterKnown(v.contradictingSources);
    let gaps = Array.isArray(v.evidenceGaps)
      ? v.evidenceGaps.filter((g): g is string => typeof g === "string").slice(0, 3)
      : [];

    if (supporting.length === 0 && contradicting.length === 0) {
      if (retrieved.length > 0) {
        supporting = retrieved.slice(0, 5);
      } else if (!gaps.some((g) => g.includes("定向检索"))) {
        gaps = [...gaps, "该原子定向检索无结果，待补证"].slice(0, 3);
      }
    }

    return {
      ...v,
      supportingSources: supporting,
      contradictingSources: contradicting,
      evidenceGaps: gaps,
    };
  });
}
