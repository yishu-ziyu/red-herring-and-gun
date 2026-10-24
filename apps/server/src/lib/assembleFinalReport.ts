/**
 * 合并、绑定各项判断，并将结果写入报告。
 */

import { claimAtomKey } from "../../../shared/claimAtomText.js";
import { mergeSubclaimVerdicts } from "./claimAtom/merge.js";
import type { ClaimReportItem, SubclaimVerdict } from "./claimAtom/types.js";
import {
  applyUnsearchedAtomVerdicts,
  bindAtomEvidenceToVerdicts,
  listAtomsForSearch,
  selectAtomsToSearch,
  type AtomSearchBundle,
} from "./atomSearch.js";
import { normalizeReportCitations } from "./citationBinding.js";
import { evidenceGateFor } from "./evidenceGate.js";

type AssembleFinalReportInput = {
  finalReport: Record<string, unknown>;
  /** rumor_detector step (or { output }) */
  rumorStep: { output?: Record<string, unknown> } | null | undefined;
  /** 当前生效的公开判词（CaseState.subclaimVerdicts） */
  verdicts: unknown;
  atomSearchBundle?: AtomSearchBundle | null;
};

/**
 * 服务端预交错展示 items：按 claimAtoms 原句全局序，用统一 claimAtomKey 匹配。
 */
function buildClaimItems(
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
 * 写入 finalReport。
 */
export function assembleFinalReport(input: AssembleFinalReportInput): void {
  const { finalReport, rumorStep, verdicts, atomSearchBundle } = input;
  if (!finalReport || typeof finalReport !== "object") return;

  const rumorOutput = rumorStep?.output ?? {};
  const listed = listAtomsForSearch(rumorOutput.claimAtoms, rumorOutput.claimAtomTypes);
  const searched =
    atomSearchBundle?.atomsSearched && atomSearchBundle.atomsSearched.length > 0
      ? atomSearchBundle.atomsSearched
      : selectAtomsToSearch(listed.verifiable, listed.typeByKey);
  const gate = atomSearchBundle ? evidenceGateFor(atomSearchBundle) : null;
  let merged = mergeSubclaimVerdicts(searched, verdicts, gate?.knownUrls ?? null);
  if (gate) {
    merged = bindAtomEvidenceToVerdicts(
      merged as Array<SubclaimVerdict & { [key: string]: unknown }>,
      gate,
    ) as SubclaimVerdict[];
  }
  merged = applyUnsearchedAtomVerdicts(merged, listed.verifiable, searched);

  finalReport.subclaimVerdicts = merged;
  finalReport.nonVerifiableAtoms = listed.nonVerifiable;

  if (atomSearchBundle) {
    finalReport.atomSearchMeta = {
      atomsSearched: atomSearchBundle.atomsSearched,
      source: "per-atom-search",
    };
  }

  const stanceClaimType = rumorOutput.stanceClaimType;
  if (stanceClaimType && typeof stanceClaimType === "object") {
    finalReport.stanceClaimType = stanceClaimType;
  }

  finalReport.claimItems = buildClaimItems(rumorOutput.claimAtoms, merged, listed.nonVerifiable);

  // Align [n] with final source arrays (evidenceChain + claimItems); 探活按整理过的来源数组剔死链。
  normalizeReportCitations(finalReport);
}
