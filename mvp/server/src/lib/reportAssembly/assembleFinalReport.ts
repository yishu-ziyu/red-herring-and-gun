/**
 * Final Report Assembly — one deep module for exclusion + merge + bind + claimItems.
 * Interface is the test surface: assembleFinalReport(...) mutates/returns report fields.
 */

import {
  claimAtomKey,
  mergeSubclaimVerdicts,
  splitVerifiableAtoms,
  type ClaimReportItem,
  type SubclaimVerdict,
} from "../claimAtom/index.js";
import {
  bindAtomEvidenceToVerdicts,
  type AtomSearchBundle,
} from "../atomSearch.js";

export type AssembleFinalReportInput = {
  finalReport: Record<string, unknown>;
  /** rumor_detector step (or { output }) */
  rumorStep: { output?: Record<string, unknown> } | null | undefined;
  /** Prefer report_composer verdicts; fall back to fact_checker */
  verdicts: unknown;
  searchSources?: Array<{ url?: unknown }>;
  atomSearchBundle?: AtomSearchBundle | null;
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
  if (!finalReport || typeof finalReport !== "object") {
    return {
      subclaimVerdicts: [],
      nonVerifiableAtoms: [],
      claimItems: [],
    };
  }

  const rumorOutput = rumorStep?.output ?? {};
  const split = splitVerifiableAtoms(rumorOutput.claimAtoms, rumorOutput.claimAtomTypes);
  let merged = mergeSubclaimVerdicts(split.verifiable, verdicts, searchSources);
  if (atomSearchBundle?.byAtomKey) {
    merged = bindAtomEvidenceToVerdicts(
      merged as Array<SubclaimVerdict & { [key: string]: unknown }>,
      atomSearchBundle.byAtomKey,
      claimAtomKey
    ) as SubclaimVerdict[];
  }

  finalReport.subclaimVerdicts = merged;
  finalReport.nonVerifiableAtoms = split.nonVerifiable;

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
    split.nonVerifiable
  );
  finalReport.claimItems = claimItems;

  return {
    subclaimVerdicts: merged,
    nonVerifiableAtoms: split.nonVerifiable,
    claimItems,
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
