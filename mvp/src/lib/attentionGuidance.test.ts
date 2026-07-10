import { describe, expect, it } from "vitest";
import {
  attachSourcesToSpans,
  buildAttentionGuidance,
  buildAttentionRail,
  buildBoundarySpans,
  classifyConclusionUnit,
  enforceNoBlockedAsAssert,
  shortSourceTitle,
  splitIntoUnits,
} from "./attentionGuidance";
import type { CandidateMaterial, ClaimSpan } from "./schemas";
import { demoCase } from "../data/demoCase";

describe("splitIntoUnits", () => {
  it("splits Chinese sentences and keeps punctuation", () => {
    const units = splitIntoUnits(
      "主管部门已否认该政策。网传文件来源不明。因此不能推出政策已取消。",
    );
    expect(units.length).toBe(3);
    expect(units[0]).toContain("否认");
    expect(units[2]).toContain("不能推出");
  });
});

describe("classifyConclusionUnit", () => {
  const empty = {
    cannotSay: [] as string[],
    doNotInfer: [] as string[],
    licenseBlocked: [] as string[],
    nextEvidenceNeeded: [] as string[],
  };

  it("marks blocked language as blocked, never assert", () => {
    const r = classifyConclusionUnit("因此不能推出政策已确定取消。", empty);
    expect(r.spanType).toBe("blocked");
    expect(r.license).toBe("blocked");
  });

  it("marks gap language as gap", () => {
    const r = classifyConclusionUnit("网传内部文件目前无法追溯到可验证原始出处。", empty);
    expect(r.spanType).toBe("gap");
  });

  it("marks cautious language as hedge", () => {
    const r = classifyConclusionUnit("生成式 AI 可能正在改变任务结构。", empty);
    expect(r.spanType).toBe("hedge");
  });

  it("aligns with cannotSay list even without keyword", () => {
    const r = classifyConclusionUnit(
      "把转载热度当成多源证实是不成立的说法边界。",
      {
        ...empty,
        cannotSay: ["把转载热度当成多源证实"],
      },
    );
    expect(r.spanType).toBe("blocked");
  });
});

describe("Change D: boundary spans", () => {
  it("forces cannot-say items to blocked", () => {
    const { cannotSaySpans } = buildBoundarySpans(
      ["官方已否认该政策文件存在"],
      ["不能说政策已落地取消", "不能把转载热度当成多源证实"],
    );
    expect(cannotSaySpans.length).toBe(2);
    expect(cannotSaySpans.every((s) => s.spanType === "blocked")).toBe(true);
    expect(cannotSaySpans.every((s) => s.license === "blocked")).toBe(true);
  });

  it("never types can-say as blocked", () => {
    const { canSaySpans } = buildBoundarySpans(
      ["官方已否认该政策文件存在", "公开渠道未见可验证原件，仍属缺口"],
      [],
    );
    expect(canSaySpans.every((s) => s.spanType !== "blocked")).toBe(true);
    expect(canSaySpans.some((s) => s.spanType === "assert")).toBe(true);
  });

  it("drops can-say items that duplicate cannot-say (blocked wins)", () => {
    const dup = "不能说政策已落地取消";
    const { canSaySpans, cannotSaySpans } = buildBoundarySpans([dup], [dup]);
    expect(canSaySpans.find((s) => s.text === dup)).toBeUndefined();
    expect(cannotSaySpans.some((s) => s.text === dup && s.spanType === "blocked")).toBe(
      true,
    );
  });
});

describe("Change A: conclusion span sequence", () => {
  it("builds mixed span types from a realistic conclusion", () => {
    const guided = buildAttentionGuidance({
      conclusion:
        "主管部门已公开否认存在取消退休金政策。网传内部文件目前无法追溯到可验证原始出处。因此不能推出政策已确定取消。",
      canSay: ["官方已否认该政策文件存在"],
      cannotSay: ["不能说政策已落地取消"],
      doNotInfer: ["不能把转载热度当成多源证实"],
      nextEvidenceNeeded: ["可验证的文件扫描件"],
    });

    expect(guided.spans.length).toBeGreaterThanOrEqual(2);
    expect(guided.spans.some((s) => s.spanType === "gap")).toBe(true);
    expect(guided.spans.some((s) => s.spanType === "blocked")).toBe(true);
    expect(guided.plainText).toContain("否认");
  });

  it("invariant: no blocked content remains typed as assert", () => {
    const dirty: ClaimSpan[] = [
      {
        id: "x",
        text: "不能从同期变化推出 AI 导致岗位减少。",
        spanType: "assert",
        sourceIds: [],
        attention: "p3",
        license: "allowed",
      },
    ];
    const fixed = enforceNoBlockedAsAssert(
      dirty,
      ["不能从同期变化推出 AI 导致岗位减少"],
      [],
    );
    expect(fixed[0].spanType).toBe("blocked");
    expect(fixed[0].license).toBe("blocked");
  });

  it("end-to-end guidance has canSaySpans assert/gap only and cannotSaySpans all blocked", () => {
    const guided = buildAttentionGuidance({
      conclusion: "生成式 AI 可能正在改变初级内容岗位的任务结构，但现有材料不足以确认其导致岗位减少。",
      canSay: ["可以说任务结构可能变化"],
      cannotSay: ["不能使用“导致”作为最终结论"],
    });

    expect(guided.canSaySpans.every((s) => s.spanType === "assert" || s.spanType === "gap")).toBe(
      true,
    );
    expect(guided.cannotSaySpans.every((s) => s.spanType === "blocked")).toBe(true);
    expect(guided.spans.every((s) => !(s.spanType === "assert" && s.license === "blocked"))).toBe(
      true,
    );
  });
});

describe("Change B: source chips", () => {
  it("shortSourceTitle keeps a human fragment", () => {
    expect(shortSourceTitle("研究显示写作密集型职业对大语言模型暴露度较高").length).toBeLessThanOrEqual(15);
  });

  it("attaches sources to hedge/assert, never to blocked or gap", () => {
    const spans: ClaimSpan[] = [
      {
        id: "1",
        text: "生成式 AI 可能正在改变初级内容岗位的任务结构。",
        spanType: "hedge",
        sourceIds: [],
        attention: "p3",
      },
      {
        id: "2",
        text: "现有材料不足以确认其导致岗位减少。",
        spanType: "gap",
        sourceIds: [],
        attention: "p2",
      },
      {
        id: "3",
        text: "不能使用导致作为最终结论。",
        spanType: "blocked",
        sourceIds: [],
        attention: "p0",
      },
    ];
    const { spans: next } = attachSourcesToSpans(spans, demoCase.candidates as CandidateMaterial[], 2);
    expect((next[0].sources?.length ?? 0)).toBeGreaterThan(0);
    expect(next[1].sources ?? []).toEqual([]);
    expect(next[2].sources ?? []).toEqual([]);
  });

  it("end-to-end with candidates yields at least one source chip on a non-blocked span", () => {
    const guided = buildAttentionGuidance({
      conclusion:
        "生成式 AI 可能正在改变初级内容岗位的任务结构，但现有材料不足以确认其导致岗位减少。",
      canSay: ["任务结构可能变化"],
      cannotSay: ["不能使用导致作为最终结论"],
      nextEvidenceNeeded: ["同一统计定义下的初级内容岗位招聘时间序列。"],
      candidates: demoCase.candidates,
    });
    const withSources = guided.spans.filter((s) => (s.sources?.length ?? 0) > 0);
    expect(withSources.length).toBeGreaterThan(0);
    expect(withSources.every((s) => s.spanType !== "blocked" && s.spanType !== "gap")).toBe(true);
  });
});

describe("Change C: attention rail", () => {
  it("returns at most 3 items ordered by priority", () => {
    const guided = buildAttentionGuidance({
      conclusion:
        "主管部门已公开否认存在取消退休金政策。网传内部文件目前无法追溯到可验证原始出处。因此不能推出政策已确定取消。",
      cannotSay: ["不能说政策已落地取消"],
      nextEvidenceNeeded: ["可验证的文件扫描件"],
      candidates: demoCase.candidates,
    });
    expect(guided.attentionRail.length).toBeGreaterThan(0);
    expect(guided.attentionRail.length).toBeLessThanOrEqual(3);
  });

  it("buildAttentionRail prefers blocked/gap over empty", () => {
    const spans: ClaimSpan[] = [
      {
        id: "a",
        text: "因此不能推出政策已确定取消。",
        spanType: "blocked",
        sourceIds: [],
        attention: "p0",
      },
      {
        id: "b",
        text: "网传文件无法追溯。",
        spanType: "gap",
        sourceIds: [],
        attention: "p2",
      },
    ];
    const rail = buildAttentionRail(spans, [], ["原件"], 3);
    expect(rail[0].priority).toBe("p0");
    expect(rail.some((r) => r.spanId === "b")).toBe(true);
  });
});
