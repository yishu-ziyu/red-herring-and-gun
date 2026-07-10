/**
 * inferenceLicense.ts — 报告级推理许可聚合 (PR-1)
 *
 * 把 GradedEvidence.inferenceAllowed / inferenceBlocked (per-grade) 聚合
 * 为报告级 canSay / cannotSay 清单。覆盖 PRD v2 PR-1。
 */

import type {
  GradedEvidence,
  InferenceLicense,
  InferenceLicenseItem,
  Subclaim,
} from "./schemas";

const MAX_ITEMS = 12;

function normalize(s: string): string {
  // 轻量规范化:strip 末尾标点 + 合并空白 + lower-case trim
  // 保留中文标点以避免过度归一
  return s.replace(/\s+/g, " ").trim();
}

function dedup(items: InferenceLicenseItem[]): InferenceLicenseItem[] {
  const seen = new Set<string>();
  const out: InferenceLicenseItem[] = [];
  for (const item of items) {
    const key = normalize(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function asymmetryHeuristic(
  grades: GradedEvidence[],
): "high" | "medium" | "low" {
  // Empty input → low (peer spec)
  if (grades.length === 0) return "low";

  const safeAllowed = (g: GradedEvidence) => g.inferenceAllowed ?? [];
  const safeBlocked = (g: GradedEvidence) => g.inferenceBlocked ?? [];

  const gradesWithAllowed = grades.filter(
    (g) => safeAllowed(g).length > 0,
  ).length;
  const gradesWithBlocked = grades.filter(
    (g) => safeBlocked(g).length > 0,
  ).length;

  const anyAsymmetric = grades.some(
    (g) => safeBlocked(g).length > safeAllowed(g).length,
  );
  if (anyAsymmetric) return "low";

  if (gradesWithAllowed >= 3 && gradesWithBlocked === 0) return "high";
  return "medium";
}

export function aggregateInferences(
  grades: GradedEvidence[],
  subclaims?: Subclaim[],
): InferenceLicense {
  // 收集 allowed (defensive: missing fields treated as empty)
  const allowedRaw: InferenceLicenseItem[] = [];
  for (const grade of grades) {
    const allowed = grade.inferenceAllowed ?? [];
    for (const text of allowed) {
      allowedRaw.push({
        text,
        supportingSubclaims: [grade.subclaimId],
        strongestEvidence: grade.candidateId,
      });
    }
  }
  // 收集 blocked
  const blockedRaw: InferenceLicenseItem[] = [];
  for (const grade of grades) {
    const blocked = grade.inferenceBlocked ?? [];
    for (const text of blocked) {
      blockedRaw.push({
        text,
        supportingSubclaims: [grade.subclaimId],
        strongestEvidence: grade.candidateId,
      });
    }
  }

  const allowed = dedup(allowedRaw).slice(0, MAX_ITEMS);
  const blocked = dedup(blockedRaw).slice(0, MAX_ITEMS);

  // 子命题覆盖率:有至少一条 allowed 落在该 subclaimId 上的子命题
  const subclaimIdsWithAllowed = new Set<string>();
  for (const grade of grades) {
    if ((grade.inferenceAllowed ?? []).length > 0) {
      subclaimIdsWithAllowed.add(grade.subclaimId);
    }
  }
  const totalSubclaims = subclaims?.length ?? grades.length;

  return {
    allowed,
    blocked,
    confidence: asymmetryHeuristic(grades),
    coverage: {
      withAllowed: subclaimIdsWithAllowed.size,
      totalSubclaims,
    },
    source: "graded_evidence",
  };
}