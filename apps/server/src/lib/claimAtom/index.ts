/**
 * Claim-atom domain module.
 * Depth: key / split / merge / prefilter / force-checkable behind one seam.
 * Production and client twins must import from here — no private copies.
 */

export type {
  ClaimAtomDropped,
  ClaimAtomType,
  ClaimReportItem,
  NonVerifiableAtom,
  SubclaimVerdict,
  VerdictSource,
} from "./types.js";

export { claimAtomKey, compactStrings, compactText, MAX_CLAIM_ATOMS } from "./text.js";
export { alignFalseEvidenceBuckets, mergeSubclaimVerdicts, splitVerifiableAtoms } from "./merge.js";
export { forceCheckableAtomTypes, looksLikeCirculatingClaim } from "./forceCheckable.js";
export { collapseShortSingleClaim, dropUntraceableAtoms, ensureStanceAtom, keepOriginalWording, markStanceAtoms } from "./roles.js";
export { collapseNarrativeAtoms, ensureLeapAtoms, extractLeapAtoms, retainAtomTypes } from "./textbookAtoms.js";
export { prefilterClaimAtoms } from "./prefilter.js";
