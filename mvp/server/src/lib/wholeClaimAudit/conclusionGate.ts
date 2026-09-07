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
 * 放置点（Review 5128022550 Blocker 1）：early 留在 boundTiny 之前阻止绕过；
 * 权威 final gate 在 reviewer → normalize → pruneDeadCitations 之后、快照之前，
 * 以 liveness 后的存活证据为准（postLiveness），是最后一个改 verdict 的位置。
 * repair 触发由 needsConstrainedConclusion 按最终结构约束决定（Blocker 3），
 * 保证用户可见文本与 gated verdict 一致。
 */

import { deriveOverallVerdict } from "../reportAssembly/assembleFinalReport.js";
import { listAtomsForSearch } from "../atomSearch.js";
import { directAnswer } from "../publicCopy.js";

export type ConclusionGateInput = {
  claimAtoms?: unknown;
  claimAtomTypes?: unknown;
  /** finalReport.subclaimVerdicts（bind 之后）。 */
  subclaimVerdicts?: unknown;
  /** Whole-Claim Evaluation 结算后仍未取得来源的桥接缺口。 */
  auditUnresolvedGaps?: readonly string[];
  /**
   * liveness 之后运行的权威 final gate 传 true：此时判词里已无死链，
   * 硬 true/false 若没有任何存活的可点开证据支撑，直接收为 unverified
   *（死证不得支撑硬结论；唯一例外见 allowUnboundHardFalse）。
   */
  postLiveness?: boolean;
  /**
   * 短谣 legacy 通道豁免：聚合检索里仍有存活的 on-topic 辟谣且无对题支持时，
   * 允许无绑定判词的整句 false（对应 reviewer 的 keepBoundTinyFalse 豁免）。
   * 只对 false 有效，不适用于 true。
   */
  allowUnboundHardFalse?: boolean;
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
  if (verdictType === "false" && !hasSourcedFalseVerdict(verdicts)) {
    // liveness 之前：判词层完全没有绑定 URL 时留给 reportReviewer，不重复惩罚。
    if (!hasAnyBoundUrl && !input.postLiveness) return { changed: false };
    // liveness 之后：死证已剔除仍无存活支撑 → 收权；短谣存活辟谣通道豁免除外。
    if (!hasAnyBoundUrl && input.postLiveness && input.allowUnboundHardFalse) {
      return { changed: false };
    }
    if (!hasAnyBoundUrl && input.postLiveness) {
      return demote("unverified", "post-liveness-no-surviving-evidence");
    }
    return demote(
      derived === "partial" ? "mixed_misleading" : "unverified",
      "false-without-sourced-false-atom"
    );
  }

  // 3) 整句 true 必须有「有据之真」支撑（有绑定材料但无 sourced-true 时不救）。
  if (verdictType === "true") {
    // liveness 之后唯一支撑死掉 → 硬 true 不得保留。
    if (!hasAnyBoundUrl && input.postLiveness) {
      return demote("unverified", "post-liveness-no-surviving-evidence");
    }
    if (hasAnyBoundUrl && derived !== "true") {
      return demote(
        derived === "partial" ? "mixed_misleading" : "unverified",
        "true-without-sourced-true-atoms"
      );
    }
  }

  // 4) audit 未解决的桥接缺口：前提真不自动推出整句结论 → 硬 true/false 收成 unverified
  //    （mixed_misleading 两侧都要求绑定来源，保持不变）。
  const auditUnresolved = input.auditUnresolvedGaps?.length ?? 0;
  if (auditUnresolved > 0 && (verdictType === "true" || verdictType === "false")) {
    return demote("unverified", "audit-unresolved-bridge-gap");
  }

  return { changed: false };
}

export type GatedConclusionRepairInput = {
  nonVerifiableAtoms?: unknown;
  subclaimVerdicts?: unknown;
  auditUnresolvedGaps?: readonly string[];
};

function clipText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

function listNonVerifiableAtoms(value: unknown): Array<{ text: string; type: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ text: string; type: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    out.push({ text, type: typeof rec.type === "string" ? rec.type : "" });
  }
  return out;
}

function listSourcedVerdictEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.sourcesRelatedOnly === true) continue;
    const hasUrl =
      (Array.isArray(rec.supportingSources) &&
        rec.supportingSources.some((s) => /^https?:\/\//i.test(String((s as { url?: unknown } | null)?.url ?? "").trim()))) ||
      (Array.isArray(rec.contradictingSources) &&
        rec.contradictingSources.some((s) => /^https?:\/\//i.test(String((s as { url?: unknown } | null)?.url ?? "").trim())));
    if (!hasUrl) continue;
    const evidence = clipText(rec.evidence, 120);
    if (evidence) out.push(evidence);
    if (out.length >= 2) break;
  }
  return out;
}

const GATE_RULE_FINDING: Record<string, string> = {
  "all-atoms-not-applicable": "全部命题均不适用真假判断，整句不作真假判定。",
  "false-without-sourced-false-atom": "没有带可点开来源的证伪判定支撑整句不成立，整句不写成不成立。",
  "true-without-sourced-true-atoms": "没有带可点开来源的证实判定支撑整句成立，整句不写成成立。",
  "audit-unresolved-bridge-gap": "从各命题到整句结论的桥接依据仍未补齐，整句不写成确定成立或不成立。",
  "mixed-guard-partial": "部分命题有据成立、部分不成立，整句按有真有假表述，不写成整句不成立。",
  "post-liveness-no-surviving-evidence": "liveness 之后没有存活的可点开证据支撑硬结论，整句收为待核查。",
  "reviewer-demotion": "整句结论强度已被下调，文本同步收权到证据撑到的层级。",
  "weak-conclusion-audit-alignment": "整句为弱结论：不适用真假判断的表述与未补齐依据只作边界，不计入真假判定。",
};

function isHardVerdictType(value: string): boolean {
  return value === "true" || value === "false";
}

function isWeakVerdictType(value: string): boolean {
  return value === "mixed_misleading" || value === "unverified";
}

export type ConstrainedConclusionInput = {
  draftVerdictType?: unknown;
  finalVerdictType?: unknown;
  subclaimVerdicts?: unknown;
  nonVerifiableAtoms?: unknown;
  auditUnresolvedGaps?: readonly string[];
  finalGate?: ConclusionGateResult;
  earlyGate?: ConclusionGateResult;
  mixedGuardDemoted?: boolean;
};

export type ConstrainedConclusionDecision = {
  needed: boolean;
  rule: string;
  from: string;
  to: string;
};

/**
 * 最终结构化 repair 触发判断（Review 5128022550 Blocker 3）。
 *
 * 只读最终结构状态，不读 conclusion/summary 文本：
 * - 任何模块把 draft 硬 verdict 降为弱 verdict（含 reportReviewer/finalize），
 *   都必须同步修复用户可见文本；
 * - draft 本来就是弱 verdict，但存在 not-applicable Claim、未解决 audit 缺口、
 *   或没有任何存活 sourced relation 时，同样重建（无法确认原文安全时优先重建）。
 */
export function needsConstrainedConclusion(
  input: ConstrainedConclusionInput = {}
): ConstrainedConclusionDecision {
  const draft = String(input.draftVerdictType ?? "").trim();
  const final = String(input.finalVerdictType ?? "").trim();
  const weakened = isHardVerdictType(draft) && isWeakVerdictType(final);

  const verdicts = Array.isArray(input.subclaimVerdicts)
    ? (input.subclaimVerdicts as unknown[])
    : [];
  const hasNonVerifiable = listNonVerifiableAtoms(input.nonVerifiableAtoms).length > 0;
  const hasGaps = (input.auditUnresolvedGaps ?? []).length > 0;
  const hasSourced = verdicts.some(verdictHasBoundHttpUrl);

  const needed =
    weakened || (isWeakVerdictType(final) && (hasNonVerifiable || hasGaps || !hasSourced));

  let rule = "weak-conclusion-audit-alignment";
  if (input.finalGate?.changed && input.finalGate.rule) {
    rule = input.finalGate.rule;
  } else if (input.earlyGate?.changed && input.earlyGate.rule && final !== draft) {
    rule = input.earlyGate.rule;
  } else if (input.mixedGuardDemoted && final !== draft) {
    rule = "mixed-guard-partial";
  } else if (weakened) {
    rule = "reviewer-demotion";
  }
  return { needed, rule, from: draft, to: final };
}

/**
 * 受约束的 conclusion repair（Review 5127740625 Blocker 1）。
 *
 * 触发条件完全来自结构化状态：applyConclusionGate 发生 demote 时调用。
 * 本函数不读原 conclusion/summary 文本（不做任何关键词匹配），而是从
 * gated verdict + 有绑定来源的判词 evidence + nonVerifiableAtoms + audit 缺口
 * 重建用户可见文本：可核查命题已有的部分结论（判词 evidence）保留，
 * not-applicable 命题只按"不适用真假判断"表述并计入边界。
 */
export function repairGatedConclusion(
  report: Record<string, unknown>,
  gate: ConclusionGateResult,
  input: GatedConclusionRepairInput = {}
): void {
  if (!gate.changed || !gate.to) return;
  const gated = gate.to;
  const lead = directAnswer(gated);
  const nonVerifiable = listNonVerifiableAtoms(input.nonVerifiableAtoms).slice(0, 2);
  const sourcedEvidence = listSourcedVerdictEvidence(input.subclaimVerdicts);
  const gaps = (input.auditUnresolvedGaps ?? []).filter((g) => typeof g === "string" && g.trim()).slice(0, 1);

  const parts = [lead, ...sourcedEvidence];
  for (const atom of nonVerifiable) {
    parts.push(`「${clipText(atom.text, 40)}」不适用真假判断，未计入真假结论。`);
  }
  for (const gap of gaps) {
    parts.push(`仍缺关键依据：${clipText(gap, 120)}`);
  }
  report.conclusion = parts.join("").slice(0, 400);

  const summaryParts = [lead];
  if (nonVerifiable.length > 0) {
    summaryParts.push(`${nonVerifiable.length}条表述不适用真假判断，未计入结论。`);
  }
  if (gaps.length > 0) {
    summaryParts.push(`桥接依据仍未补齐：${clipText(gaps[0], 80)}`);
  }
  report.summaryForPublic = summaryParts.join("").slice(0, 200);
  report.recommendation = lead;

  const finding = GATE_RULE_FINDING[gate.rule ?? ""] ?? "整句结论已按证据层级收权。";
  const boundaryItems = [
    ...nonVerifiable.map((a) => `「${clipText(a.text, 40)}」不适用真假判断`),
    ...gaps.map((g) => `仍缺：${clipText(g, 100)}`),
  ];
  const gateLayer = {
    layer: "结论边界（整句收权）",
    finding,
    evidence: boundaryItems.length > 0 ? boundaryItems.join("；") : "结论只写到证据撑到的层级。",
    boundary: "结论只写到证据撑到的层级，不得据此推出更强的整句判定。",
    sourceRefs: [],
  };
  if (Array.isArray(report.evidenceChain)) {
    (report.evidenceChain as unknown[]).push(gateLayer);
  } else {
    report.evidenceChain = [gateLayer];
  }
  const prevGate =
    report._conclusionGate && typeof report._conclusionGate === "object"
      ? (report._conclusionGate as Record<string, unknown>)
      : {};
  report._conclusionGate = {
    ...prevGate,
    from: gate.from ?? prevGate.from,
    to: gated,
    rule: gate.rule ?? prevGate.rule,
    repaired: true,
  };
}
