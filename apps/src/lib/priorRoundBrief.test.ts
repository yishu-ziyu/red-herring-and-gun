/**
 * 访客追问上一轮可见材料（契约 docs/evals/2026-09-13-guest-followup-fast-path.md Evaluator 1）。
 */
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_MARKER } from "./composeFollowUpClaim";
import { refutedComplete, REFUTED_ATOM, REFUTED_CLAIM } from "../goldenPath/fixtures";
import { visiblePriorRoundFromSnapshot } from "./priorRoundBrief";

describe("visiblePriorRoundFromSnapshot", () => {
  it("只抽出命题、判断、可点开出处、结论；不含内部字段", () => {
    const brief = visiblePriorRoundFromSnapshot(refutedComplete());
    expect(brief).not.toBeNull();
    expect(brief!.originalClaim).toBe(REFUTED_CLAIM);
    expect(brief!.conclusion).toContain("原句站不住");
    expect(brief!.claims).toEqual([
      expect.objectContaining({
        text: REFUTED_ATOM,
        judgment: "refuted",
        evidence: [
          expect.objectContaining({
            url: "https://piyao.org.cn/overnight-water",
            role: "contradict",
          }),
        ],
      }),
    ]);
    const json = JSON.stringify(brief);
    expect(json).not.toContain("finding");
    expect(json).not.toContain("limitation");
    expect(json).not.toContain("provenance");
    expect(json).not.toContain("请直接回答这次追问");
    expect(brief!.claims[0]).not.toHaveProperty("id");
  });

  it("原句里的内部拼接指令不带上", () => {
    const snapshot = refutedComplete();
    snapshot.originalClaim = [
      "那孕妇可以吃吗？",
      "",
      `（${FOLLOW_UP_MARKER}）`,
      `原对象：${REFUTED_CLAIM}`,
      "请直接回答这次追问。需要新证据再检索。不要只重复上一轮结论。",
    ].join("\n");
    const brief = visiblePriorRoundFromSnapshot(snapshot);
    expect(brief!.originalClaim).toBe("那孕妇可以吃吗？");
    expect(brief!.originalClaim).not.toContain(FOLLOW_UP_MARKER);
    expect(brief!.originalClaim).not.toContain("请直接回答这次追问");
  });

  it("没有可点开出处 → null", () => {
    const snapshot = refutedComplete();
    snapshot.sources = snapshot.sources.map((source) => ({ ...source, url: "not-a-url" }));
    expect(visiblePriorRoundFromSnapshot(snapshot)).toBeNull();
    expect(visiblePriorRoundFromSnapshot(null)).toBeNull();
  });
});
