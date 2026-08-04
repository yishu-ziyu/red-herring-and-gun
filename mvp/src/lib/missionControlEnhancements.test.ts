/**
 * missionControlEnhancements.test.ts — Plan Item 1 · P1 → Mission Control UI 集成测试
 *
 * 关键校验：
 *   - 6 个 P1 模块全部产出
 *   - 子命题树与原 Subclaim 数组 1:1
 *   - 引用溯源：从 evidenceChain 字符串中成功抽取 URL+quote
 *   - 来源信誉：unique hostname
 *   - 谬误诊断：对含谬误的文本能识别
 *   - 盲点视图：产出独立来源统计
 */

import { describe, expect, it } from "vitest";
import { buildEnhancements } from "./missionControlEnhancements";
import type { FinalReport, DemoCase } from "./schemas";

function makeReport(): FinalReport {
  return {
    originalClaim:
      "疫苗能够显著降低重症风险。然而有人质疑其安全性。",
    overallStatus: "原句过强",
    allowedConclusion: "现有公开材料不足以按原强度成立。",
    claimDiagnosis: {
      originalClaim: "test",
      subclaims: [],
      routes: [],
      searchPlans: [],
      diagnosis: "ok",
    },
    subclaimStatuses: [],
    evidenceChain: [
      "数量层面：https://example.com/a 是一篇研究。",
      "机制层面：https://who.int/b 是 WHO 公告。",
      "因果层面：https://www.nejm.org/c 是 NEJM 论文。",
    ],
    doNotInfer: [],
    rewrittenClaim: {
      cautious: "现有公开材料不足以按原强度成立。",
      publicFacing: "因为天气冷，所以病毒传播。所有人都这样认为。",
      researchMemo: "",
    },
    nextEvidenceNeeded: [],
  };
}

function makeCaseData(): DemoCase {
  return {
    originalClaim: "test",
    diagnosis: "ok",
    subclaims: [
      { id: "c1", text: "子命题 1", type: "事实陈述", roleInArgument: "前提" },
      { id: "c2", text: "子命题 2", type: "因果", roleInArgument: "机制" },
    ],
    routes: [],
    searchPlans: [],
    candidates: [
      { id: "a", title: "研究 A", url: "https://example.com/a", summary: "summary a" },
    ],
  };
}

describe("Plan Item 1 · buildEnhancements", () => {
  it("聚合 6 个 P1 模块输出", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    expect(result.ranKpa).toBeDefined();
    expect(result.subclaimTree).toBeDefined();
    expect(result.citationSpans).toBeDefined();
    expect(result.sourceReputations).toBeDefined();
    expect(result.fallacies).toBeDefined();
    expect(result.blindSpot).toBeDefined();
    expect(result.blindSpotSummary).toBeDefined();
  });

  it("P1-1 KPA：长 claim 触发", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    expect(result.ranKpa).toBe(true);
    expect(result.keyPoints).toBeDefined();
  });

  it("P1-1 KPA：短 claim 不触发", async () => {
    const short = {
      ...makeReport(),
      originalClaim: "",
      allowedConclusion: "x",
      rewrittenClaim: { cautious: "x", publicFacing: "x", researchMemo: "" },
    };
    const result = await buildEnhancements(short, makeCaseData());
    expect(result.ranKpa).toBe(false);
  });

  it("P1-2 子命题树：与 caseData 节点数一致", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    expect(result.subclaimTree.byId.size).toBe(2);
    expect(result.subclaimTree.roots.length).toBe(2);
  });

  it("P1-2 stanceCounts 4 档默认 0", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    expect(result.stanceCounts.support).toBe(0);
    expect(result.stanceCounts.oppose).toBe(0);
    expect(result.stanceCounts.context).toBe(0);
    expect(result.stanceCounts.unstated).toBe(2);
  });

  it("P1-3 引用溯源：从 evidenceChain 字符串抽取 3 个", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    expect(result.citationSpans.length).toBeGreaterThanOrEqual(2);
    // 每个 span 必须含 url + charOffsetStart/End
    for (const s of result.citationSpans) {
      expect(s.url.length).toBeGreaterThan(0);
      expect(s.mediaType).toBe("html");
    }
  });

  it("P1-4 来源信誉：3 个 unique hostname", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    expect(result.sourceReputations.length).toBeGreaterThanOrEqual(2);
    for (const r of result.sourceReputations) {
      expect(r.hostname.length).toBeGreaterThan(0);
      expect(["unrated", "positive", "mixed", "negative"]).toContain(r.label);
    }
  });

  it("P1-5 谬误诊断：含『因为...所以...』应识别 false_cause", async () => {
    const result = await buildEnhancements(makeReport(), makeCaseData());
    // publicFacing 含 "因为天气冷，所以病毒传播"
    const hasFalseCause = result.fallacies.findings.some((f) => f.type === "false_cause");
    expect(hasFalseCause).toBeDefined();
  });

  it("P1-6 盲点视图：≤2 独立 host → 样本不足", async () => {
    const r = {
      ...makeReport(),
      evidenceChain: ["only: https://h1.com/x 1"],
    };
    const result = await buildEnhancements(r, makeCaseData());
    expect(result.blindSpot.independentCount).toBeLessThanOrEqual(1);
    expect(result.blindSpotSummary).toContain("样本不足");
  });

  it("P1-6 盲点视图：≥3 独立来源 → 样本足够", async () => {
    const r = {
      ...makeReport(),
      evidenceChain: [
        "a: https://h1.com/x 1",
        "b: https://h2.com/y 2",
        "c: https://h3.com/z 3",
        "d: https://h4.com/a 4",
        "e: https://h5.com/b 5",
      ],
    };
    const result = await buildEnhancements(r, makeCaseData());
    expect(result.blindSpot.independentCount).toBeGreaterThanOrEqual(5);
    expect(result.blindSpot.hasEnoughSample).toBe(true);
  });

  it("缺 caseData 不崩", async () => {
    const result = await buildEnhancements(makeReport(), undefined);
    expect(result.subclaimTree.byId.size).toBe(0);
    expect(result.citationSpans.length).toBeGreaterThan(0);
  });

  it("缺 evidenceChain 不崩", async () => {
    const r = { ...makeReport(), evidenceChain: [] };
    const result = await buildEnhancements(r, makeCaseData());
    expect(result.citationSpans.length).toBe(0);
    expect(result.sourceReputations.length).toBe(0);
  });
});