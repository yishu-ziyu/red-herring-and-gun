import { describe, expect, it } from "vitest";
import type { Case, Claim } from "@rhg/core/casefile";
import { replay } from "@rhg/core/casefile";
import { FIXTURES } from "./catalog.js";
import { citesForClaim, locateClaim, originSegments, pickOriginSource } from "./originInk.js";

const AT = "2026-09-05T00:00:00.000Z";

function claim(id: string, text: string, over: Partial<Claim> = {}): Claim {
  return { id, text, type: "fact", checkable: true, order: 0, ...over };
}

function blank(over: Partial<Case> = {}): Case {
  return {
    id: "c",
    text: "",
    createdAt: AT,
    seq: 1,
    claims: [],
    evidence: [],
    stances: [],
    verdicts: [],
    cites: [],
    frontier: [],
    consumedPivotIds: [],
    investigatorSteps: [],
    investigatorStops: [],
    llmCalls: [],
    stages: [],
    turns: [],
    messages: [],
    errors: [],
    droppedClaims: [],
    ...over,
  };
}

describe("locateClaim", () => {
  it("span 必须切出 claim.text，对不上时只接受原文唯一精确出现", () => {
    const source = "某地推广该保健品后癌症死亡率下降，证明该保健品能防癌";
    const p1 = "癌症死亡率下降";
    const at = source.indexOf(p1);
    expect(locateClaim(source, claim("c1", p1, { span: { start: at, end: at + p1.length } }))).toEqual({
      start: at,
      end: at + p1.length,
    });
    expect(locateClaim(source, claim("c1", p1, { span: { start: 0, end: 2 } }))).toEqual({
      start: at,
      end: at + p1.length,
    });
    expect(locateClaim("甲增长。还是甲增长。", claim("c1", "甲增长", { span: { start: 0, end: 1 } }))).toBeUndefined();
    expect(locateClaim("只有乙下降", claim("c1", "甲增长"))).toBeUndefined();
  });
});

describe("originSegments", () => {
  it("精确锚定的命题落在原句上，出处跟在后面；间隔不标成推断", () => {
    const source = "某地推广该保健品后癌症死亡率下降，证明该保健品能防癌";
    const p1 = "癌症死亡率下降";
    const p2 = "该保健品能防癌";
    const current = blank({
      text: source,
      claims: [
        claim("c1", p1, { span: { start: source.indexOf(p1), end: source.indexOf(p1) + p1.length } }),
        claim("c2", p2, { type: "causal", order: 1, span: { start: source.indexOf(p2), end: source.indexOf(p2) + p2.length } }),
      ],
      report: {
        conclusion: "死亡率下降有材料可核；「因此能防癌」推不出来。",
        claimItems: [
          { claimId: "c1", line: `${p1}[1]`, citations: [1] },
          { claimId: "c2", line: p2, citations: [] },
        ],
        citations: [{ n: 1, evidenceId: "e1" }],
        finalizedAt: AT,
      },
    });
    const parts = originSegments(current);
    expect(parts.map((item) => item.text).join("")).toBe(source);
    expect(parts.find((item) => item.kind === "claim" && item.claimId === "c1")?.citeNs).toEqual([1]);
    expect(parts.some((item) => item.kind === "plain" && item.text.includes("证明"))).toBe(true);
    expect(parts.every((item) => item.kind === "plain" || item.kind === "claim")).toBe(true);
  });

  it("并列事实也不把间隔当成推断", () => {
    const source = "甲公司去年营收增长。乙公司去年营收增长。";
    const current = blank({
      text: source,
      claims: [claim("c1", "甲公司去年营收增长"), claim("c2", "乙公司去年营收增长", { order: 1 })],
    });
    const parts = originSegments(current);
    expect(parts.map((item) => item.text).join("")).toBe(source);
    expect(parts.filter((item) => item.kind === "claim")).toHaveLength(2);
    expect(parts.some((item) => item.kind === "plain" && item.text.includes("。"))).toBe(true);
  });

  it("单一事实：整句保留", () => {
    const source = "人社部发文说生育津贴直接打到个人卡里了";
    const current = blank({
      text: source,
      claims: [claim("c1", source)],
    });
    expect(originSegments(current).map((item) => item.text).join("")).toBe(source);
  });

  it("立场型不涂成命题", () => {
    const source = "这届专家全被收买了";
    const current = blank({
      text: source,
      claims: [claim("c1", source, { type: "value", checkable: false })],
    });
    expect(originSegments(current).every((item) => item.kind !== "claim")).toBe(true);
  });
});

describe("pickOriginSource", () => {
  it("多轮时用能完整承载命题的最新用户消息，不用最初的这个靠谱吗", () => {
    const source = "人社部发文说生育津贴直接打到个人卡里了";
    const current = blank({
      text: "这个靠谱吗？",
      claims: [claim("c1", source)],
      messages: [
        { id: "m1", role: "user", text: "这个靠谱吗？", at: AT, route: "new_claim" },
        { id: "m2", role: "assistant", text: "把那句话发过来。", at: AT },
        { id: "m3", role: "user", text: source, at: AT, route: "new_claim" },
        { id: "m4", role: "user", text: "顺着这条出处再查", at: AT, route: "pursue_frontier" },
      ],
    });
    expect(pickOriginSource(current)).toBe(source);
    expect(originSegments(current).map((item) => item.text).join("")).toBe(source);
  });

  it("两条都完整承载时用最新一条", () => {
    const first = "人社部发文说生育津贴直接打到个人卡里了";
    const newer = `${first}，单位还要申领。`;
    const current = blank({
      text: first,
      claims: [claim("c1", first)],
      messages: [
        { id: "m1", role: "user", text: first, at: AT, route: "new_claim" },
        { id: "m2", role: "user", text: newer, at: AT, route: "ask_case" },
      ],
    });
    expect(pickOriginSource(current)).toBe(newer);
  });

  it("命题分落两条消息时不选、不拼接", () => {
    const current = blank({
      text: "这个靠谱吗？",
      claims: [claim("c1", "甲公司去年营收增长"), claim("c2", "乙公司去年营收增长", { order: 1 })],
      messages: [
        { id: "m1", role: "user", text: "甲公司去年营收增长", at: AT, route: "new_claim" },
        { id: "m2", role: "user", text: "乙公司去年营收增长", at: AT, route: "ask_case" },
      ],
    });
    expect(pickOriginSource(current)).toBeUndefined();
    expect(originSegments(current)).toEqual([]);
  });

  it("followup fixture 仍用首条完整说法，不用追查句", () => {
    const folded = replay(FIXTURES.followup!.events);
    expect(pickOriginSource(folded)).toBe("人社部发文说生育津贴直接打到个人卡里了");
  });
});

describe("citesForClaim", () => {
  it("没有 claimItems 时不编造编号", () => {
    const current = blank({ text: "a", claims: [claim("c1", "a")] });
    expect(citesForClaim(current, "c1")).toEqual([]);
  });
});
