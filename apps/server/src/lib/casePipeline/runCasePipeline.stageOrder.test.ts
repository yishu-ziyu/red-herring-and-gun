/**
 * 阶段顺序表征：一次所有阶段都会跑的调查，按时间记下对外的每一次调用与每一份快照。
 *
 * 其余管线测试各守一个阶段的行为，阶段之间的先后只有本机 golden 录音能发现（2026-09-29 变异检查：
 * 调换补查与质询、调换因果增强与整句审计、挪动审计刷新，单元测试全都发现不了）。录音不进仓库，这条测试进。
 */
import { expect, it } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { confirmedSourceValidatorStep } from "./testSourceRelationAudit";

const A = "吃饭会使血糖升高";
const B = "胰岛素可以降低血糖";
const src = (tag: string) => ({ url: `https://t.test/${tag}`, title: `来源${tag}`, snippet: `${tag} 的摘要` });

it("阶段顺序：拆题 → 检索 → 核查 → 补查 → 质询 → 审计刷新 → 因果增强 → 整句审计 → 报告 → 收尾 → 记忆", async () => {
  const events: string[] = [];
  let factCalls = 0;
  let sourceCalls = 0;
  const runAgent = async (agentId: string, steps: PipelineStep[]): Promise<PipelineStep> => {
    events.push(`agent:${agentId}`);
    if (agentId === "rumor_detector") {
      return {
        agent: agentId,
        output: {
          claimAtoms: [A, B],
          claimAtomTypes: [
            { text: A, verifiable: true, type: "causal" },
            { text: B, verifiable: true, type: "fact" },
          ],
        },
      };
    }
    if (agentId === "source_validator") {
      sourceCalls += 1;
      // 第 3 次审计（整句审计补查之后）失败：新来源只能等报告前的最后一次刷新。
      if (sourceCalls === 3) throw new Error("source validator down");
      return confirmedSourceValidatorStep(steps, "medium");
    }
    if (agentId === "fact_checker") {
      factCalls += 1;
      // 第 1 次：A 查不清（触发补查），B 有据但带缺口（触发质询）。
      // 第 2 次是质询后的回应，缺回应说明 → 质询不采纳，也就不在质询里刷新审计。
      // 第 3 次是整句审计补查后的重判：B 引用了补查拿到的新来源。
      const bSources = factCalls === 3 ? [src("b"), src("b-audit")] : [src("b")];
      return {
        agent: agentId,
        output: {
          factCheckResult: "partial",
          subclaimVerdicts: [
            { claimAtom: A, verdict: "unverified", evidence: "", supportingSources: [], contradictingSources: [] },
            {
              claimAtom: B,
              verdict: "true",
              evidence: "胰岛素降低血糖[1]。",
              evidenceGaps: ["剂量与适用人群"],
              supportingSources: bSources,
              contradictingSources: [],
            },
          ],
        },
      };
    }
    return { agent: agentId, output: { note: agentId } };
  };
  const searchOne = async (query: string) => {
    const tag = query.includes(A)
      ? query === A ? "a" : "a-more"
      : query.includes("剂量") ? "b-dose" : query.includes("适用人群") ? "b-audit" : query === B ? "b" : "other";
    events.push(`search:${tag}`);
    return { answer: "", model: "m", sources: [src(tag)] };
  };
  const result = await runCasePipeline({
    claim: `${A}，${B}。`,
    runAgent,
    searchOne,
    callSelfProofModel: async () => {
      events.push("selfProof");
      return { output: { results: [A, B].map((atom) => ({ atom, supported: true, reason: "ok" })) }, model: "self" };
    },
    wholeClaimAudit: {
      callModel: async ({ systemPrompt }) => {
        const evaluation = systemPrompt.includes("整句证据评估器");
        events.push(evaluation ? "audit:evaluate" : "audit:plan");
        return evaluation
          ? {
              model: "audit",
              output: {
                supportedWhere: "两条命题都有来源",
                biggestGap: "剂量",
                missingJustifications: [],
                nextQuestions: [{ question: "胰岛素适用于哪些人", targetClaimAtom: B, suggestedQuery: `${B} 适用人群` }],
              },
            }
          : { model: "audit", output: { overallQuestion: "吃饭与胰岛素", checkabilityRevisions: [], missingJustifications: [], auditQuestions: [] } };
      },
    },
    crossExam: {
      callRaw: async () => {
        events.push("crossExam:secondOpinion");
        return { model: "second", output: { verdict: "true", reason: "同意", challenge: "剂量是否因人而异？", query: `${B} 剂量`, sources: [src("b").url] } };
      },
    },
    citationLiveness: { liveness: new Map() },
    runReport: async ({ steps }) => {
      events.push("report");
      return runAgent("report_composer", steps).then((step) => ({ ...step, output: { verdictType: "true", conclusion: "两条都站得住。" } }));
    },
    finalizeReport: () => {
      events.push("finalizeHook");
    },
    hooks: {
      // 核查之后的快照带上每条命题的判断与证据方向，审计刷新挪位或漏掉「重算判词」都会改变它。
      onInvestigationSnapshot: (snapshot) =>
        events.push(
          snapshot.phase === "judging" || snapshot.phase === "complete"
            ? `snapshot:${snapshot.phase} ${snapshot.claims.map((c) => `${c.judgment ?? "-"}/${c.evidence.map((e) => e.role).join(",")}`).join(" ")}`
            : `snapshot:${snapshot.phase}`,
        ),
      onSelfProof: () => events.push("hook:selfProof"),
      onEvidenceLoopStart: () => events.push("hook:evidenceLoopStart"),
      afterFactSource: async () => {
        events.push("hook:afterFactSource");
      },
      onReportReviewStart: () => events.push("hook:reviewStart"),
      onReportReviewResult: () => events.push("hook:reviewResult"),
      onMemoryWriteStart: () => events.push("hook:memoryStart"),
      onMemoryWriteResult: () => events.push("hook:memoryResult"),
    },
  });

  expect(result.crossExam?.ran).toBe(true);
  expect(result.evidenceLoop?.ran).toBe(true);
  expect(events).toEqual([
    // 拆题：命题一出来先上屏，再自证、整句审计规划
    "snapshot:received",
    "agent:rumor_detector",
    "snapshot:decomposed",
    "selfProof",
    "hook:selfProof",
    "audit:plan",
    "snapshot:decomposed",
    // 检索：逐命题
    "snapshot:investigating",
    "search:a",
    "snapshot:investigating",
    "search:b",
    "snapshot:investigating",
    // 核查 → 来源审计 → 首份 judging 快照
    "agent:fact_checker",
    "agent:source_validator",
    "snapshot:judging unresolved/context-only supported/support",
    // 证据补查（没拿到能翻案的新证据，不重判）
    "hook:evidenceLoopStart",
    "search:a-more",
    "search:a-more",
    "search:a-more",
    "search:a-more",
    "snapshot:judging unresolved/context-only,context-only supported/support",
    // 质询：第二意见 → 定向补查 → 主调查回应（缺回应说明，不采纳）
    "crossExam:secondOpinion",
    "search:b-dose",
    "agent:fact_checker",
    // 补查、质询加了新来源：先刷新审计，再发快照
    "agent:source_validator",
    "snapshot:judging unresolved/context-only,context-only supported/support,context-only",
    "hook:afterFactSource",
    // 因果增强
    "agent:alternative_explanation_searcher",
    "agent:counter_evidence_grader",
    // 整句审计：评估 → 补查 → 重判 → 审计（失败）→ 快照
    "audit:evaluate",
    "search:b-audit",
    "agent:fact_checker",
    "agent:source_validator",
    "snapshot:judging unresolved/context-only,context-only supported/support,context-only,context-only",
    // 报告前最后一次刷新：整句审计补查的新来源没审过
    "agent:source_validator",
    // 报告 → 收尾 → 完成快照 → 记忆
    "report",
    "agent:report_composer",
    "finalizeHook",
    "hook:reviewStart",
    "snapshot:complete unresolved/context-only,context-only supported/support,context-only,context-only",
    "hook:reviewResult",
    "hook:memoryStart",
    "hook:memoryResult",
  ]);
});
