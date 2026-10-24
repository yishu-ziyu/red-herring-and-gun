/**
 * 判词能引用的来源只能是本轮材料：任一原子检索到的来源都算（同一句话另一部分搜到的页面也能判这一部分），
 * 本轮没人检索到的 URL 一律当编造剥掉。剥完之后 true / false 判词没有来源撑着，就降为 unverified。
 */
import { claimAtomKey } from "../../../shared/claimAtomText.js";
import type { AtomSearchBundle, AtomSearchSource } from "./atomSearch.js";
import { hasDirectionalBoundHttpUrl } from "./citationBinding.js";

const UNSOURCED_GAP = "待补证";

export type EvidenceGate = {
  /** 本轮材料的全部 URL。 */
  knownUrls: Set<string>;
  /** 本轮材料里这个 URL 的条目：标题与摘要以它为准，不用模型改写的。 */
  material: (url: string) => AtomSearchSource | undefined;
  /** 这一条原子自己检索到的材料。 */
  forAtom: (claimAtom: string) => AtomSearchSource[];
};

export function evidenceGateFor(bundle: Pick<AtomSearchBundle, "byAtomKey">): EvidenceGate {
  const byUrl = new Map<string, AtomSearchSource>();
  for (const source of Object.values(bundle.byAtomKey).flat()) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }
  return {
    knownUrls: new Set(byUrl.keys()),
    material: (url) => byUrl.get(url),
    forAtom: (claimAtom) => bundle.byAtomKey[claimAtomKey(claimAtom)] ?? [],
  };
}

/**
 * true / false 判词必须有本轮来源撑着；related-only 的检索填充不算。
 * 来源方向审核之前，两个桶里的来源都算：审核还会把放错桶的来源挪回去。
 * 审核之后 true 只认支持桶、false 只认反驳桶，与整句规则表（sentenceVerdict.standingOf）同一条规则。
 */
export function requireCitedSource(input: {
  verdict: string;
  supportingSources: unknown[];
  contradictingSources: unknown[];
  sourcesRelatedOnly: boolean;
  evidenceGaps: string[];
  directionAudited: boolean;
}): { demoted: boolean; evidenceGaps: string[] } {
  const { verdict, evidenceGaps } = input;
  if (verdict !== "true" && verdict !== "false") return { demoted: false, evidenceGaps };
  const backed = hasDirectionalBoundHttpUrl({
    verdict: input.directionAudited ? verdict : "",
    supportingSources: input.supportingSources,
    contradictingSources: input.contradictingSources,
    sourcesRelatedOnly: input.sourcesRelatedOnly,
  });
  if (backed) return { demoted: false, evidenceGaps };
  return {
    demoted: true,
    evidenceGaps: evidenceGaps.some((gap) => gap.includes(UNSOURCED_GAP))
      ? evidenceGaps
      : [UNSOURCED_GAP, ...evidenceGaps].slice(0, 3),
  };
}
