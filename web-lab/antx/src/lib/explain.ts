// 整句结论怎么从各点推出来：读报告里的判定记录（shared/domain/decision.ts），按 verdict.ts 的规则写一句大白话。
import { readVerdictRecord } from "@shared/domain/decision.ts";
import { LABEL_TEXT, type LabelKey } from "@shared/domain/labels.ts";
import type { PartRole, PartStanding, VerdictRule } from "@shared/domain/verdict.ts";
import { claimAtomKey } from "@shared/claimAtomText.ts";
import type { InvestigationClaim } from "./types.ts";

const RULES: readonly VerdictRule[] = [
  "main-refuted", "parallel-true-and-false", "main-unresolved", "main-conflicting", "main-partial", "premise-refuted",
  "premise-refuted-nothing-true", "premise-unresolved", "premise-partial", "background-refuted", "all-supported", "no-checkable-claim",
];

export const ROLE_TEXT: Record<PartRole, string> = { main: "主要说法", premise: "前提", background: "背景" };

export type PartInfo = { no: number; role: PartRole; standing: PartStanding };

/** 每一点在判定记录里的角色和证据状态，按显示顺序编号。 */
export function partsByClaim(report: Record<string, unknown> | null, claims: readonly InvestigationClaim[]): Map<string, PartInfo> {
  const record = readVerdictRecord(report);
  const out = new Map<string, PartInfo>();
  if (!record) return out;
  claims.forEach((claim, index) => {
    const key = claimAtomKey(claim.text);
    const part = record.parts.find((p) => p.key === key) ?? record.parts.find((p) => p.text.includes(claim.text) || claim.text.includes(p.text));
    if (part) out.set(claim.id, { no: index + 1, role: part.role, standing: part.standing });
  });
  return out;
}

function ruleOf(report: Record<string, unknown> | null): VerdictRule | null {
  const raw = report && typeof report === "object" ? (report._verdictDecision as Record<string, unknown> | undefined)?.rule : undefined;
  return RULES.includes(raw as VerdictRule) ? (raw as VerdictRule) : null;
}

const nums = (list: PartInfo[]) => list.map((p) => `第 ${p.no} 点`).join("、");

/** 一句话：哪几点怎样，所以整句是什么标签。读不到判定记录时返回空串。 */
export function explainVerdict(report: Record<string, unknown> | null, claims: readonly InvestigationClaim[], label: LabelKey): string {
  const rule = ruleOf(report);
  if (!rule) return "";
  const parts = [...partsByClaim(report, claims).values()];
  const pick = (role: PartRole | null, standing: PartStanding | PartStanding[]) =>
    parts.filter((p) => (role === null || p.role === role) && ([] as PartStanding[]).concat(standing).includes(p.standing));
  const mains = parts.filter((p) => p.role === "main");
  const result = `所以整句判为「${LABEL_TEXT[label]}」。`;
  const list = (items: PartInfo[], fallback: string) => (items.length ? nums(items) : fallback);
  switch (rule) {
    case "all-supported":
      return `每一点都找到了支持的材料，没有哪一点被反驳，${result}`;
    case "background-refuted":
      return `主要说法有材料支持，只有背景细节（${list(pick("background", "refuted"), "背景")}）被材料反驳，不影响主干，${result}`;
    case "main-partial":
      return `主要说法（${list(pick("main", "partial"), "主要那一点")}）只对了一部分，${result}`;
    case "premise-partial":
      return `主要说法有材料支持，但它要成立所依赖的前提（${list(pick("premise", "partial"), "前提")}）只对了一部分，${result}`;
    case "parallel-true-and-false":
      return `这句话里并列着几个主要说法：${list(pick("main", "supported"), "有的")}有材料支持，${list(pick("main", "refuted"), "有的")}被材料反驳，${result}`;
    case "premise-refuted":
      return `主要说法要成立，得先有${list(pick("premise", "refuted"), "它的前提")}，而这一点被材料反驳了；另有${list(pick(null, "supported"), "别的点")}有材料支持，${result}`;
    case "premise-refuted-nothing-true":
      return `主要说法要成立，得先有${list(pick("premise", "refuted"), "它的前提")}，而这一点被材料反驳了，也没有哪一点被证实，${result}`;
    case "main-refuted":
      return `主要说法（${list(pick("main", "refuted"), mains.length ? nums(mains) : "主要那一点")}）被材料反驳了，其他点即使属实也救不回来，${result}`;
    case "main-unresolved":
      return `主要说法（${list(pick("main", "unresolved"), "主要那一点")}）这次找到的材料既不能证实也不能推翻，${result}`;
    case "premise-unresolved":
      return `主要说法有材料支持，但它依赖的前提（${list(pick("premise", ["unresolved", "conflicting"]), "前提")}）还查不清，${result}`;
    case "main-conflicting":
      return `关于主要说法（${list(pick("main", "conflicting"), "主要那一点")}），权威来源之间说法互相矛盾，${result}`;
    case "no-checkable-claim":
      return `这句话里没有能拿材料核对的事实，${result}`;
  }
}
