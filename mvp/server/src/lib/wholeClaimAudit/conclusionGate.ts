/**
 * Conclusion 收权门（Issue #78 §11 绝对硬门）——确定性代码，不读结论文本。
 *
 * 不变量：Summary 不能比 Claim / Evidence 层更「知道答案」。
 * - not-applicable / evidence=[] / 方向无据的命题不得支撑整句 supported/refuted，
 *   也不得被整句硬结论偷偷判掉（Review 5128449568 Blocker 1）；
 * - 整句 hard verdict（true/false）必须有方向一致、带绑定来源的原子判词支撑
 *   （方向契约：hasDirectionalBoundHttpUrl，Review 5128449568 Blocker 3）；
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
import { hasDirectionalBoundHttpUrl } from "../citationBinding.js";

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

/**
 * 判词层是否还有「任何」绑定材料（两桶并集，方向不敏感）。
 * 只用于两个区分：「完全无绑定」vs「有绑定材料」（pre-liveness 礼让 reportReviewer、
 * post-liveness 全灭检查）。方向正确性一律走共享契约 hasDirectionalBoundHttpUrl。
 */
function verdictHasBoundHttpUrl(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  if (rec.sourcesRelatedOnly === true) return false;
  return (
    asArray(rec.supportingSources).some(sourceHasHttpUrl) ||
    asArray(rec.contradictingSources).some(sourceHasHttpUrl)
  );
}

function directionalBound(verdict: unknown, rec: Record<string, unknown>): boolean {
  return hasDirectionalBoundHttpUrl({
    verdict,
    supportingSources: rec.supportingSources,
    contradictingSources: rec.contradictingSources,
    sourcesRelatedOnly: rec.sourcesRelatedOnly,
  });
}

function hasSourcedFalseVerdict(verdicts: unknown[]): boolean {
  return verdicts.some(
    (v) =>
      v &&
      typeof v === "object" &&
      String((v as Record<string, unknown>).verdict ?? "").trim().toLowerCase() === "false" &&
      directionalBound("false", v as Record<string, unknown>)
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
  return buildScopedEvidence(value).texts;
}

/**
 * 未查清的 checkable 原子（Review 5128449568 Blocker 1）：
 * verdict=unverified，或 true/false 判词没有方向一致的绑定 URL（错桶/无源/related-only）。
 * 与 Snapshot 的方向判词映射（supported 需 support、refuted 需 contradict）同向：
 * 这些原子不得被整句硬结论当作已查清的消费对象，只能在文本里作「尚未查清」边界。
 */
function listUnresolvedCheckableAtoms(value: unknown): Array<{ text: string }> {
  const out: Array<{ text: string }> = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.claimAtom === "string" ? rec.claimAtom.trim() : "";
    if (!text) continue;
    const verdict = String(rec.verdict ?? "").trim().toLowerCase();
    if (verdict === "unverified") {
      out.push({ text });
      continue;
    }
    if (
      (verdict === "true" || verdict === "false") &&
      !directionalBound(verdict, rec)
    ) {
      out.push({ text });
    }
  }
  return out;
}

type ScopedSource = { url: string; title: string; snippet: string };

function collectBucketSources(value: unknown): ScopedSource[] {
  if (!Array.isArray(value)) return [];
  const out: ScopedSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = String(rec.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      url,
      title: String(rec.title ?? "").slice(0, 200),
      snippet: String(rec.snippet ?? "").slice(0, 320),
    });
  }
  return out;
}

/**
 * 把局部 [n] 映射到全局 source index（Review 5128220693 Blocker 2）。
 * 局部编号与判词双桶同构：supporting → [1..S]，contradicting → [S+1..S+C]。
 * 映射不到存活全局来源的 marker 直接删除，绝不错绑。
 */
function remapLocalMarkersToGlobal(
  evidence: string,
  supporting: ScopedSource[],
  contradicting: ScopedSource[],
  globalIndex: Map<string, number>
): string {
  const next = evidence.replace(/\[(\d+)\]/g, (_full, nStr: string) => {
    const n = Number(nStr);
    const local =
      n >= 1 && n <= supporting.length
        ? supporting[n - 1]
        : n > supporting.length && n <= supporting.length + contradicting.length
          ? contradicting[n - supporting.length - 1]
          : undefined;
    if (!local) return "";
    const mapped = globalIndex.get(local.url);
    return mapped != null ? `[${mapped}]` : "";
  });
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/**
 * 按判词顺序（与 normalizeReportCitations 的全局 first-seen 同序）构造全局
 * source index，把每段 evidence 的局部 marker 显式映射到全局编号。
 * 只取前 2 条有源判词（与旧行为同 cap）；返回的 texts 可直接拼进整句 conclusion，
 * 不得再被当成局部编号解读。
 */
export function buildScopedEvidence(value: unknown): {
  texts: string[];
  globalSources: ScopedSource[];
} {
  const texts: string[] = [];
  const globalSources: ScopedSource[] = [];
  const globalIndex = new Map<string, number>();
  if (!Array.isArray(value)) return { texts, globalSources };
  const scoped: Array<{ evidence: string; supporting: ScopedSource[]; contradicting: ScopedSource[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.sourcesRelatedOnly === true) continue;
    const supporting = collectBucketSources(rec.supportingSources);
    const contradicting = collectBucketSources(rec.contradictingSources);
    if (supporting.length === 0 && contradicting.length === 0) continue;
    scoped.push({ evidence: clipText(rec.evidence, 120), supporting, contradicting });
    for (const src of [...supporting, ...contradicting]) {
      if (!globalIndex.has(src.url)) {
        globalIndex.set(src.url, globalSources.length + 1);
        globalSources.push(src);
      }
    }
    if (scoped.length >= 2) break;
  }
  for (const entry of scoped) {
    const remapped = remapLocalMarkersToGlobal(
      entry.evidence,
      entry.supporting,
      entry.contradicting,
      globalIndex
    );
    if (remapped) texts.push(remapped);
  }
  return { texts, globalSources };
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
  "hard-verdict-with-not-applicable-boundary": "整句结论由有据命题支撑；不适用真假判断的表述未计入该判断，只作边界。",
  "hard-verdict-with-unverified-boundary": "整句结论由有据命题支撑；尚未查清的命题未计入该判断，只作边界。",
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
 * 最终结构化 repair 触发判断（Review 5128022550 Blocker 3 + 5128220693 Blocker 1 +
 * 5128449568 Blocker 1）。
 *
 * 只读最终结构状态，不读 conclusion/summary 文本：
 * - 任何模块把 draft 硬 verdict 降为弱 verdict（含 reportReviewer/finalize），
 *   都必须同步修复用户可见文本；
 * - draft 本来就是弱 verdict，但存在 not-applicable Claim、未解决 audit 缺口、
 *   或没有任何方向一致存活 sourced relation 时，同样重建（无法确认原文安全时优先重建）；
 * - 终态仍是合法硬 verdict（true/false）时，overall 判断可由有据 Claim 合法保留，
 *   但存在 not-applicable 原子、或 unresolved / 方向无据 / 缺判词的 checkable 原子时
 *   也必须重建：这些原子不参与该判断，只能作为「尚未查清 / 不适用」边界出现，
 *   不得被硬结论偷偷判掉。
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
  const unresolvedCheckable = listUnresolvedCheckableAtoms(verdicts);
  const hasSourced = verdicts.some((v) =>
    v && typeof v === "object"
      ? directionalBound((v as Record<string, unknown>).verdict, v as Record<string, unknown>)
      : false
  );

  const needed =
    weakened ||
    (isWeakVerdictType(final) && (hasNonVerifiable || hasGaps || !hasSourced)) ||
    (isHardVerdictType(final) && (hasNonVerifiable || unresolvedCheckable.length > 0));

  let rule = "weak-conclusion-audit-alignment";
  if (input.finalGate?.changed && input.finalGate.rule) {
    rule = input.finalGate.rule;
  } else if (input.earlyGate?.changed && input.earlyGate.rule && final !== draft) {
    rule = input.earlyGate.rule;
  } else if (input.mixedGuardDemoted && final !== draft) {
    rule = "mixed-guard-partial";
  } else if (weakened) {
    rule = "reviewer-demotion";
  } else if (isHardVerdictType(final) && hasNonVerifiable) {
    rule = "hard-verdict-with-not-applicable-boundary";
  } else if (isHardVerdictType(final) && unresolvedCheckable.length > 0) {
    rule = "hard-verdict-with-unverified-boundary";
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
  const unresolvedCheckable = listUnresolvedCheckableAtoms(input.subclaimVerdicts).slice(0, 2);
  const sourcedEvidence = listSourcedVerdictEvidence(input.subclaimVerdicts);
  const gaps = (input.auditUnresolvedGaps ?? []).filter((g) => typeof g === "string" && g.trim()).slice(0, 1);

  const parts = [lead, ...sourcedEvidence];
  for (const atom of nonVerifiable) {
    parts.push(`「${clipText(atom.text, 40)}」不适用真假判断，未计入真假结论。`);
  }
  for (const atom of unresolvedCheckable) {
    parts.push(`「${clipText(atom.text, 40)}」尚未查清，未计入该判断。`);
  }
  for (const gap of gaps) {
    parts.push(`仍缺关键依据：${clipText(gap, 120)}`);
  }
  report.conclusion = parts.join("").slice(0, 400);

  const summaryParts = [lead];
  if (nonVerifiable.length > 0) {
    summaryParts.push(`${nonVerifiable.length}条表述不适用真假判断，未计入结论。`);
  }
  if (unresolvedCheckable.length > 0) {
    summaryParts.push(`${unresolvedCheckable.length}条命题尚未查清，未计入结论。`);
  }
  if (gaps.length > 0) {
    summaryParts.push(`桥接依据仍未补齐：${clipText(gaps[0], 80)}`);
  }
  report.summaryForPublic = summaryParts.join("").slice(0, 200);
  report.recommendation = lead;

  const finding = GATE_RULE_FINDING[gate.rule ?? ""] ?? "整句结论已按证据层级收权。";
  const boundaryItems = [
    ...nonVerifiable.map((a) => `「${clipText(a.text, 40)}」不适用真假判断`),
    ...unresolvedCheckable.map((a) => `「${clipText(a.text, 40)}」尚未查清`),
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
