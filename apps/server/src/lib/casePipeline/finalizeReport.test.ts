/**
 * 收尾链的顺序表征：只钉住现有管线测试与 golden 都没钉住的先后关系（2026-09-29 变异检查里改了顺序却无人察觉的两处），
 * 以及收尾对外的副作用顺序与探活端口的失败语义。判决规则本身由各模块自己的测试守。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimAtomKey } from "../claimAtom/index.js";
import { pruneDeadCitations } from "../citationLiveness.js";
import { FOLLOW_UP_MARKER } from "../followUpReuse.js";
import { UNOPENED_LINK_ANSWER, UNOPENED_LINK_NOTICE } from "../publicCopy.js";
import { finalizeReport, type FinalizeReportInput } from "./finalizeReport.js";
import type { PipelineStep } from "./runCasePipeline.js";

type Source = { url: string; title: string; snippet: string };

function caseInput(args: {
  claim: string;
  atoms: string[];
  verdicts?: Array<Record<string, unknown>>;
  sources?: Record<string, Source[]>;
  draft: Record<string, unknown>;
}): FinalizeReportInput {
  const rumorStep: PipelineStep = {
    agent: "rumor_detector",
    output: {
      claimAtoms: args.atoms,
      claimAtomTypes: args.atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
    },
  };
  const factStep: PipelineStep = {
    agent: "fact_checker",
    output: { factCheckResult: "unverified", subclaimVerdicts: args.verdicts ?? [] },
  };
  const sourceStep: PipelineStep = { agent: "source_validator", output: { claimSourceRelations: [] } };
  const reportStep: PipelineStep = { agent: "report_composer", output: args.draft };
  const byAtomKey: Record<string, Source[]> = {};
  for (const [atom, list] of Object.entries(args.sources ?? {})) byAtomKey[claimAtomKey(atom)] = list;
  return {
    claim: args.claim,
    reportStep,
    rumorStep,
    factStep,
    sourceStep,
    steps: [rumorStep, factStep, sourceStep, reportStep],
    search360Result: { sources: Object.values(args.sources ?? {}).flat() },
    atomSearchBundle: { atomsSearched: args.atoms, byAtomKey },
    auditUnresolvedGaps: [],
    pruneCitations: async () => ({ pruned: false, deadUrls: [] }),
  };
}

const IARC = "IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估";
const HEATING = "微波炉靠让食物里的水分子振动来加热";
const WHO: Source = { url: "https://www.who.int/news/iarc-rf", title: "IARC 射频电磁场评估", snippet: "IARC 没有针对微波炉的独立专项评估。" };
const FDA: Source = { url: "https://www.fda.gov/radiation/microwave-ovens", title: "Microwave Oven Radiation", snippet: "微波让食物中的水分子振动产生热量。" };

function followUpCase(): FinalizeReportInput {
  return caseInput({
    claim: [
      "这一说法在流行病学或临床医学中是否有可靠的实验数据支持？",
      "",
      `（${FOLLOW_UP_MARKER}）`,
      "原对象：微波炉加热食物会致癌。",
    ].join("\n"),
    // 主要主张成立、次要的一截被反驳 → 规则表判「有真有假」，结论按命题逐条列，第一句引的是命题而不是这句追问。
    atoms: [HEATING, IARC],
    verdicts: [
      { claimAtom: HEATING, verdict: "true", evidence: "微波让水分子振动产生热量[1]。", supportingSources: [FDA] },
      { claimAtom: IARC, verdict: "false", evidence: "IARC 没有独立专项评估[1]。", contradictingSources: [WHO] },
    ],
    sources: { [HEATING]: [FDA], [IARC]: [WHO] },
    draft: { verdictType: "false", conclusion: "流行病学和临床数据都不支持。" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finalizeReport 的先后关系", () => {
  it("追问直答在整句判定之后：规则表重写了结论，第一句仍然回答这句追问", async () => {
    const { finalReport } = await finalizeReport(followUpCase());
    expect(finalReport.verdictType).toBe("mixed_misleading");
    expect(String(finalReport.conclusion)).toMatch(/^这句追问「这一说法在流行病学或临床医学中[^」]*」有站住的部分，也有没站住的。「微波炉/);
    expect(String(finalReport.recommendation)).toMatch(/^这句追问「这一说法在流行病学/);
  });

  it("只有一条打不开的链接：固定答「读不到要查的说法」，整句判定不能再把它改写", async () => {
    const { finalReport } = await finalizeReport(
      caseInput({
        claim: "https://weibo.com/1234567890/AbCdEfGh",
        atoms: [],
        draft: {
          verdictType: "unverified",
          conclusion: "按已有分条判断收束。",
          _fallbackReason: "剩余时间不够写完整报告，按已有分条判断收束。",
        },
      }),
    );
    expect(finalReport.conclusion).toBe(UNOPENED_LINK_ANSWER);
    expect(finalReport.summaryForPublic).toBe(UNOPENED_LINK_ANSWER);
    expect(finalReport.causalBoundary).toBe(UNOPENED_LINK_NOTICE);
    expect(finalReport.verdictType).toBe("unverified");
    expect(finalReport.faceVerdict).toBe("还查不清");
  });

  it("对外副作用的顺序：注入的收尾钩子 → 复核开始 → 来源探活", async () => {
    const calls: string[] = [];
    const input = followUpCase();
    await finalizeReport({
      ...input,
      finalizeHook: () => calls.push("finalizeHook"),
      onReviewStart: () => calls.push("reviewStart"),
      pruneCitations: async () => {
        calls.push("pruneCitations");
        return { pruned: false, deadUrls: [] };
      },
    });
    expect(calls).toEqual(["finalizeHook", "reviewStart", "pruneCitations"]);
  });

  it("就地收尾：报告写作步骤的 output 就是返回的终态报告", async () => {
    const input = followUpCase();
    const { finalReport } = await finalizeReport(input);
    expect(finalReport).toBe(input.reportStep.output);
    expect(input.steps[3]!.output).toBe(finalReport);
    expect(typeof finalReport.checkedAt).toBe("string");
  });
});

describe("finalizeReport 的来源探活端口", () => {
  it("探活判死的链接从报告引用里剔除，并原样返回给完成快照", async () => {
    const input = followUpCase();
    const { finalReport, deadUrls } = await finalizeReport({
      ...input,
      pruneCitations: (report) => pruneDeadCitations(report, { liveness: new Map([[WHO.url, "dead"]]) }),
    });
    expect(deadUrls).toEqual([WHO.url]);
    expect(JSON.stringify(finalReport.subclaimVerdicts)).not.toContain(WHO.url);
    expect(JSON.stringify(finalReport.citationSources ?? [])).not.toContain(WHO.url);
  });

  it("探活通道自身出错：跳过剔除，报告照常收尾", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = followUpCase();
    const { finalReport, deadUrls } = await finalizeReport({
      ...input,
      pruneCitations: async () => {
        throw new Error("probe channel down");
      },
    });
    expect(deadUrls).toEqual([]);
    expect(finalReport.faceVerdict).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("引用探活失败，跳过死链剔除"));
  });

  it("已经取消时探活出错：抛出取消，不吞成「跳过剔除」", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = followUpCase();
    await expect(
      finalizeReport({
        ...input,
        signal: controller.signal,
        pruneCitations: async () => {
          throw new Error("probe aborted");
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
