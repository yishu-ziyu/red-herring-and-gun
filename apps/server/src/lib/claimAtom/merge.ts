import type { SubclaimVerdict } from "./types.js";
import { claimAtomKey, compactStrings, compactText, MAX_CLAIM_ATOMS } from "../../../../shared/claimAtomText.js";
import { bindDualBucketCitations } from "../citationBinding.js";
import { requireCitedSource } from "../evidenceGate.js";
import { FALLBACK_PART_REASON, isLabelKey, labelForVerdict, verdictForLabel } from "../../../../shared/domain/labels.js";

const SUBCLAIM_VERDICTS = ["true", "false", "partial", "unverified", "exaggerated", "disputed"];

function sanitizeEvidenceGaps(value: unknown): string[] {
  return compactStrings(value, 3, 120);
}

/**
 * 原子命题立场分桶。supportingSources = 支持该原子命题；contradictingSources = 反驳该原子命题。
 * 结构化输出曾把 [n] 只绑在 supportingSources 上，模型会把证伪材料塞进 supporting。
 * verdict=false、反证桶为空、且不是 related-only 检索垫时，按判词改桶。
 * 不用 finding 文本或否定词猜语义。
 */
export function alignFalseEvidenceBuckets<T>(input: {
  verdict: string;
  supporting: T[];
  contradicting: T[];
  sourcesRelatedOnly?: boolean;
}): { supporting: T[]; contradicting: T[] } {
  const verdict = String(input.verdict ?? "").trim().toLowerCase();
  if (
    verdict === "false" &&
    input.sourcesRelatedOnly !== true &&
    input.supporting.length > 0 &&
    input.contradicting.length === 0
  ) {
    return { supporting: [], contradicting: input.supporting };
  }
  return { supporting: input.supporting, contradicting: input.contradicting };
}

/**
 * 锚原子 merge：幻觉拦截（knownUrls 来自 EvidenceGate；null 不拦）+ 未覆盖补 unverified。
 * evidence [n] 按 supportingSources 再 contradictingSources 的合并顺序重写。
 * 方向审核已经做过：true / false 要有方向一致的来源，否则收成 unverified。
 * 调用方应对「可核查原子」调用（排除层之后），不要把立场原子塞进来。
 */
export function mergeSubclaimVerdicts(
  claimAtoms: unknown,
  verdicts: unknown,
  knownUrls: Set<string> | null = null
): SubclaimVerdict[] {
  const atoms = compactStrings(claimAtoms, MAX_CLAIM_ATOMS, 180).map((s) => claimAtomKey(s));
  const raw = Array.isArray(verdicts) ? verdicts : [];
  const covered = new Set<string>();
  const result: SubclaimVerdict[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const atom = typeof rec.claimAtom === "string" ? rec.claimAtom : "";
    if (!atom) continue;
    const atomKey = claimAtomKey(atom);
    if (!atoms.includes(atomKey)) continue;
    covered.add(atomKey);
    // 模型现在给 9 个标签之一（domain/labels）；流水线内部仍读旧判词，由标签推出。
    // 审核降级后的判词优先于旧标签；后续合并不能恢复已经失去依据的判断。
    const demoted = rec.verdict === "unverified" && typeof rec.demotedFrom === "string";
    const modelLabel = demoted ? "unresolved" : isLabelKey(rec.label) ? rec.label : isLabelKey(rec.verdict) ? rec.verdict : undefined;
    const verdict = (modelLabel
      ? verdictForLabel(modelLabel)
      : SUBCLAIM_VERDICTS.includes(String(rec.verdict))
        ? String(rec.verdict)
        : "unverified") as SubclaimVerdict["verdict"];
    const label = modelLabel ?? labelForVerdict(verdict);
    const reason = demoted && rec.label !== "unresolved" ? FALLBACK_PART_REASON.unresolved : compactText(rec.reason, 160);
    const aligned = alignFalseEvidenceBuckets({
      verdict,
      sourcesRelatedOnly: rec.sourcesRelatedOnly === true,
      supporting: Array.isArray(rec.supportingSources) ? rec.supportingSources : [],
      contradicting: Array.isArray(rec.contradictingSources) ? rec.contradictingSources : [],
    });
    const bound = bindDualBucketCitations(
      rec.evidence,
      aligned.supporting,
      aligned.contradicting,
      knownUrls
    );
    const supportingSources = bound.supportingSources;
    const contradictingSources = bound.contradictingSources;
    const cited = requireCitedSource({
      verdict,
      supportingSources,
      contradictingSources,
      sourcesRelatedOnly: rec.sourcesRelatedOnly === true,
      evidenceGaps: sanitizeEvidenceGaps(rec.evidenceGaps),
      directionAudited: true,
    });
    const kept = cited.demoted ? "unverified" : verdict;
    result.push({
      claimAtom: atom,
      verdict: kept,
      evidence: compactText(bound.text, 240),
      boundary: compactText(rec.boundary, 200),
      ...(typeof rec.contradictedElement === "string" && rec.contradictedElement.trim()
        ? { contradictedElement: compactText(rec.contradictedElement.trim(), 120) }
        : {}),
      supportingSources,
      contradictingSources,
      evidenceGaps: cited.evidenceGaps,
      ...(rec.sourcesRelatedOnly === true ? { sourcesRelatedOnly: true } : {}),
      // 判定来历跨合并保留：规则层要分清「模型没判 / 模型判了但被降级 / 模型判了查不清」。
      ...(rec.notJudgedByModel === true ? { notJudgedByModel: true } : {}),
      ...(typeof rec.demotedFrom === "string" ? { demotedFrom: rec.demotedFrom } : {}),
      label: cited.demoted ? labelForVerdict(kept) : label,
      ...(cited.demoted
        ? { reason: FALLBACK_PART_REASON[labelForVerdict(kept)], demotedFrom: verdict }
        : reason ? { reason } : {}),
    });
  }
  for (const atom of atoms) {
    if (!covered.has(atom)) {
      result.push({
        claimAtom: atom,
        verdict: "unverified",
        evidence: "",
        boundary: "模型未覆盖，待补证",
        supportingSources: [],
        contradictingSources: [],
        evidenceGaps: [],
        // 结构化标记：这条命题没有任何模型判定（区别于模型判了「查不清」）。
        notJudgedByModel: true,
      });
    }
  }
  return result;
}

