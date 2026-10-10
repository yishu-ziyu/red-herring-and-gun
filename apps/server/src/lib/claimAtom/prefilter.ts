import type { ClaimAtomDropped } from "./types.js";
import { claimAtomKey, MAX_CLAIM_ATOMS } from "./text.js";

export function prefilterClaimAtoms(
  claim: string,
  rawAtoms: unknown
): { atoms: string[]; dropped: ClaimAtomDropped[] } {
  void claim;
  const atoms: string[] = [];
  const dropped: ClaimAtomDropped[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawAtoms)) {
    for (const item of rawAtoms) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const normKey = claimAtomKey(trimmed);
      if (seen.has(normKey)) {
        dropped.push({ text: item, reason: "duplicate" });
        continue;
      }
      seen.add(normKey);
      atoms.push(normKey);
    }
  }
  // 检索预算由 selectAtomsToSearch 截 6；这里只挡住异常长表。
  return { atoms: atoms.slice(0, MAX_CLAIM_ATOMS), dropped };
}
