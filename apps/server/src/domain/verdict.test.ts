import { describe, expect, it } from "vitest";
import { decideSentenceVerdict, type AssessedClaim } from "./verdict";

const c = (text: string, role: AssessedClaim["role"], standing: AssessedClaim["standing"]): AssessedClaim => ({ text, role, standing });

describe("整句判定规则表（docs/evals/2026-09-28-judgment-refactor.md）", () => {
  it("主要主张被反驳 → 不能信；没查清的其余部分只作边界", () => {
    const threshold = c("大剂量存在明确阈值", "secondary", "unresolved");
    const decision = decideSentenceVerdict([c("大剂量维生素C有利于预防感冒", "primary", "refuted"), threshold]);
    expect(decision).toEqual({ verdict: "cannot-believe", rule: "primary-refuted", boundaryClaims: [threshold] });
  });

  it("并列主张：前一个被反驳、后一个没查清 → 不能信（NEW-002 裁决）", () => {
    const decision = decideSentenceVerdict([
      c("维生素C能预防感冒", "primary", "refuted"),
      c("维生素C能美白皮肤", "secondary", "unresolved"),
    ]);
    expect(decision.verdict).toBe("cannot-believe");
  });

  it("主要主张被反驳，即使其余部分被证实，也不能信", () => {
    expect(decideSentenceVerdict([c("A", "primary", "refuted"), c("B", "secondary", "supported")]).verdict).toBe("cannot-believe");
  });

  it("全部被证实 → 能信", () => {
    expect(decideSentenceVerdict([c("A", "primary", "supported"), c("B", "secondary", "supported")])).toMatchObject({
      verdict: "can-believe",
      rule: "all-supported",
    });
  });

  it("主要主张被证实、其余有被反驳的 → 有真有假", () => {
    expect(decideSentenceVerdict([c("A", "primary", "supported"), c("B", "secondary", "refuted")]).verdict).toBe(
      "part-true-part-false"
    );
  });

  it("主要主张被证实、前提没查清 → 证据不足，不能说撑得住", () => {
    expect(decideSentenceVerdict([c("A", "primary", "supported"), c("B", "secondary", "unresolved")])).toMatchObject({
      verdict: "not-enough-evidence",
      rule: "primary-supported-others-unresolved",
    });
  });

  it("主要主张有对有错 → 有真有假", () => {
    expect(decideSentenceVerdict([c("A", "primary", "mixed")]).verdict).toBe("part-true-part-false");
  });

  it("主要主张没查清 → 证据不足（没搜到不等于假）", () => {
    expect(decideSentenceVerdict([c("A", "primary", "unresolved"), c("B", "secondary", "refuted")])).toMatchObject({
      verdict: "not-enough-evidence",
      rule: "primary-unresolved",
    });
  });

  it("没有可核查命题 → 证据不足", () => {
    expect(decideSentenceVerdict([]).rule).toBe("no-checkable-claim");
  });
});
