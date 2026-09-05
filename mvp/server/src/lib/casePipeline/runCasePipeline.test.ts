import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCasePipeline } from "./runCasePipeline";
import type { PipelineStep } from "./runCasePipeline";
import { JsonlMemoryCandidateStore } from "../memoryCandidateStore";

describe("runCasePipeline", () => {
  it("顺序：rumor → self-proof 过滤 → 只搜可核查 → assemble 排除立场", async () => {
    const searchOne = vi.fn(async (atom: string) => ({
      answer: atom,
      model: "m",
      sources: [{ url: `https://t.test/${encodeURIComponent(atom)}`, title: atom, snippet: "s" }],
    }));

    const runAgent = vi.fn(async (agentId: string, _steps: PipelineStep[]): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: ["事实A", "价值B", "幻觉碎片"],
            claimAtomTypes: [
              { text: "事实A", verifiable: true, type: "fact" },
              { text: "价值B", verifiable: false, type: "value" },
              { text: "幻觉碎片", verifiable: true, type: "fact" },
            ],
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "partial",
            subclaimVerdicts: [
              { claimAtom: "事实A", verdict: "true", evidence: "e", boundary: "b" },
              { claimAtom: "价值B", verdict: "false", evidence: "no", boundary: "x" },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      if (agentId === "report_composer") {
        return {
          agent: "report_composer",
          output: {
            verdictType: "mixed_misleading",
            conclusion: "c",
            subclaimVerdicts: [
              { claimAtom: "事实A", verdict: "true", evidence: "e", boundary: "b" },
            ],
          },
        };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "原句含事实A与价值B",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: {
          results: [
            { atom: "事实A", supported: true, reason: "ok" },
            { atom: "价值B", supported: true, reason: "stance ok" },
            { atom: "幻觉碎片", supported: false, reason: "not in claim" },
          ],
        },
        model: "selfproof-m",
      }),
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        runAgent("report_composer", steps, search360Result, atomSearchBundle),
    });

    // 幻觉碎片被自证丢掉后不应被检索
    expect(searchOne.mock.calls.map((c) => c[0])).toEqual(["事实A"]);
    expect(result.finalReport.subclaimVerdicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimAtom: "事实A",
          verdict: "unverified",
          sourcesRelatedOnly: true,
        }),
      ])
    );
    expect(
      (result.finalReport.subclaimVerdicts as Array<{ claimAtom: string }>).map((v) => v.claimAtom)
    ).not.toContain("价值B");
    expect(result.finalReport.nonVerifiableAtoms).toEqual([{ text: "价值B", type: "value" }]);
    expect(result.rumorStep.output.claimAtoms).toEqual(["事实A", "价值B"]);
    // deterministic report reviewer mutates final report + reportStep.output
    expect(result.finalReport._review).toEqual(
      expect.objectContaining({ reviewer: "deterministic-report-reviewer" })
    );
    expect(Array.isArray(result.finalReport.evidenceChain)).toBe(true);
    expect((result.finalReport.evidenceChain as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(result.reportStep.output).toBe(result.finalReport);
    // memory candidates proposed from final report (at least case_pattern)
    expect(result.memoryCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.memoryCandidates.every((c) => c.status === "proposed")).toBe(true);
    expect(result.memoryCandidates.some((c) => c.kind === "case_pattern")).toBe(true);
    expect(result.runId).toBeTruthy();
  });

  it("类型闸：隔夜菜被标 value 仍检索；规范句与纯骂不检索", async () => {
    const leftover = "隔夜菜会致癌";
    const normative = "政府应该禁止隔夜菜";
    const rant = "这种政策就是不管老百姓死活";
    const searchOne = vi.fn(async (atom: string) => ({
      answer: atom,
      model: "m",
      sources: [{ url: `https://t.test/${encodeURIComponent(atom)}`, title: atom, snippet: "s" }],
    }));

    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: [leftover, normative, rant],
            claimAtomTypes: [
              { text: leftover, verifiable: false, type: "value" },
              { text: normative, verifiable: false, type: "normative" },
              { text: rant, verifiable: false, type: "value" },
            ],
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "false",
            subclaimVerdicts: [
              { claimAtom: leftover, verdict: "false", evidence: "e", boundary: "b" },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: `${leftover}；${normative}；${rant}`,
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: {
          results: [
            { atom: leftover, supported: true, reason: "ok" },
            { atom: normative, supported: true, reason: "ok" },
            { atom: rant, supported: true, reason: "ok" },
          ],
        },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。" },
      }),
      evidenceLoop: { enabled: false },
    });

    expect(searchOne.mock.calls.map((c) => c[0])).toEqual([leftover]);
    expect(result.atomSearchBundle.atomsSearched).toEqual([leftover]);
    expect(result.rumorStep.output.claimAtomTypes).toEqual([
      { text: leftover, verifiable: true, type: "fact" },
      { text: normative, verifiable: false, type: "normative" },
      { text: rant, verifiable: false, type: "value" },
    ]);
    expect(
      (result.finalReport.subclaimVerdicts as Array<{ claimAtom: string }>).map((v) => v.claimAtom)
    ).toEqual([leftover]);
    expect(result.finalReport.nonVerifiableAtoms).toEqual([
      { text: normative, type: "normative" },
      { text: rant, type: "value" },
    ]);
  });

  it("rumor_detector 失败时把原句当可核查原子继续检索", async () => {
    const searchOne = vi.fn(async (atom: string) => ({
      sources: [{ url: "https://www.piyao.org.cn/x", title: "辟谣", snippet: "不实" }],
    }));
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") throw new Error("quota");
      if (agentId === "fact_checker") {
        return { agent: "fact_checker", output: { factCheckResult: "false", subclaimVerdicts: [] } };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "high" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const selfProof = vi.fn(async () => {
      throw new Error("selfproof quota");
    });

    const result = await runCasePipeline({
      claim: "甘南所有景点一律免费",
      runAgent,
      searchOne,
      callSelfProofModel: selfProof,
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。官方已辟谣。" },
      }),
    });

    expect(selfProof).not.toHaveBeenCalled();
    expect(searchOne).toHaveBeenCalledWith("甘南所有景点一律免费");
    expect(result.rumorStep.output.claimAtoms).toEqual(["甘南所有景点一律免费"]);
    expect(result.finalReport.faceVerdict).toBe("还查不清");
  });

  it("fact_checker 与 source_validator 失败时即使检索有辟谣链接也只能 unverified", async () => {
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: ["上海车展上演全武行"],
            claimAtomTypes: [{ text: "上海车展上演全武行", verifiable: true, type: "fact" }],
          },
        };
      }
      if (agentId === "fact_checker") throw new Error("quota");
      if (agentId === "source_validator") throw new Error("quota");
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "上海车展上演全武行",
      runAgent,
      searchOne: async () => ({
        sources: [{ url: "https://news.ifeng.com/c/fight", title: "警方辟谣上海车展打架系编造", snippet: "不实信息" }],
      }),
      callSelfProofModel: async () => ({
        output: { results: [{ atom: "上海车展上演全武行", supported: true, reason: "ok" }] },
        model: "m",
      }),
      runReport: async ({ steps }) => {
        const fact = steps.find((s) => s.agent === "fact_checker");
        return {
          agent: "report_composer",
          output: {
            verdictType: fact?.output?.factCheckResult === "false" ? "false" : "unverified",
            conclusion: "还查不清。",
          },
        };
      },
    });

    expect(result.factStep.output.factCheckResult).toBe("unverified");
    expect(result.factStep.output.counterEvidence).toEqual([]);
    expect(result.factStep.output.sources).toEqual(["https://news.ifeng.com/c/fight"]);
    expect(result.sourceStep.output.sourceReliability).toBe("unverified");
    expect(result.sourceStep.output.verifiedSources).toEqual([]);
  });

  it("检索已有对题辟谣时，把只能信一部分收成不能信", async () => {
    const result = await runCasePipeline({
      claim: "我说我的电瓶车叫谁偷走了，原来送给非洲人去了",
      runAgent: async (agentId: string): Promise<PipelineStep> => {
        if (agentId === "rumor_detector") {
          return {
            agent: "rumor_detector",
            output: {
              claimAtoms: ["我说我的电瓶车叫谁偷走了，原来送给非洲人去了"],
              claimAtomTypes: [
                { text: "我说我的电瓶车叫谁偷走了，原来送给非洲人去了", verifiable: true, type: "fact" },
              ],
            },
          };
        }
        if (agentId === "fact_checker") {
          return { agent: "fact_checker", output: { factCheckResult: "partial", subclaimVerdicts: [] } };
        }
        if (agentId === "source_validator") {
          return { agent: "source_validator", output: { sourceReliability: "medium" } };
        }
        throw new Error(`unexpected ${agentId}`);
      },
      searchOne: async () => ({
        sources: [
          {
            url: "https://www.piyao.org.cn/ebike",
            title: "合肥警方通报P图编造电瓶车被偷至非洲",
            snippet: "不实信息 辟谣",
          },
        ],
      }),
      callSelfProofModel: async () => ({
        output: {
          results: [{ atom: "我说我的电瓶车叫谁偷走了，原来送给非洲人去了", supported: true, reason: "ok" }],
        },
        model: "m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "mixed_misleading", conclusion: "只能信一部分。" },
      }),
    });

    expect(result.finalReport.verdictType).toBe("false");
    expect(result.finalReport.faceVerdict).toBe("不能信");
  });

  it("report review hooks emit start/result and repair thin reports", async () => {
    const onReportReviewStart = vi.fn();
    const onReportReviewResult = vi.fn();

    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: ["事实A"],
            claimAtomTypes: [{ text: "事实A", verifiable: true, type: "fact" }],
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: { factCheckResult: "unverified", subclaimVerdicts: [] },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "low" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "薄报告应被审稿修补",
      runAgent,
      searchOne: async () => ({ answer: "", model: "m", sources: [] }),
      callSelfProofModel: async () => ({
        output: { results: [{ atom: "事实A", supported: true, reason: "ok" }] },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: {
          verdictType: "true",
          conclusion: "短",
          credibilityScore: 999,
        },
      }),
      hooks: { onReportReviewStart, onReportReviewResult },
    });

    expect(onReportReviewStart).toHaveBeenCalledOnce();
    expect(onReportReviewResult).toHaveBeenCalledOnce();
    const reviewPayload = onReportReviewResult.mock.calls[0][0];
    expect(reviewPayload.passed).toBe(false);
    expect(reviewPayload.issues.some((i: { code: string }) => i.code === "overclaim")).toBe(true);
    expect(result.finalReport.verdictType).toBe("unverified");
    expect(result.finalReport.credibilityScore).toBeLessThanOrEqual(45);
    expect((result.finalReport.evidenceChain as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it("evidence loop：unverified 原子补查命中新证据后重跑一次 fact_checker（ADR-004）", async () => {
    // 初始按原子检索返回旧来源；补查 query（模板含「官方通报」）返回新的官方来源
    const searchOne = vi.fn(async (query: string) => {
      if (query.includes("官方通报")) {
        return {
          sources: [{ url: "https://gov.cn/notice-1", title: "官方通报", snippet: "正式口径" }],
        };
      }
      return {
        sources: [{ url: "https://blog/old", title: "旧帖", snippet: "旧来源" }],
      };
    });
    let factRuns = 0;
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: ["某地明天发生7级地震"],
            claimAtomTypes: [
              { text: "某地明天发生7级地震", verifiable: true, type: "prediction" },
            ],
          },
        };
      }
      if (agentId === "fact_checker") {
        factRuns += 1;
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: factRuns === 1 ? "unverified" : "false",
            subclaimVerdicts: [
              {
                claimAtom: "某地明天发生7级地震",
                verdict: factRuns === 1 ? "unverified" : "false",
              },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "某地明天发生7级地震",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: [{ atom: "某地明天发生7级地震", supported: true, reason: "ok" }] },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。官方已辟谣。" },
      }),
    });

    // 补查触发：初始检索之外至少多一次调用，且 query 来自改写模板
    expect(searchOne.mock.calls.some((c) => c[0].includes("官方通报"))).toBe(true);
    // 拿到新证据 → fact_checker 恰好重跑一次
    expect(factRuns).toBe(2);
    expect(result.evidenceLoop?.ran).toBe(true);
    expect(result.evidenceLoop?.atoms[0]?.stopReason).toBe("evidence-found");
    expect(result.evidenceLoop?.totalNewSources).toBe(1);
    expect(result.evidenceLoop?.pursuitHops?.length).toBeGreaterThan(0);
    expect(result.finalReport.evidencePursuit).toEqual(
      expect.objectContaining({
        hops: expect.arrayContaining([
          expect.objectContaining({ goal: expect.any(String), query: expect.any(String) }),
        ]),
      })
    );
    // 新来源进入 bundle，报告可见
    expect(
      result.atomSearchBundle.aggregate.sources.some((s) => String(s.url).includes("gov.cn"))
    ).toBe(true);
    // 重跑后的 factStep 是最新一次
    expect(result.factStep.output.factCheckResult).toBe("false");
  });

  it("evidence loop：两轮零新增 → 判停且不重跑 fact_checker", async () => {
    const searchOne = vi.fn(async () => ({
      sources: [{ url: "https://same/1", title: "同一来源", snippet: "s" }],
    }));
    let factRuns = 0;
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: ["某说法"],
            claimAtomTypes: [{ text: "某说法", verifiable: true, type: "fact" }],
          },
        };
      }
      if (agentId === "fact_checker") {
        factRuns += 1;
        return {
          agent: "fact_checker",
          output: { factCheckResult: "unverified", subclaimVerdicts: [] },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "low" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "某说法",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: [{ atom: "某说法", supported: true, reason: "ok" }] },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "unverified", conclusion: "查不清。" },
      }),
    });

    expect(factRuns).toBe(1);
    expect(result.evidenceLoop?.atoms[0]?.stopReason).toBe("no-new-evidence");
    expect(result.evidenceLoop?.recheckFactChecker).toBe(false);
  });

  it("翻案续期：pass1 新证据重判仍未解决 → pass2 换当事方策略再问 → 收敛后停（递归按提问质量续命）", async () => {
    const atom = "某地明天发生7级地震";
    const searchOne = vi.fn(async (query: string) => {
      if (query.includes("官方通报")) {
        return { sources: [{ url: "https://gov.cn/notice-1", title: "官方通报", snippet: "口径" }] };
      }
      if (query.includes("当事方")) {
        return { sources: [{ url: "https://party/1", title: "当事方回应", snippet: "回应" }] };
      }
      return { sources: [{ url: "https://blog/old", title: "旧帖", snippet: "旧" }] };
    });
    let factRuns = 0;
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: [atom],
            claimAtomTypes: [{ text: atom, verifiable: true, type: "prediction" }],
          },
        };
      }
      if (agentId === "fact_checker") {
        factRuns += 1;
        // v1/v2 未解决；v3（拿到当事方回应后）翻案为 false
        const verdict = factRuns >= 3 ? "false" : "unverified";
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: verdict,
            subclaimVerdicts: [{ claimAtom: atom, verdict }],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: atom,
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: [{ atom, supported: true, reason: "ok" }] },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。" },
      }),
    });

    // pass1（官方通报命中）+ 重判未解决 + pass2（当事方命中）+ 重判收敛 = fact_checker 共 3 次
    expect(factRuns).toBe(3);
    expect(result.evidenceLoop?.passes).toBe(2);
    // 轮次跨 pass 连续编号：round 1（官方词）+ round 3（当事方，续期策略）
    const roundNos = result.evidenceLoop?.atoms[0]?.rounds.map((r) => r.round);
    expect(roundNos).toEqual([1, 3]);
    // 两个 pass 各拿进一条新来源，均入 bundle
    expect(result.evidenceLoop?.totalNewSources).toBe(2);
    expect(searchOne.mock.calls.some((c) => c[0].includes("当事方"))).toBe(true);
    // 收敛判停：最终 factStep 是 v3 翻案结果
    expect(result.factStep.output.factCheckResult).toBe("false");
  });

  it("翻案续期：pass1 命中但重判已收敛 → 不再发起 pass2（问完了就停）", async () => {
    const atom = "某说法";
    const searchOne = vi.fn(async (query: string) => {
      if (query.includes("官方通报")) {
        return { sources: [{ url: "https://gov.cn/n2", title: "官方通报", snippet: "口径" }] };
      }
      return { sources: [{ url: "https://blog/old", title: "旧帖", snippet: "旧" }] };
    });
    let factRuns = 0;
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: [atom],
            claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
          },
        };
      }
      if (agentId === "fact_checker") {
        factRuns += 1;
        const verdict = factRuns === 1 ? "unverified" : "false";
        return {
          agent: "fact_checker",
          output: { factCheckResult: verdict, subclaimVerdicts: [{ claimAtom: atom, verdict }] },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: atom,
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: [{ atom, supported: true, reason: "ok" }] },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。" },
      }),
    });

    // pass1 命中 → 重判翻案 false → 无未解决原子 → 收敛即停，不进 pass2
    expect(factRuns).toBe(2);
    expect(result.evidenceLoop?.passes).toBe(1);
    expect(searchOne.mock.calls.some((c) => c[0].includes("当事方"))).toBe(false);
  });

  it("原子级守门：有据之真 + 假 → mixed 救回（整句判词跟原子走，不跟 LLM 整体字段走）", async () => {
    const atoms = ["每天喝红酒可以预防心脏病", "法国人喝红酒"];
    const searchOne = vi.fn(async (q: string) => ({
      sources: [{ url: `https://t.test/${encodeURIComponent(q)}`, title: q, snippet: "s" }],
    }));
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: atoms,
            claimAtomTypes: atoms.map((t) => ({ text: t, verifiable: true, type: "causal" })),
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "false", // LLM 整体字段漂移：原子明明真假交织
            subclaimVerdicts: [
              {
                claimAtom: atoms[0],
                verdict: "false",
                contradictingSources: [{ url: `https://t.test/${encodeURIComponent(atoms[0])}` }],
              },
              {
                claimAtom: atoms[1],
                verdict: "true",
                supportingSources: [{ url: `https://t.test/${encodeURIComponent(atoms[1])}` }],
              },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      if (agentId === "alternative_explanation_searcher" || agentId === "counter_evidence_grader") {
        return { agent: agentId, output: {} };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    let finalizeSawFactResult = "";
    const result = await runCasePipeline({
      claim: "每天喝红酒可以预防心脏病，因为法国人喝红酒且心脏病少",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: atoms.map((a) => ({ atom: a, supported: true, reason: "ok" })) },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。" },
      }),
      finalizeReport: ({ factStep }) => {
        finalizeSawFactResult = String(
          (factStep.output as Record<string, unknown>).factCheckResult
        );
      },
    });

    // 整句救回 mixed：真的部分（法国人喝红酒）不被一起否掉
    expect(result.finalReport.verdictType).toBe("mixed_misleading");
    expect(String(result.finalReport.conclusion)).not.toMatch(/^(能信|不能信|只能信一部分|有真有假|部分成立|还查不清)/);
    expect(result.finalReport.faceVerdict).toBe("有真有假");
    expect(result.finalReport._mixedGuard).toBeTruthy();
    // 公式输入也被纠正为 partial（false → cap 15 不再触发）
    expect((result.factStep.output as Record<string, unknown>).factCheckResult).toBe("partial");
    expect((result.factStep.output as Record<string, unknown>)._factCheckResultDerived).toMatchObject(
      { from: "false", to: "partial" }
    );
    expect(finalizeSawFactResult).toBe("partial");
  });

  it("原子级守门：真无据不救 → 保持 false（纯谣言不受零星 true 判词干扰）", async () => {
    const atoms = ["某食品能治百病", "某食品是食品"];
    const searchOne = vi.fn(async (q: string) => ({
      sources: [{ url: `https://t.test/${encodeURIComponent(q)}`, title: q, snippet: "s" }],
    }));
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: atoms,
            claimAtomTypes: atoms.map((t) => ({ text: t, verifiable: true, type: "fact" })),
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "false",
            subclaimVerdicts: [
              {
                claimAtom: atoms[0],
                verdict: "false",
                contradictingSources: [{ url: `https://t.test/${encodeURIComponent(atoms[0])}` }],
              },
              // true 但无 supportingSources（或 URL 不在 bundle）→ 无据之真
              { claimAtom: atoms[1], verdict: "true", supportingSources: [] },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "low" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: "某食品能治百病",
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: atoms.map((a) => ({ atom: a, supported: true, reason: "ok" })) },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "false", conclusion: "不能信。" },
      }),
    });

    expect(result.finalReport.verdictType).toBe("false");
    expect(result.finalReport._mixedGuard).toBeUndefined();
    expect((result.factStep.output as Record<string, unknown>).factCheckResult).toBe("false");
  });

  it("cross exam：独立意见没有具体质询时不追加回应、不按分歧降分", async () => {
    const conflictAtom = "某地明天下雪";
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: [conflictAtom],
            claimAtomTypes: [{ text: conflictAtom, verifiable: true, type: "fact" }],
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "true",
            subclaimVerdicts: [
              {
                claimAtom: conflictAtom,
                verdict: "true",
                supportingSources: [{ url: "https://s/1" }],
                contradictingSources: [{ url: "https://c/1" }],
              },
            ],
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: conflictAtom,
      runAgent,
      searchOne: async () => ({
        sources: [
          { url: "https://s/1", title: "支撑", snippet: "气象预报" },
          { url: "https://c/1", title: "反证", snippet: "辟谣" },
        ],
      }),
      callSelfProofModel: async () => ({
        output: { results: [{ atom: conflictAtom, supported: true, reason: "ok" }] },
        model: "selfproof-m",
      }),
      crossExam: {
        callRaw: async () => ({
          output: { verdict: "false", reason: "反证来自官方辟谣", boundary: "不能支持下雪说法" },
          model: "MiniMax-M3",
        }),
      },
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "true", conclusion: "能信。", credibilityScore: 72 },
      }),
    });

    // 触发：判词支撑反证同时非空
    expect(result.crossExam?.ran).toBe(true);
    expect(result.crossExam?.atoms[0]?.relation).toBe("disagree");
    // 独立复核进 steps，分歧不机械降分。
    expect(result.crossExam?.confidenceAdjustment).toBe(0);
    expect(result.steps.some((s) => s.agent === "cross_examiner")).toBe(true);
    expect(result.finalReport.crossExam).toMatchObject({ adjustment: 0, model: "MiniMax-M3" });
    expect(result.finalReport.credibilityScore).toBe(72);
    // 判词不被重写
    expect(result.factStep.output.factCheckResult).toBe("true");
  });

  it("proposes memory candidates into store when memoryCandidateStore is provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipeline-mem-"));
    const store = new JsonlMemoryCandidateStore(join(dir, "candidates.jsonl"));
    const onMemoryWriteStart = vi.fn();
    const onMemoryWriteResult = vi.fn();

    try {
      const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
        if (agentId === "rumor_detector") {
          return {
            agent: "rumor_detector",
            output: {
              claimAtoms: ["事实A"],
              claimAtomTypes: [{ text: "事实A", verifiable: true, type: "fact" }],
            },
          };
        }
        if (agentId === "fact_checker") {
          return { agent: "fact_checker", output: { factCheckResult: "partial", subclaimVerdicts: [] } };
        }
        if (agentId === "source_validator") {
          return { agent: "source_validator", output: { sourceReliability: "medium" } };
        }
        throw new Error(`unexpected ${agentId}`);
      });

      const result = await runCasePipeline({
        claim: "记忆候选应写入 store",
        runId: "run-pipeline-mem",
        runAgent,
        searchOne: async () => ({
          answer: "a",
          model: "m",
          sources: [{ url: "https://example.org/a", title: "A", snippet: "s" }],
        }),
        callSelfProofModel: async () => ({
          output: { results: [{ atom: "事实A", supported: true, reason: "ok" }] },
          model: "selfproof-m",
        }),
        runReport: async () => ({
          agent: "report_composer",
          output: {
            verdictType: "mixed_misleading",
            conclusion: "可复用结论边界",
            credibilityScore: 48,
            summaryForPublic: "公众版结论",
          },
        }),
        memoryCandidateStore: store,
        hooks: { onMemoryWriteStart, onMemoryWriteResult },
      });

      expect(onMemoryWriteStart).toHaveBeenCalledOnce();
      expect(onMemoryWriteResult).toHaveBeenCalledOnce();
      expect(onMemoryWriteResult.mock.calls[0][0].proposedCandidateCount).toBe(result.memoryCandidates.length);
      expect(result.memoryCandidates.length).toBeGreaterThanOrEqual(1);

      const listed = await store.list();
      expect(listed.length).toBe(result.memoryCandidates.length);
      expect(listed.every((c) => c.provenance.runId === "run-pipeline-mem")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("7 条可核查时含导致的第 7 条进检索，未入选条仍在 claimItems 且 unverified", async () => {
    const atoms = [
      "背景一",
      "背景二",
      "背景三",
      "背景四",
      "背景五",
      "背景六",
      "隔夜菜导致癌症",
    ];
    const searchOne = vi.fn(async (atom: string) => ({
      sources: [{ url: `https://t.test/${encodeURIComponent(atom)}`, title: atom, snippet: "s" }],
    }));
    const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
      if (agentId === "rumor_detector") {
        return {
          agent: "rumor_detector",
          output: {
            claimAtoms: atoms,
            claimAtomTypes: atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
          },
        };
      }
      if (agentId === "fact_checker") {
        return {
          agent: "fact_checker",
          output: {
            factCheckResult: "unverified",
            subclaimVerdicts: atoms.map((claimAtom) => ({
              claimAtom,
              verdict: "true",
              supportingSources: [],
            })),
          },
        };
      }
      if (agentId === "source_validator") {
        return { agent: "source_validator", output: { sourceReliability: "medium" } };
      }
      throw new Error(`unexpected ${agentId}`);
    });

    const result = await runCasePipeline({
      claim: atoms.join("。"),
      runAgent,
      searchOne,
      callSelfProofModel: async () => ({
        output: { results: atoms.map((atom) => ({ atom, supported: true, reason: "ok" })) },
        model: "selfproof-m",
      }),
      runReport: async () => ({
        agent: "report_composer",
        output: { verdictType: "true", conclusion: "能信。" },
      }),
      evidenceLoop: { enabled: false },
    });

    const searched = searchOne.mock.calls.map((call) => call[0] as string);
    expect(searched).toHaveLength(6);
    expect(searched).toContain("隔夜菜导致癌症");
    expect(searched).not.toContain("背景六");
    const items = result.finalReport.claimItems as Array<{ text: string; verdict?: { verdict?: string; evidenceGaps?: string[] } }>;
    expect(items.map((item) => item.text)).toEqual(atoms);
    const dropped = items.find((item) => item.text === "背景六");
    expect(dropped?.verdict?.verdict).toBe("unverified");
    expect(dropped?.verdict?.evidenceGaps?.some((gap) => gap.includes("检索预算未覆盖"))).toBe(true);
    expect(result.finalReport.faceVerdict).toBe("还查不清");
  });
});

describe("runCasePipeline abort（B1 僵尸流水线回归）", () => {
  const stubRunReport = async (): Promise<PipelineStep> => ({
    agent: "report_composer",
    output: { verdictType: "unverified", conclusion: "c" },
  });

  it("信号已 abort 时立即拒绝，一个 agent 都不调用", async () => {
    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn();
    await expect(
      runCasePipeline({
        claim: "测试句",
        runAgent,
        searchOne: async () => ({ answer: "", model: "m", sources: [] }),
        callSelfProofModel: async () => ({ output: { results: [] }, model: "m" }),
        runReport: stubRunReport,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("阶段中途 abort 后在下一边界终止，跳过后续 LLM 与检索", async () => {
    const controller = new AbortController();
    const searchOne = vi.fn(async () => ({ answer: "", model: "m", sources: [] }));
    const callSelfProofModel = vi.fn(async () => ({ output: { results: [] }, model: "m" }));
    const runAgent = vi.fn(async (): Promise<PipelineStep> => {
      controller.abort(new Error("client-disconnected"));
      return {
        agent: "rumor_detector",
        output: {
          claimAtoms: ["A"],
          claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
        },
      };
    });
    await expect(
      runCasePipeline({
        claim: "A",
        runAgent,
        searchOne,
        callSelfProofModel,
        runReport: stubRunReport,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
    expect(callSelfProofModel).not.toHaveBeenCalled();
    expect(searchOne).not.toHaveBeenCalled();
  });
});
