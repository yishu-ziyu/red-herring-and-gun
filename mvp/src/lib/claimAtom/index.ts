/**
 * Client re-export of claim-atom domain (SSOT on server).
 * Prefer this path in frontend code; do not reimplement merge/key/split.
 */
export {
  claimAtomKey,
  compactStrings,
  compactText,
  mergeSubclaimVerdicts,
  splitVerifiableAtoms,
  prefilterClaimAtoms,
  parseSelfProofResults,
  applySelfProof,
  runClaimAtomSelfProof,
  SELF_PROOF_SYSTEM_PROMPT,
  selfProofSchema,
  buildSelfProofUserContent,
  type ClaimAtomDropped,
  type ClaimAtomType,
  type ClaimReportItem,
  type NonVerifiableAtom,
  type SubclaimVerdict,
  type VerdictSource,
  type SelfProofModelCall,
} from "../../../server/src/lib/claimAtom/index";
