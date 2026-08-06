/**
 * Claim-atom domain module.
 * Depth: key / split / merge / self-proof behind one seam.
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

export { claimAtomKey, compactStrings, compactText } from "./text.js";
export { mergeSubclaimVerdicts, splitVerifiableAtoms } from "./merge.js";
export {
  SELF_PROOF_SYSTEM_PROMPT,
  applySelfProof,
  buildSelfProofUserContent,
  parseSelfProofResults,
  prefilterClaimAtoms,
  runClaimAtomSelfProof,
  selfProofSchema,
  type SelfProofModelCall,
} from "./selfProof.js";
