/**
 * Conclusion 收权门（Issue #78 §11 绝对硬门）——确定性代码，不读结论文本。
 *
 * 不变量：Summary 不能比 Claim / Evidence 层更「知道答案」。
 * - not-applicable / evidence=[] 的命题不得支撑整句 supported/refuted；
 * - 整句 hard verdict（true/false）必须有方向一致、带绑定来源的原子判词支撑；
 * - audit 未解决的桥接缺口存在时，整句不得写成硬 true/false（A+B 真推不出 C 真）。
 *
 * 语义一致性（结论文本有没有把 not-applicable 写成已证伪）由模型层负责：
 * ReportComposer 输入带 nonVerifiableAtoms + wholeClaimAudit 上下文并受 prompt 约束；
 * 本门只用结构化状态做最后兜底，绝不用关键词 regex 判断结论文本越权。
 *
 * 放置点：assembleFinalReport / mixed guard 之后、boundTinyRumorVerdict 之前——
 * 短谣确定性 force-false 与 reportReviewer 的既有闸不受影响。
 */

import { deriveOverallVerdict } from "../reportAssembly/assembleFinalReport.js";
import { listAtomsForSearch } from "../atomSearch.js";

export type ConclusionGateInput = {
  claimAtoms?: unknown;
  claimAtomTypes?: unknown;
  /** finalReport.subclaimVerdicts（bind 之后）。 */
  subclaimVerdicts?: unknown;
  /** Whole-Claim Evaluation 结算后仍未取得来源的桥接缺口。 */
  auditUnresolvedGaps?: readonly string[];
};

export type ConclusionGateResult = {
  changed: boolean;
  from?: string;
  to?: string;
  rule?: string;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sourceHasHttpUrl(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return /^https?:\/\//i.test(String((value as { url?: unknown }).url || "").trim());
}

function verdictHasBoundHttpUrl(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  if (rec.sourcesRelatedOnly === true) return false;
  return (
    asArray(rec.supportingSources).some(sourceHasHttpUrl) ||
    asArray(rec.contradictingSources).some(sourceHasHttpUrl)
  );
}

function hasSourcedFalseVerdict(verdicts: unknown[]): boolean {
  return verdicts.some(
    (v) =>
      v &&
      typeof v === "object" &&
      String((v as Record<string, unknown>).verdict ?? "").trim().toLowerCase() === "false" &&
      verdictHasBoundHttpUrl(v)
  );
}

/** 整句收权门：返回（可能降级后的）verdictType 与触发记录。不改判词文本。 */
export function applyConclusionGate(
  report: Record<string, unknown>,
  input: ConclusionGateInput = {}
): ConclusionGateResult {
  const verdictType = String(report?.verdictType ?? "").trim();
  if (!["true", "false", "mixed_misleading"].includes(verdictType)) {
    return { changed: false };
  }

  const verdicts = asArray(input.subclaimVerdicts).filter(
    (v): v is Record<string, unknown> => Boolean(v && typeof v === "object")
  );
  const listed = listAtomsForSearch(input.claimAtoms, input.claimAtomTypes);
  const derived = deriveOverallVerdict(verdicts);
  // 判词层完全没有绑定 URL 时，reportReviewer 的 unsourced_hard / overclaim 闸已经覆盖
  // （带 credibility 封顶）；本门只补「有绑定材料但方向不符」的缺口，不重复惩罚。
  const hasAnyBoundUrl = verdicts.some(verdictHasBoundHttpUrl);

  const demote = (to: string, rule: string): ConclusionGateResult => {
    report._conclusionGate = { from: verdictType, to, rule };
    report.verdictType = to;
    return { changed: true, from: verdictType, to, rule };
  };

  // 1) 全部命题都不适用真/假判断 → 整句不得是任何硬判定。
  if (listed.verifiable.length === 0 && listed.nonVerifiable.length > 0) {
    return demote("unverified", "all-atoms-not-applicable");
  }

  // 2) 整句 false 必须有「判 false 且带绑定 URL」的原子支撑（#78 真实失败形状：
  //    仅 partial 原子带来源，composer 却写整句不成立）。
  if (verdictType === "false" && hasAnyBoundUrl && !hasSourcedFalseVerdict(verdicts)) {
    return demote(
      derived === "partial" ? "mixed_misleading" : "unverified",
      "false-without-sourced-false-atom"
    );
  }

  // 3) 整句 true 必须有「有据之真」支撑（有绑定材料但无 sourced-true 时不救）。
  if (verdictType === "true" && hasAnyBoundUrl && derived !== "true") {
    return demote(
      derived === "partial" ? "mixed_misleading" : "unverified",
      "true-without-sourced-true-atoms"
    );
  }

  // 4) audit 未解决的桥接缺口：前提真不自动推出整句结论 → 硬 true/false 收成 unverified
  //    （mixed_misleading 两侧都要求绑定来源，保持不变）。
  const auditUnresolved = input.auditUnresolvedGaps?.length ?? 0;
  if (auditUnresolved > 0 && (verdictType === "true" || verdictType === "false")) {
    return demote("unverified", "audit-unresolved-bridge-gap");
  }

  return { changed: false };
}
