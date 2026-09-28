import { describe, expect, it } from "vitest";
import { mergeSubclaimVerdicts } from "./merge";

// 2026-09-28 改后实测 RUMOR-005：命题记录经过两次合并，第二次按固定字段重拼，
// 「模型没判」标记丢失，关键词辟谣无法补上，5 篇「谣言！」出处的说法仍被判证据不足。
describe("合并保留判定来历标记", () => {
  it("二次合并后，模型没判的命题仍带 notJudgedByModel", () => {
    const once = mergeSubclaimVerdicts(["点早安晚安图片会中毒"], []);
    expect(once[0]?.notJudgedByModel).toBe(true);
    const twice = mergeSubclaimVerdicts(["点早安晚安图片会中毒"], once);
    expect(twice[0]?.notJudgedByModel).toBe(true);
  });

  it("被证据关系审核或出处绑定降级时，保留原判定", () => {
    const merged = mergeSubclaimVerdicts(
      ["常穿黑色内衣易患癌"],
      [{ claimAtom: "常穿黑色内衣易患癌", verdict: "unverified", evidence: "", boundary: "", demotedFrom: "false" }]
    );
    expect(merged[0]?.demotedFrom).toBe("false");
  });
});
