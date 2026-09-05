/**
 * Final Report Assembly — one deep module for exclusion + merge + bind + claimItems.
 * Interface is the test surface: assembleFinalReport(...) mutates/returns report fields.
 */

import {
  claimAtomKey,
  mergeSubclaimVerdicts,
  type ClaimReportItem,
  type SubclaimVerdict,
} from "../claimAtom/index.js";
import {
  applyUnsearchedAtomVerdicts,
  bindAtomEvidenceToVerdicts,
  listAtomsForSearch,
  selectAtomsToSearch,
  type AtomSearchBundle,
} from "../atomSearch.js";
import { normalizeReportCitations } from "../citationBinding.js";
import { applyPublicCopy } from "../publicCopy.js";
import { applyImageOriginToReport, type ImageOriginResult } from "../imageOrigin/index.js";

export const FACE_VERDICT: Record<string, string> = {
  true: "能信",
  false: "不能信",
  mixed_misleading: "有真有假",
  mixed: "有真有假",
  partial: "部分成立",
  unverified: "还查不清",
};

export function faceVerdictFor(verdictType: unknown): string {
  const key = typeof verdictType === "string" ? verdictType.trim() : "";
  return FACE_VERDICT[key] || "还查不清";
}

/** 肯定为真侧的原子判词（exaggerated 有真实内核，计入真侧）。 */
const TRUEISH_VERDICTS = new Set(["true", "partial", "mostly_true", "exaggerated"]);

type DeriveVerdictInput = {
  verdict?: unknown;
  supportingSources?: unknown;
  contradictingSources?: unknown;
  sourcesRelatedOnly?: unknown;
};

function sourceHasHttpUrl(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return /^https?:\/\//i.test(String((value as { url?: unknown }).url || "").trim());
}

/** 有据：非 related-only，且支撑或反证里有可点开的 http(s) URL。 */
function hasBoundHttpUrl(v: DeriveVerdictInput): boolean {
  if (v?.sourcesRelatedOnly === true) return false;
  const supporting = Array.isArray(v?.supportingSources) ? v.supportingSources : [];
  const contradicting = Array.isArray(v?.contradictingSources) ? v.contradictingSources : [];
  return supporting.some(sourceHasHttpUrl) || contradicting.some(sourceHasHttpUrl);
}

function isSourcedTrueishVerdict(v: DeriveVerdictInput): boolean {
  const verdict = String(v?.verdict ?? "").trim().toLowerCase();
  return TRUEISH_VERDICTS.has(verdict) && hasBoundHttpUrl(v);
}

function isSourcedFalseVerdict(v: DeriveVerdictInput): boolean {
  return String(v?.verdict ?? "").trim().toLowerCase() === "false" && hasBoundHttpUrl(v);
}

/**
 * 原子级整句推导（确定性收束）——「分截判决」的收束端。
 * fact_checker 的整体 factCheckResult 是单 LLM 字段，会把「真假交织」漂成 false；
 * 原子判词 + 绑定证据才是依据：
 * - 有据之真 + 有据之假 → partial（mixed_misleading 的公式载体，救回真的部分）；
 * - 单独有据之假 → false（无据之假不撑整句；短谣 boundTiny 不在本函数）；
 * - 全 true 且至少一条有据 → true（无据之真不升整句）；
 * - 仅 partial/exaggerated → partial；无肯定判词 → null（保留 LLM 整体字段）。
 */
export function deriveOverallVerdict(
  verdicts: Array<DeriveVerdictInput>
): "true" | "false" | "partial" | null {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return null;
  const norms = verdicts.map((v) => String(v?.verdict ?? "").trim().toLowerCase());
  const hasSourcedFalse = verdicts.some((v) => isSourcedFalseVerdict(v));
  const hasSourcedTrueish = verdicts.some((v) => isSourcedTrueishVerdict(v));
  if (hasSourcedFalse && hasSourcedTrueish) return "partial";
  if (hasSourcedFalse) return "false";
  const affirmative = norms.filter((n) => TRUEISH_VERDICTS.has(n));
  if (affirmative.length === 0) return null;
  if (affirmative.every((n) => n === "true")) return hasSourcedTrueish ? "true" : null;
  return "partial";
}

export type AssembleFinalReportInput = {
  finalReport: Record<string, unknown>;
  /** rumor_detector step (or { output }) */
  rumorStep: { output?: Record<string, unknown> } | null | undefined;
  /** Prefer report_composer verdicts; fall back to fact_checker */
  verdicts: unknown;
  searchSources?: Array<{ url?: unknown }>;
  atomSearchBundle?: AtomSearchBundle | null;
  /** Screenshot origin from reverse-image; OCR/text hits are not this field. */
  imageOrigin?: ImageOriginResult;
};

export type AssembleFinalReportResult = {
  subclaimVerdicts: SubclaimVerdict[];
  nonVerifiableAtoms: Array<{ text: string; type: string }>;
  claimItems: ClaimReportItem[];
  stanceClaimType?: unknown;
  atomSearchMeta?: { atomsSearched: string[]; source: string };
};

/**
 * 服务端预交错展示 items：按 claimAtoms 原句全局序，用统一 claimAtomKey 匹配。
 */
export function buildClaimItems(
  claimAtoms: unknown,
  verdicts: Array<{ claimAtom: string }>,
  nonVerifiable: Array<{ text: string; type: string }>
): ClaimReportItem[] {
  const verdictByKey = new Map<string, Array<{ claimAtom: string }>[number]>();
  for (const v of verdicts) {
    if (v && typeof v.claimAtom === "string") verdictByKey.set(claimAtomKey(v.claimAtom), v);
  }
  const stanceByKey = new Map<string, Array<{ text: string; type: string }>[number]>();
  for (const n of nonVerifiable) {
    if (n && typeof n.text === "string") stanceByKey.set(claimAtomKey(n.text), n);
  }
  const items: ClaimReportItem[] = [];
  if (!Array.isArray(claimAtoms)) return items;
  for (const item of claimAtoms) {
    if (typeof item !== "string") continue;
    const key = claimAtomKey(item);
    const v = verdictByKey.get(key);
    if (v) {
      items.push({ text: key, verifiable: true, type: "", verdict: v as Record<string, unknown> });
      continue;
    }
    const n = stanceByKey.get(key);
    if (n) {
      items.push({ text: n.text, verifiable: false, type: n.type });
    }
  }
  return items;
}

/**
 * 权威落库闸门：subclaimVerdicts 只含可核查；立场原子进 nonVerifiableAtoms；claimItems 预交错。
 * 写入 finalReport 并返回结构化结果。
 */
export function assembleFinalReport(input: AssembleFinalReportInput): AssembleFinalReportResult {
  const { finalReport, rumorStep, verdicts, searchSources, atomSearchBundle } = input;
  const imageOrigin = input.imageOrigin ?? atomSearchBundle?.imageOrigin;
  if (!finalReport || typeof finalReport !== "object") {
    return {
      subclaimVerdicts: [],
      nonVerifiableAtoms: [],
      claimItems: [],
    };
  }

  const rumorOutput = rumorStep?.output ?? {};
  const listed = listAtomsForSearch(rumorOutput.claimAtoms, rumorOutput.claimAtomTypes);
  const searched =
    atomSearchBundle?.atomsSearched && atomSearchBundle.atomsSearched.length > 0
      ? atomSearchBundle.atomsSearched
      : selectAtomsToSearch(listed.verifiable, listed.typeByKey);
  let merged = mergeSubclaimVerdicts(searched, verdicts, searchSources);
  if (atomSearchBundle?.byAtomKey) {
    merged = bindAtomEvidenceToVerdicts(
      merged as Array<SubclaimVerdict & { [key: string]: unknown }>,
      atomSearchBundle.byAtomKey,
      claimAtomKey
    ) as SubclaimVerdict[];
  }
  merged = applyUnsearchedAtomVerdicts(merged, listed.verifiable, searched);

  finalReport.subclaimVerdicts = merged;
  finalReport.nonVerifiableAtoms = listed.nonVerifiable;

  let atomSearchMeta: AssembleFinalReportResult["atomSearchMeta"];
  if (atomSearchBundle) {
    atomSearchMeta = {
      atomsSearched: atomSearchBundle.atomsSearched,
      source: "per-atom-search",
    };
    finalReport.atomSearchMeta = atomSearchMeta;
  }

  const stanceClaimType = rumorOutput.stanceClaimType;
  if (stanceClaimType && typeof stanceClaimType === "object") {
    finalReport.stanceClaimType = stanceClaimType;
  }

  const claimItems = buildClaimItems(
    rumorOutput.claimAtoms,
    merged,
    listed.nonVerifiable
  );
  finalReport.claimItems = claimItems;
  finalReport.faceVerdict = faceVerdictFor(finalReport.verdictType);

  // Align [n] with final source arrays (conclusion + evidenceChain + claimItems).
  normalizeReportCitations(finalReport);
  applyPublicCopy(finalReport);
  if (imageOrigin) applyImageOriginToReport(finalReport, imageOrigin);
  merged = Array.isArray(finalReport.subclaimVerdicts)
    ? (finalReport.subclaimVerdicts as SubclaimVerdict[])
    : merged;
  const claimItemsSynced = Array.isArray(finalReport.claimItems)
    ? (finalReport.claimItems as ClaimReportItem[])
    : claimItems;

  return {
    subclaimVerdicts: merged,
    nonVerifiableAtoms: listed.nonVerifiable,
    claimItems: claimItemsSynced,
    stanceClaimType,
    atomSearchMeta,
  };
}

/** @deprecated alias — prefer assembleFinalReport */
export function applyExclusionLayerToReport(
  finalReport: Record<string, unknown>,
  rumorStep: any,
  verdicts: unknown,
  searchSources?: Array<{ url?: unknown }>,
  atomSearchBundle?: AtomSearchBundle | null
): void {
  assembleFinalReport({
    finalReport,
    rumorStep,
    verdicts,
    searchSources,
    atomSearchBundle,
  });
}
