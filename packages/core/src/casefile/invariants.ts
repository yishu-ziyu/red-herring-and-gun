import type { Case } from "./schema.js";

function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^/\s?#]+/i.test(url);
}

export function assertInvariants(c: Case): void {
  const violations: string[] = [];
  const claimIds = new Set<string>();
  const seenClaimIds = new Set<string>();
  for (const claim of c.claims) {
    if (seenClaimIds.has(claim.id)) violations.push(`duplicate claim id ${claim.id}`);
    seenClaimIds.add(claim.id);
    claimIds.add(claim.id);
  }
  for (const dropped of c.droppedClaims) {
    if (seenClaimIds.has(dropped.id)) violations.push(`duplicate claim id ${dropped.id} in droppedClaims`);
    seenClaimIds.add(dropped.id);
  }
  const evidenceById = new Map(c.evidence.map((item) => [item.id, item]));
  const stanceById = new Map(c.stances.map((item) => [item.id, item]));

  for (const item of c.evidence) {
    if (!isHttpUrl(item.url)) {
      violations.push(`evidence ${item.id} url is not http(s): ${item.url}`);
    }
  }

  for (const stance of c.stances) {
    if (!claimIds.has(stance.claimId)) {
      violations.push(`stance ${stance.id} claimId ${stance.claimId} does not resolve`);
    }
    if (!evidenceById.has(stance.evidenceId)) {
      violations.push(`stance ${stance.id} evidenceId ${stance.evidenceId} does not resolve`);
    }
  }

  for (const verdict of c.verdicts) {
    if (verdict.verdict !== "true" && verdict.verdict !== "false" && verdict.verdict !== "partial") {
      continue;
    }
    if (verdict.basis.length === 0) {
      violations.push(`verdict ${verdict.claimId} is ${verdict.verdict} but basis is empty`);
    }
    for (const stanceId of verdict.basis) {
      const stance = stanceById.get(stanceId);
      if (!stance) {
        violations.push(`verdict ${verdict.claimId} basis ${stanceId} does not resolve`);
        continue;
      }
      const evidence = evidenceById.get(stance.evidenceId);
      if (!evidence) {
        violations.push(
          `verdict ${verdict.claimId} basis ${stanceId} evidence ${stance.evidenceId} does not resolve`,
        );
        continue;
      }
      if (evidence.reachable === false) {
        violations.push(
          `verdict ${verdict.claimId} basis ${stanceId} evidence ${evidence.id} is unreachable`,
        );
      }
    }
  }

  for (const edge of c.cites) {
    if (edge.from === edge.to) {
      violations.push(`cite ${edge.from}->${edge.to} is a self-loop`);
    }
    if (!evidenceById.has(edge.from)) {
      violations.push(`cite ${edge.from}->${edge.to} missing from`);
    }
    if (!evidenceById.has(edge.to)) {
      violations.push(`cite ${edge.from}->${edge.to} missing to`);
    }
  }

  const seenPivotIds = new Set<string>();
  for (const pivot of c.frontier) {
    if (seenPivotIds.has(pivot.id)) {
      violations.push(`duplicate frontier pivot id ${pivot.id}`);
    }
    seenPivotIds.add(pivot.id);
  }

  if (c.report) {
    for (const citation of c.report.citations) {
      if (!evidenceById.has(citation.evidenceId)) {
        violations.push(
          `report citation [${citation.n}] evidenceId ${citation.evidenceId} does not resolve`,
        );
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
}
