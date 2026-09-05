/**
 * Investigation Snapshot 结构不变量（对应 casefile/invariants 的角色）。
 * 引用必须可解析；supported/refuted 必须有对应证据位；完成态不得残留 unassessed。
 * builder 输出与生产接线都应通过；测试与 GET 重建路径用它做守门。
 */
import type { InvestigationSnapshotV1 } from "./schema.js";

export function assertInvestigationInvariants(snapshot: InvestigationSnapshotV1): void {
  const violations: string[] = [];
  const claimIds = new Set(snapshot.claims.map((c) => c.id));
  const sourceIds = new Set(snapshot.sources.map((s) => s.id));

  for (const claim of snapshot.claims) {
    const linkSourceIds = new Set<string>();
    for (const link of claim.evidence) {
      if (!sourceIds.has(link.sourceId)) {
        violations.push(`claim ${claim.id} evidence sourceId ${link.sourceId} does not resolve`);
      }
      linkSourceIds.add(link.sourceId);
      if (snapshot.phase === "complete" && link.role === "unassessed") {
        violations.push(`claim ${claim.id} keeps unassessed link at phase=complete`);
      }
    }
    for (const gap of claim.gaps) {
      if (gap.claimId !== claim.id) {
        violations.push(`claim ${claim.id} gap ${gap.id} claimId ${gap.claimId} mismatch`);
      }
      for (const sid of gap.resolvedBySourceIds ?? []) {
        if (!sourceIds.has(sid)) {
          violations.push(`gap ${gap.id} resolvedBySourceIds ${sid} does not resolve`);
        }
      }
    }
    if (claim.judgment === "supported" && !claim.evidence.some((l) => l.role === "support")) {
      violations.push(`claim ${claim.id} is supported but has no support link`);
    }
    if (claim.judgment === "refuted" && !claim.evidence.some((l) => l.role === "contradict")) {
      violations.push(`claim ${claim.id} is refuted but has no contradict link`);
    }
    if (claim.checkability === "not-applicable" && claim.judgment !== "not-applicable") {
      violations.push(`claim ${claim.id} is not-applicable but judgment is ${claim.judgment}`);
    }
    void linkSourceIds;
  }

  for (const conflict of snapshot.conflicts) {
    if (!claimIds.has(conflict.claimId)) {
      violations.push(`conflict ${conflict.id} claimId ${conflict.claimId} does not resolve`);
    }
    if (conflict.reasonStatus === "unknown" && conflict.reason !== undefined) {
      violations.push(`conflict ${conflict.id} reasonStatus=unknown must not carry reason`);
    }
    for (const side of conflict.sides) {
      for (const sid of side.sourceIds) {
        if (!sourceIds.has(sid)) {
          violations.push(`conflict ${conflict.id} side ${side.position} sourceId ${sid} does not resolve`);
        }
      }
    }
  }

  const conclusion = snapshot.conclusion;
  if (conclusion) {
    for (const cid of conclusion.claimIds) {
      if (!claimIds.has(cid)) violations.push(`conclusion claimId ${cid} does not resolve`);
    }
    for (const sid of conclusion.sourceIds) {
      if (!sourceIds.has(sid)) violations.push(`conclusion sourceId ${sid} does not resolve`);
    }
  }

  if (snapshot.phase === "complete" && !snapshot.conclusion) {
    // 完成态允许没有 conclusion 的唯一情形：报告缺 conclusion 文本（保守留空）。
    // 不作为违规，由生产测试单独断言正常路径必有 conclusion。
  }

  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
}
