import { describe, expect, it } from "vitest";
import { bindDebunksToPrimaryClaim, listAssessedClaims } from "./sentenceVerdict";

const ATOM = "常穿黑色内衣易患癌";
const DEBUNK = { url: "https://piyao.example/black", title: "常穿黑色内衣易患癌？谣言", snippet: "没有科学依据" };

function primaryOf(report: Record<string, unknown>) {
  const claims = listAssessedClaims(report, { claimAtoms: [ATOM], claimAtomTypes: [{ text: ATOM, verifiable: true, type: "causal" }] });
  return claims.find((c) => c.role === "primary");
}

describe("关键词辟谣只补模型判定的空白", () => {
  it("模型没判：挂上辟谣，主要主张站不住", () => {
    const report = { subclaimVerdicts: [{ claimAtom: ATOM, verdict: "unverified", notJudgedByModel: true }] };
    const primary = primaryOf(report);
    expect(bindDebunksToPrimaryClaim(report, primary, [DEBUNK])).toBe(true);
    expect(primary?.standing).toBe("refuted");
  });

  // 2026-09-28 改后实测 RUMOR-010：模型判了站不住，关系审核失败把它降成 unverified。
  it("模型判了站不住但被降级：挂上辟谣", () => {
    const report = { subclaimVerdicts: [{ claimAtom: ATOM, verdict: "unverified", demotedFrom: "false", sourcesRelatedOnly: true }] };
    const primary = primaryOf(report);
    expect(bindDebunksToPrimaryClaim(report, primary, [DEBUNK])).toBe(true);
    const entry = (report.subclaimVerdicts as Array<Record<string, unknown>>)[0]!;
    expect(entry.verdict).toBe("false");
    expect(entry.demotedFrom).toBeUndefined();
  });

  it("模型明确判了查不清：不用关键词覆盖", () => {
    const report = { subclaimVerdicts: [{ claimAtom: ATOM, verdict: "unverified" }] };
    expect(bindDebunksToPrimaryClaim(report, primaryOf(report), [DEBUNK])).toBe(false);
  });

  it("模型判了成立却被降级：方向与辟谣相反，不绑定", () => {
    const report = { subclaimVerdicts: [{ claimAtom: ATOM, verdict: "unverified", demotedFrom: "true" }] };
    expect(bindDebunksToPrimaryClaim(report, primaryOf(report), [DEBUNK])).toBe(false);
  });
});
