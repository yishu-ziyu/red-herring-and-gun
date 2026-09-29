/**
 * Derive the whole-claim label from annotated parts, following the user-approved rule table in
 * docs/evals/2026-09-28-judgment-refactor.md 「判定规则」 plus the 2026-09-29 scoring rules in
 * docs/evals/2026-09-29-answer-benchmark.md 「评分规则」.
 *
 * Status mapping to the table: 被支持=被证实, 查不到=查不清, 来源冲突=证据互相冲突, 不适用=立场型.
 *
 * The table itself lives in one place: production's src/domain/verdict.ts. This file only translates the
 * annotators' vocabulary to it and back, so the eval and the product can never disagree about the rules.
 */
import {
  decideSentenceVerdict,
  type PartRole as DomainRole,
  type PartStanding,
  type SentenceVerdict,
} from "../src/domain/verdict.js";

export type PartRole = "主要主张" | "必要前提" | "背景细节";
export type PartStatus = "被支持" | "被反驳" | "部分支持" | "查不到" | "来源冲突" | "不适用";
export type BenchLabel = "能信" | "不能信" | "有真有假" | "部分成立" | "证据不足" | "有争议" | "立场型";

export interface LabelPart {
  role: PartRole;
  status: PartStatus;
  /** Scoring rule 1: the content is true but the claim names the wrong issuing body/source. Does not downgrade. */
  issuerMisattributed?: boolean;
}

const ROLE: Record<PartRole, DomainRole> = {
  主要主张: "main",
  必要前提: "premise",
  背景细节: "background",
};
const STANDING: Record<Exclude<PartStatus, "不适用">, PartStanding> = {
  被支持: "supported",
  被反驳: "refuted",
  部分支持: "partial",
  查不到: "unresolved",
  来源冲突: "conflicting",
};
const LABEL: Record<SentenceVerdict, BenchLabel> = {
  "can-believe": "能信",
  "cannot-believe": "不能信",
  "part-true-part-false": "有真有假",
  "partly-holds": "部分成立",
  "not-enough-evidence": "证据不足",
  disputed: "有争议",
};

export function deriveLabel(input: readonly LabelPart[]): BenchLabel {
  const parts = input.flatMap((p) =>
    p.status === "不适用"
      ? []
      : [
          {
            text: "",
            role: ROLE[p.role],
            standing: STANDING[p.status],
            ...(p.issuerMisattributed ? { issuerMisattributed: true } : {}),
          },
        ]
  );
  if (parts.length === 0) return "立场型";
  return LABEL[decideSentenceVerdict(parts).verdict];
}
