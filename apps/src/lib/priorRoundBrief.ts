/**
 * 访客追问：上一轮对用户可见的材料（命题、判断、可点开出处、结论）。
 * 不带内部拼接指令、finding / limitation、命题 id、provenance。
 */
import { displayFollowUpClaim } from "./composeFollowUpClaim";
import type { InvestigationSnapshotV1 } from "./investigation";

export type VisiblePriorEvidence = {
  url: string;
  title: string;
  excerpt: string;
  role: "support" | "contradict";
};

export type VisiblePriorClaim = {
  text: string;
  judgment: "supported" | "refuted" | "mixed";
  evidence: VisiblePriorEvidence[];
};

export type VisiblePriorRound = {
  originalClaim: string;
  conclusion: string;
  claims: VisiblePriorClaim[];
};

const HTTP = /^https?:\/\//i;
const CLAIM_CAP = 8;
const EVIDENCE_CAP = 8;

function clip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function visiblePriorRoundFromSnapshot(
  snapshot: InvestigationSnapshotV1 | null | undefined
): VisiblePriorRound | null {
  if (!snapshot) return null;
  const claims: VisiblePriorClaim[] = [];
  for (const claim of snapshot.claims) {
    if (claim.checkability !== "checkable") continue;
    const judgment = claim.judgment;
    if (judgment !== "supported" && judgment !== "refuted" && judgment !== "mixed") continue;
    const evidence: VisiblePriorEvidence[] = [];
    const seenUrl = new Set<string>();
    for (const link of claim.evidence) {
      if (link.role !== "support" && link.role !== "contradict") continue;
      const source = snapshot.sources.find((item) => item.id === link.sourceId);
      if (!source || !HTTP.test(source.url) || seenUrl.has(source.url)) continue;
      seenUrl.add(source.url);
      evidence.push({
        url: source.url,
        title: clip(source.title || "", 200),
        excerpt: clip(source.excerpt || "", 320),
        role: link.role,
      });
      if (evidence.length >= EVIDENCE_CAP) break;
    }
    if (evidence.length === 0) continue;
    claims.push({ text: clip(claim.text, 240), judgment, evidence });
    if (claims.length >= CLAIM_CAP) break;
  }
  if (claims.length === 0) return null;
  return {
    originalClaim: clip(displayFollowUpClaim(snapshot.originalClaim), 500),
    conclusion: clip(snapshot.conclusion?.directAnswer ?? "", 800),
    claims,
  };
}
