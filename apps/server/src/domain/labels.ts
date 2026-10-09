/**
 * 判断标签：每一截和整句都只用这 9 个词（#140，2026-10-09 用户确认，docs/PRODUCT.md「判断怎么表达」）。
 * 整句标签由 verdict.ts 的规则表推出，这里只做规则 → 标签的对应。服务端、结果页、分享页共用这一份。
 */
import type { PartRole, PartStanding, VerdictRule } from "./verdict.js";

export const LABEL_KEYS = [
  "true",
  "mostly-true",
  "partly-true",
  "exaggerated",
  "false",
  "unresolved",
  "uncheckable",
  "disputed",
  "opinion",
] as const;
export type LabelKey = (typeof LABEL_KEYS)[number];

export const LABEL_TEXT: Record<LabelKey, string> = {
  true: "属实",
  "mostly-true": "基本属实",
  "partly-true": "部分属实",
  exaggerated: "夸大了",
  false: "不属实",
  unresolved: "还查不清",
  uncheckable: "无法核对",
  disputed: "说法不一",
  opinion: "是观点，不分对错",
};

/** 颜色只做辅助：绿 / 黄 / 红 / 灰。 */
export const LABEL_TONE: Record<LabelKey, "positive" | "mixed" | "negative" | "muted"> = {
  true: "positive",
  "mostly-true": "positive",
  "partly-true": "mixed",
  exaggerated: "mixed",
  false: "negative",
  unresolved: "muted",
  uncheckable: "muted",
  disputed: "muted",
  opinion: "muted",
};

export function isLabelKey(value: unknown): value is LabelKey {
  return typeof value === "string" && (LABEL_KEYS as readonly string[]).includes(value);
}

type Judgment = "supported" | "refuted" | "mixed" | "disputed" | "unresolved" | "not-applicable";

/** 改版前存下的快照只有 judgment：照这张表推出标签，不显示理由。 */
export function judgmentToLabel(judgment: Judgment): LabelKey {
  switch (judgment) {
    case "supported":
      return "true";
    case "refuted":
      return "false";
    case "mixed":
      return "partly-true";
    case "disputed":
      return "disputed";
    case "not-applicable":
      return "opinion";
    default:
      return "unresolved";
  }
}

/** 快照里的 judgment 字段跟着标签走，保证两者不互相矛盾。 */
export function labelToJudgment(label: LabelKey): Judgment {
  switch (label) {
    case "true":
    case "mostly-true":
      return "supported";
    case "false":
      return "refuted";
    case "partly-true":
    case "exaggerated":
      return "mixed";
    case "disputed":
      return "disputed";
    case "opinion":
      return "not-applicable";
    default:
      return "unresolved";
  }
}

/** 模型给的标签 → 流水线内部沿用的判词（merge / 引用绑定 / 质询都读它）。 */
export function verdictForLabel(label: LabelKey): "true" | "false" | "partial" | "exaggerated" | "disputed" | "unverified" {
  switch (label) {
    case "true":
    case "mostly-true":
      return "true";
    case "partly-true":
      return "partial";
    case "exaggerated":
      return "exaggerated";
    case "false":
      return "false";
    case "disputed":
      return "disputed";
    default:
      return "unverified";
  }
}

/** 旧判词（没有 label 的记录）→ 标签。 */
export function labelForVerdict(verdict: string): LabelKey {
  switch (verdict) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "partial":
      return "partly-true";
    case "exaggerated":
      return "exaggerated";
    case "disputed":
      return "disputed";
    default:
      return "unresolved";
  }
}

/**
 * 一截的标签：证据状态（规则表用的那个）定大类，模型标签只在同一大类里细分
 * （属实 / 基本属实，部分属实 / 夸大了，还查不清 / 无法核对）。所以标签和整句结论读的是同一个状态。
 */
export function partLabelFor(standing: PartStanding, modelLabel: LabelKey | undefined): LabelKey {
  switch (standing) {
    case "supported":
      return modelLabel === "mostly-true" || modelLabel === "partly-true" ? "mostly-true" : "true";
    case "refuted":
      return "false";
    case "partial":
      return modelLabel === "exaggerated" ? "exaggerated" : "partly-true";
    case "conflicting":
      return "disputed";
    default:
      return modelLabel === "uncheckable" ? "uncheckable" : "unresolved";
  }
}

/** 标签 → 规则表的证据状态；用于证据不够、标签被降级之后重新求整句。 */
export function standingForLabel(label: LabelKey): PartStanding {
  switch (label) {
    case "true":
    case "mostly-true":
      return "supported";
    case "false":
      return "refuted";
    case "partly-true":
    case "exaggerated":
      return "partial";
    case "disputed":
      return "conflicting";
    default:
      return "unresolved";
  }
}

/**
 * 标签要有证据撑着（#140）：属实 / 基本属实至少一条支持，不属实至少一条反驳，
 * 部分属实 / 夸大了至少一条支持或反驳。撑不住就降为还查不清。
 */
export function labelBackedByEvidence(label: LabelKey, support: number, contradict: number): LabelKey {
  if ((label === "true" || label === "mostly-true") && support === 0) return "unresolved";
  if (label === "false" && contradict === 0) return "unresolved";
  if ((label === "partly-true" || label === "exaggerated") && support + contradict === 0) return "unresolved";
  return label;
}

export type LabeledPart = { role: PartRole; standing: PartStanding; label: LabelKey };

/**
 * 规则 → 整句标签（#140 第 6 条，2026-10-09 用户确认）。
 * nonCheckable：没有可核查部分时，那些立场 / 预测条目的标签（全是无法核对时整句才是无法核对）。
 */
export function wholeLabelFor(rule: VerdictRule, parts: readonly LabeledPart[], nonCheckable: readonly LabelKey[] = []): LabelKey {
  const mains = parts.filter((p) => p.role === "main");
  const deciding = (list: readonly LabeledPart[], standing: PartStanding) => list.filter((p) => p.standing === standing);
  const mainList = mains.length > 0 ? mains : parts;
  switch (rule) {
    case "all-supported":
      return "true";
    case "background-refuted":
      return "mostly-true";
    case "main-partial":
    case "premise-partial": {
      const list = deciding(rule === "main-partial" ? mainList : parts.filter((p) => p.role === "premise"), "partial");
      return list.length > 0 && list.every((p) => p.label === "exaggerated") ? "exaggerated" : "partly-true";
    }
    case "parallel-true-and-false":
    case "premise-refuted":
      return "partly-true";
    case "main-refuted":
      return "false";
    case "main-unresolved":
    case "premise-unresolved": {
      const list = rule === "main-unresolved" ? deciding(mainList, "unresolved") : parts.filter((p) => p.role === "premise" && (p.standing === "unresolved" || p.standing === "conflicting"));
      return list.length > 0 && list.every((p) => p.label === "uncheckable") ? "uncheckable" : "unresolved";
    }
    case "main-conflicting":
      return "disputed";
    case "no-checkable-claim":
      if (nonCheckable.length === 0) return "unresolved";
      return nonCheckable.every((label) => label === "uncheckable") ? "uncheckable" : "opinion";
  }
}

/** 代码改了模型给的标签（证据不够等）时，模型那句理由不再成立，换成这句。 */
export const FALLBACK_PART_REASON: Record<LabelKey, string> = {
  true: "找到的材料支持这一截。",
  "mostly-true": "主要内容有材料支持，细节和原话有出入。",
  "partly-true": "材料只支持其中一部分，另一部分被反驳。",
  exaggerated: "有一部分道理，但原话说得太重。",
  false: "找到的材料说的是相反的事。",
  unresolved: "这次找到的材料没有直接支持或反驳这一截，还不能下结论。",
  uncheckable: "按性质现在查不了：还没发生，或没有公开记录。",
  disputed: "权威来源之间说法互相矛盾。",
  opinion: "这是价值判断，不是可以核对的事实。",
};

/** 立场 / 预测条目（拆题标为不可查）的标签：没有依据可查的预测和私下的事是无法核对，其余是观点。 */
export function nonCheckableLabel(atomType: string): LabelKey {
  return atomType === "prediction" || atomType === "personal" ? "uncheckable" : "opinion";
}
