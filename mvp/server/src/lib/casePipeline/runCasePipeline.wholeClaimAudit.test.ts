/**
 * Issue #78 Whole-Claim Audit — pipeline 集成回归（8 类 case）。
 *
 * Case 1 纯政策偏好不机械变可核查；Case 2 externally-grounded recommendation 进证据链；
 * Case 3 说明书型；Case 4 前提真 ≠ 结论成立；Case 5 #78 真实失败形状被收权；
 * Case 6 LM prior 不是 Evidence；Case 7 长尾措辞由模型决策覆盖；Case 8 不注入审计时
 * legacy 行为不回归。
 *
 * 测试允许 mock LM structured output；生产实现不含这些措辞关键词（措辞只出现在
 * mock 的输入输出里，代码路径对任何措辞一视同仁）。
 */
import { describe, expect, it, vi } from "vitest";
import { runCasePipeline } from "./runCasePipeline";
import type { PipelineStep } from "./runCasePipeline";
import type { InvestigationSnapshotV1 } from "../investigation/index.js";
import { buildAgentInput } from "../agentConfigs.js";
import { directAnswer } from "../publicCopy.js";
import type { LivenessStatus } from "../citationLiveness.js";

const url = (atom: string, tag = "src") => `https://t.test/${encodeURIComponent(atom)}/${tag}`;

type AgentOutput = Record<string, unknown>;

function factStep(output: AgentOutput): PipelineStep {
  return { agent: "fact_checker", output, status: "completed", timestamp: Date.now() };
}

function composerStep(output: AgentOutput): PipelineStep {
  return { agent: "report_composer", output, status: "completed", timestamp: Date.now() };
}

/** 标准单原子 rumor step。 */
function rumorStep(atoms: Array<{ text: string; verifiable: boolean; type: string }>): PipelineStep {
  return {
    agent: "rumor_detector",
    output: {
      claimAtoms: atoms.map((a) => a.text),
      claimAtomTypes: atoms,
    },
    status: "completed",
    timestamp: Date.now(),
  };
}

interface HarnessResult {
  result: Awaited<ReturnType<typeof runCasePipeline>>;
  searchQueries: string[];
  snapshots: InvestigationSnapshotV1[];
  auditCalls: Array<{ system: string; user: string }>;
}

/**
 * 装一个最小管线：rumor/self-proof 由调用方给定；fact/source/composer 由
 * factOutputs / composerOutput 决定；searchOne 按 atom → sources 映射。
 */
async function runHarness(input: {
  claim: string;
  rumor: PipelineStep;
  selfProofAtoms?: string[];
  factOutputs: AgentOutput[];
  composerOutput: AgentOutput;
  searchPlan?: Record<string, Array<{ url: string; title: string; snippet: string }>>;
  auditPlanOutput?: AgentOutput | null;
  auditEvalOutput?: AgentOutput | null;
  auditEvalOutputs?: AgentOutput[];
  /** citationLiveness 注入：传 Map 做确定性探活；不传走真实网络。 */
  citationLiveness?: Map<string, LivenessStatus>;
  crossExamCallRaw?: unknown;
}): Promise<HarnessResult> {
  const searchQueries: string[] = [];
  const snapshots: InvestigationSnapshotV1[] = [];
  const auditCalls: Array<{ system: string; user: string }> = [];
  const searchPlan = input.searchPlan ?? {};
  let factCallCount = 0;

  const runAgent = vi.fn(async (agentId: string, _steps: PipelineStep[]): Promise<PipelineStep> => {
    if (agentId === "rumor_detector") return input.rumor;
    if (agentId === "fact_checker") {
      const output = input.factOutputs[Math.min(factCallCount, input.factOutputs.length - 1)];
      factCallCount += 1;
      if (output && (output as { __throw?: unknown }).__throw) {
        throw new Error(String((output as { __throw?: unknown }).__throw));
      }
      return factStep(output);
    }
    if (agentId === "source_validator") {
      return { agent: "source_validator", output: { sourceReliability: "medium" }, timestamp: Date.now() };
    }
    if (agentId === "report_composer") return composerStep(input.composerOutput);
    throw new Error(`unexpected ${agentId}`);
  });

  const searchOne = vi.fn(async (query: string) => {
    searchQueries.push(query);
    for (const [atom, sources] of Object.entries(searchPlan)) {
      if (query.includes(atom)) return { answer: "", model: "m", sources };
    }
    return { answer: "", model: "m", sources: [] };
  });

  const callSelfProofModel = async () => ({
    output: {
      results: (input.selfProofAtoms ?? (input.rumor.output.claimAtoms as string[])).map((atom) => ({
        atom,
        supported: true,
        reason: "ok",
      })),
    },
    model: "selfproof-m",
  });

  const auditCallModel =
    input.auditPlanOutput !== undefined
      ? async (call: { systemPrompt: string; userContent: string }) => {
          auditCalls.push({ system: call.systemPrompt, user: call.userContent });
          const isEval = call.systemPrompt.includes("整句证据评估器");
          if (isEval && input.auditEvalOutputs && input.auditEvalOutputs.length > 0) {
            const output = input.auditEvalOutputs.shift();
            return { output, model: "audit-mock" };
          }
          const output = isEval ? input.auditEvalOutput : input.auditPlanOutput;
          return { output, model: "audit-mock" };
        }
      : undefined;

  const result = await runCasePipeline({
    claim: input.claim,
    runAgent,
    searchOne,
    callSelfProofModel,
    ...(auditCallModel ? { wholeClaimAudit: { callModel: auditCallModel } } : {}),
    ...(input.citationLiveness ? { citationLiveness: { liveness: input.citationLiveness } } : {}),
    runReport: async ({ steps, search360Result, atomSearchBundle }) =>
      runAgent("report_composer", steps, search360Result, atomSearchBundle),
    hooks: {
      onInvestigationSnapshot: (snapshot) => snapshots.push(snapshot),
    },
  });
  return { result, searchQueries, snapshots, auditCalls };
}

// ───────────────────────────────────────────────────────────────
// Case 1：纯政策偏好 —— 不因「政府/禁止」等词机械变可核查
// ───────────────────────────────────────────────────────────────
describe("Case 1：纯政策偏好", () => {
  it("政府应该禁止短视频：审计不修订 → 保持 not-applicable；整句硬判定被收权", async () => {
    const atomText = "政府应该禁止短视频";
    const { result, searchQueries, snapshots, auditCalls } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: false, type: "value" }]),
      factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
      // composer 无视立场型状态硬写 false —— 收权门必须兜住
      composerOutput: { verdictType: "false", conclusion: "该主张不成立。" },
      auditPlanOutput: {
        overallQuestion: "政府是否应当禁止短视频（政策偏好）",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "纯政策偏好，没有外部标准决定真伪",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
    });

    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    expect(searchQueries).toEqual([]); // 不检索
    expect(result.finalReport.nonVerifiableAtoms).toEqual([{ text: atomText, type: "value" }]);
    expect(result.finalReport.verdictType).toBe("unverified");
    expect((result.finalReport._conclusionGate as Record<string, unknown>).rule).toBe(
      "all-atoms-not-applicable"
    );
    const complete = snapshots.at(-1)!;
    expect(complete.claims[0]).toMatchObject({ checkability: "not-applicable", judgment: "not-applicable" });
    expect(complete.conclusion?.judgment).toBe("not-applicable");
  });
});

// ───────────────────────────────────────────────────────────────
// Case 2：externally-grounded recommendation —— 允许 normative+verifiable=true
// ───────────────────────────────────────────────────────────────
describe("Case 2：每次感冒都应当输液", () => {
  it("模型判定有外部标准 → 提升为可核查、type 保持 normative、进入证据链、有反证时可 refuted", async () => {
    const atomText = "每次感冒都应当输液";
    const sourceUrl = url(atomText, "guideline");
    const { result, searchQueries, snapshots } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: false, type: "normative" }]),
      factOutputs: [
        {
          factCheckResult: "false",
          subclaimVerdicts: [
            {
              claimAtom: atomText,
              verdict: "false",
              evidence: "指南不支持普遍输液。",
              boundary: "普遍性主张不成立",
              supportingSources: [],
              contradictingSources: [{ url: sourceUrl, title: "指南", snippet: "s" }],
            },
          ],
        },
      ],
      composerOutput: {
        verdictType: "false",
        conclusion: "普通感冒无需静脉输液。",
        subclaimVerdicts: [
          {
            claimAtom: atomText,
            verdict: "false",
            evidence: "指南不支持普遍输液。",
            boundary: "b",
            supportingSources: [],
            contradictingSources: [{ url: sourceUrl, title: "指南", snippet: "s" }],
          },
        ],
      },
      searchPlan: { [atomText]: [{ url: sourceUrl, title: "指南", snippet: "s" }] },
      // 反证来源存活是本用例的前提（断言 refuted 与可下钻），注入 alive 使其 hermetic
      citationLiveness: new Map([[sourceUrl, "alive"]]),
      auditPlanOutput: {
        overallQuestion: "感冒普遍输液是否有医学标准支撑",
        checkabilityRevisions: [
          { claimAtom: atomText, verifiable: true, reason: "可由医学指南与适应症核查" },
        ],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "有指南反证",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
    });

    // 提升后被检索（不因「应当」二字机械排除）
    expect(searchQueries.some((q) => q.includes(atomText))).toBe(true);
    // type 保持 normative，没有被改写成 fact
    expect(result.rumorStep.output?.claimAtomTypes).toEqual([
      { text: atomText, verifiable: true, type: "normative" },
    ]);
    // 判词带绑定来源（可下钻）
    const verdict = (result.finalReport.subclaimVerdicts as Array<Record<string, unknown>>).find(
      (v) => v.claimAtom === atomText
    );
    expect(verdict).toBeTruthy();
    expect(verdict?.verdict).toBe("false");
    const complete = snapshots.at(-1)!;
    expect(complete.claims[0]).toMatchObject({ checkability: "checkable", judgment: "refuted" });
    expect(complete.claims[0].evidence.some((l) => l.role === "contradict")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Case 3：说明书型 recommendation
// ───────────────────────────────────────────────────────────────
describe("Case 3：这个药应该每天服三次", () => {
  it("存在说明书/规范作为外部标准时允许 normative+verifiable=true", async () => {
    const atomText = "这个药应该每天服三次";
    const { result, searchQueries } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: false, type: "normative" }]),
      factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
      composerOutput: { verdictType: "unverified", conclusion: "未找到说明书比对材料。" },
      searchPlan: { [atomText]: [{ url: url(atomText), title: "说明书", snippet: "s" }] },
      auditPlanOutput: {
        overallQuestion: "该药用法是否符合说明书规范",
        checkabilityRevisions: [
          { claimAtom: atomText, verifiable: true, reason: "可由药品说明书核查" },
        ],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "已检索说明书类来源，未获直接比对",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
    });
    expect(searchQueries.some((q) => q.includes(atomText))).toBe(true);
    expect(result.rumorStep.output?.claimAtomTypes).toEqual([
      { text: atomText, verifiable: true, type: "normative" },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────
// Case 4：premises true ≠ conclusion justified
// ───────────────────────────────────────────────────────────────
describe("Case 4：A+B 都真推不出 C", () => {
  it("A、B 有据支持、C 未核实、audit 桥接缺口未解决 → 整句 true 收成 unverified，C 不被写成成立", async () => {
    const a = "吃饭会使血糖升高";
    const b = "胰岛素可以降低血糖";
    const c = "所以所有人每顿饭后都应该注射胰岛素";
    const { result, snapshots } = await runHarness({
      claim: `${a}，${b}，${c}。`,
      rumor: rumorStep([
        { text: a, verifiable: true, type: "causal" },
        { text: b, verifiable: true, type: "fact" },
        { text: c, verifiable: true, type: "fact" },
      ]),
      factOutputs: [
        {
          factCheckResult: "true",
          subclaimVerdicts: [
            {
              claimAtom: a,
              verdict: "true",
              evidence: "e",
              boundary: "b",
              supportingSources: [{ url: url(a), title: "A来源", snippet: "s" }],
              contradictingSources: [],
            },
            {
              claimAtom: b,
              verdict: "true",
              evidence: "e",
              boundary: "b",
              supportingSources: [{ url: url(b), title: "B来源", snippet: "s" }],
              contradictingSources: [],
            },
            { claimAtom: c, verdict: "unverified", evidence: "", boundary: "", supportingSources: [], contradictingSources: [] },
          ],
        },
      ],
      composerOutput: { verdictType: "true", conclusion: "原句成立。" },
      searchPlan: {
        [a]: [{ url: url(a), title: "A来源", snippet: "s" }],
        [b]: [{ url: url(b), title: "B来源", snippet: "s" }],
        // c：检索无结果 → unverified
      },
      auditPlanOutput: {
        overallQuestion: "血糖机制能否推出普遍注射建议",
        checkabilityRevisions: [],
        missingJustifications: ["从 A、B 到 C 还缺适应症与普遍适用性依据"],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "A、B 有来源支持；C 没有独立依据",
        biggestGap: "缺 C 的适应症 / 普遍适用性依据",
        missingJustifications: ["A、B 真推不出 C，缺桥接依据"],
        nextQuestions: [
          {
            question: "指南是否支持普遍餐后注射胰岛素？",
            reason: "桥接缺口",
            targetClaimAtom: c,
            suggestedQuery: "胰岛素 适应症 指南",
          },
        ],
      },
    });

    const verdicts = result.finalReport.subclaimVerdicts as Array<Record<string, unknown>>;
    const cVerdict = verdicts.find((v) => v.claimAtom === c);
    expect(cVerdict?.verdict).toBe("unverified"); // C 不被写成成立
    // 整句 true 被收权门收成 unverified（audit 缺口未解决）
    expect(result.finalReport.verdictType).toBe("unverified");
    expect((result.finalReport._conclusionGate as Record<string, unknown>).rule).toBe(
      "audit-unresolved-bridge-gap"
    );
    const complete = snapshots.at(-1)!;
    expect(complete.claims.find((cl) => cl.text === c)?.judgment).toBe("unresolved");
    expect(complete.conclusion?.judgment).toBe("unresolved");
  });
});

// ───────────────────────────────────────────────────────────────
// Case 5：#78 真实失败形状 —— not-applicable 命题不得被写成已证伪
// ───────────────────────────────────────────────────────────────
describe("Case 5：#78 failure shape", () => {
  it("claim-1 partial 带来源、claim-2 not-applicable evidence=[]，composer 硬写 false → 收成 mixed_misleading", async () => {
    const c1 = "维生素C能治感冒";
    const c2 = "每次感冒都应当输液";
    const { result, snapshots } = await runHarness({
      claim: `${c1}，而且${c2}。`,
      rumor: rumorStep([
        { text: c1, verifiable: true, type: "fact" },
        { text: c2, verifiable: false, type: "normative" },
      ]),
      factOutputs: [
        {
          factCheckResult: "false",
          subclaimVerdicts: [
            {
              claimAtom: c1,
              verdict: "partial",
              evidence: "仅可能略微缓解症状。",
              boundary: "撑不到治愈",
              supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
              contradictingSources: [],
            },
          ],
        },
      ],
      composerOutput: {
        verdictType: "false",
        conclusion: "两条主张均不成立，普通感冒无需输液。",
        subclaimVerdicts: [
          {
            claimAtom: c1,
            verdict: "partial",
            evidence: "仅可能略微缓解症状。",
            boundary: "撑不到治愈",
            supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
            contradictingSources: [],
          },
        ],
      },
      searchPlan: { [c1]: [{ url: url(c1), title: "研究", snippet: "s" }] },
      auditPlanOutput: {
        overallQuestion: "维C疗效与普遍输液建议是否成立",
        checkabilityRevisions: [], // 审计未判定 c2 有外部标准 → 保持 not-applicable
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "c1 仅部分成立；c2 未核查",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
    });

    // 整句 false 没有 sourced-false 原子支撑 → 被收权（mixedGuard 先收成 mixed_misleading；
    // 无 mixedGuard 形状时由 conclusionGate 的 false-without-sourced-false-atom 收，见单元测试）
    expect(result.finalReport.verdictType === "mixed_misleading" || result.finalReport.verdictType === "unverified").toBe(true);
    expect(result.finalReport.verdictType).not.toBe("false");
    // claim-2 保持 not-applicable / evidence=[]，不得贡献 supported/refuted
    expect(result.finalReport.nonVerifiableAtoms).toEqual([{ text: c2, type: "normative" }]);
    const complete = snapshots.at(-1)!;
    const claim2 = complete.claims.find((cl) => cl.text === c2)!;
    expect(claim2).toMatchObject({ checkability: "not-applicable", judgment: "not-applicable", evidence: [] });
    // 整句结论不得是 refuted
    expect(complete.conclusion?.judgment).not.toBe("refuted");
  });

  it("Blocker 1 回归：收权后最终 directAnswer 不得再把 not-applicable Claim 写成已证伪，且保留可核查部分结论", async () => {
    const c1 = "维生素C能治感冒";
    const c2 = "每次感冒都应当输液";
    const overclaim = "两条主张均不成立，普通感冒无需输液。";
    const { result, snapshots } = await runHarness({
      claim: `${c1}，而且${c2}。`,
      rumor: rumorStep([
        { text: c1, verifiable: true, type: "fact" },
        { text: c2, verifiable: false, type: "normative" },
      ]),
      factOutputs: [
        {
          factCheckResult: "false",
          subclaimVerdicts: [
            {
              claimAtom: c1,
              verdict: "partial",
              evidence: "仅可能略微缓解症状。",
              boundary: "撑不到治愈",
              supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
              contradictingSources: [],
            },
          ],
        },
      ],
      composerOutput: {
        verdictType: "false",
        conclusion: overclaim,
        subclaimVerdicts: [
          {
            claimAtom: c1,
            verdict: "partial",
            evidence: "仅可能略微缓解症状。",
            boundary: "撑不到治愈",
            supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
            contradictingSources: [],
          },
        ],
      },
      searchPlan: { [c1]: [{ url: url(c1), title: "研究", snippet: "s" }] },
      // 探活注入 alive：本用例不断言 liveness，来源必须存活到 repair，才能验证可核查部分被保留
      citationLiveness: new Map([[url(c1), "alive"]]),
      auditPlanOutput: {
        overallQuestion: "维C疗效与普遍输液建议是否成立",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "c1 仅部分成立；c2 未核查",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
    });

    const gated = String(result.finalReport.verdictType);
    expect(gated).not.toBe("false");
    // repair 触发标记
    expect((result.finalReport._conclusionGate as Record<string, unknown>).repaired).toBe(true);
    const complete = snapshots.at(-1)!;
    const finalDirectAnswer = complete.conclusion?.directAnswer ?? "";
    // 1) 最终用户可见文本以 gated verdict 的标准答案开头，与 verdictType 一致
    expect(finalDirectAnswer.startsWith(directAnswer(gated))).toBe(true);
    // 2) composer 的越权原文（把 c2 写成已证伪）已被替换，不再出现
    expect(finalDirectAnswer).not.toContain("均不成立");
    // 3) c2 只按"不适用真假判断"表述
    expect(finalDirectAnswer).toContain("不适用真假判断");
    // 4) 可核查 Claim 已有的部分结论保留
    expect(finalDirectAnswer).toContain("仅可能略微缓解症状");
    // 5) summary 与 recommendation 同步收权
    const summary = String(result.finalReport.summaryForPublic ?? "");
    expect(summary.startsWith(directAnswer(gated))).toBe(true);
    expect(summary).not.toContain("均不成立");
    expect(String(result.finalReport.recommendation ?? "")).toBe(directAnswer(gated));
    // 6) evidenceChain 有收权边界层
    const chain = result.finalReport.evidenceChain as Array<Record<string, unknown>>;
    expect(chain.some((layer) => layer.layer === "结论边界（整句收权）")).toBe(true);
  });

  it("Blocker 2 回归：not-applicable + on-topic debunk 来源时 legacy tiny-bound 不得把已收权整句推回 false", async () => {
    const c1 = "维生素C能治感冒";
    const c2 = "每次感冒都应当输液";
    const debunkUrl = "https://t.test/debunk-1";
    const { result, snapshots } = await runHarness({
      claim: `${c1}，而且${c2}。`,
      rumor: rumorStep([
        { text: c1, verifiable: true, type: "fact" },
        { text: c2, verifiable: false, type: "normative" },
      ]),
      factOutputs: [
        {
          factCheckResult: "false",
          subclaimVerdicts: [
            {
              claimAtom: c1,
              verdict: "partial",
              evidence: "仅可能略微缓解症状。",
              boundary: "撑不到治愈",
              supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
              contradictingSources: [],
            },
          ],
        },
      ],
      composerOutput: {
        verdictType: "false",
        conclusion: "两条主张均不成立，普通感冒无需输液。",
        subclaimVerdicts: [
          {
            claimAtom: c1,
            verdict: "partial",
            evidence: "仅可能略微缓解症状。",
            boundary: "撑不到治愈",
            supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
            contradictingSources: [],
          },
        ],
      },
      // c1 的检索聚合里混入一条 on-topic 辟谣来源：足以触发 legacy boundTiny=false，
      // 但整句含 not-applicable 成分且无 sourced-false 原子，contract 不允许硬 false。
      searchPlan: {
        [c1]: [
          { url: url(c1), title: "维生素C与感冒研究", snippet: "随机对照结果" },
          { url: debunkUrl, title: "感冒输液说法辟谣", snippet: "网传说法不实" },
        ],
      },
      auditPlanOutput: {
        overallQuestion: "维C疗效与普遍输液建议是否成立",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "c1 仅部分成立；c2 未核查",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
    });

    expect(result.finalReport.verdictType).not.toBe("false");
    expect(result.finalReport.verdictType === "mixed_misleading" || result.finalReport.verdictType === "unverified").toBe(true);
    const complete = snapshots.at(-1)!;
    expect(complete.conclusion?.judgment).not.toBe("refuted");
    expect(complete.claims.find((cl) => cl.text === c2)).toMatchObject({
      checkability: "not-applicable",
      judgment: "not-applicable",
    });
  });

  it("Blocker 3 回归：第一次 Evaluation 有 gap → extra pass 得新证据 → re-evaluation 关闭 gap → 允许证据支持的强度", async () => {
    const atomText = "某保健品能根治高血压";
    const debunkUrl = "https://t.test/clinical-1";
    const suggestedQuery = "根治高血压 临床试验";
    const { result, snapshots, auditCalls } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [
        {
          factCheckResult: "unverified",
          subclaimVerdicts: [
            {
              claimAtom: atomText,
              verdict: "unverified",
              evidence: "",
              boundary: "",
              supportingSources: [],
              contradictingSources: [],
            },
          ],
        },
        {
          factCheckResult: "false",
          subclaimVerdicts: [
            {
              claimAtom: atomText,
              verdict: "false",
              evidence: "临床试验未显示根治效果。",
              boundary: "b",
              supportingSources: [],
              contradictingSources: [{ url: debunkUrl, title: "高血压临床试验", snippet: "s" }],
            },
          ],
        },
      ],
      composerOutput: {
        verdictType: "false",
        conclusion: "该说法不成立，临床试验未显示根治效果。",
        subclaimVerdicts: [
          {
            claimAtom: atomText,
            verdict: "false",
            evidence: "临床试验未显示根治效果。",
            boundary: "b",
            supportingSources: [],
            contradictingSources: [{ url: debunkUrl, title: "高血压临床试验", snippet: "s" }],
          },
        ],
      },
      // 初轮检索无命中；audit 补查问题命中新来源
      searchPlan: {
        ["临床试验"]: [{ url: debunkUrl, title: "高血压临床试验", snippet: "未见根治证据" }],
      },
      // 反证来源存活到 liveness 之后，final gate 才能允许证据支持的 false
      citationLiveness: new Map([[debunkUrl, "alive"]]),
      auditPlanOutput: {
        overallQuestion: "该保健品是否有根治依据",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutputs: [
        {
          supportedWhere: "该命题尚未取得来源",
          biggestGap: "缺临床依据",
          missingJustifications: ["缺根治效果的临床依据"],
          nextQuestions: [
            {
              question: "临床试验是否支持根治？",
              reason: "缺核心依据",
              targetClaimAtom: atomText,
              suggestedQuery,
            },
          ],
        },
        {
          supportedWhere: "临床反证已取得，该命题不成立",
          biggestGap: "",
          missingJustifications: [],
          nextQuestions: [],
        },
      ],
    });

    // 第二次 Evaluation 确实跑了（Agent 根据新 observation 更新了判断）
    const evalCalls = auditCalls.filter((c) => c.system.includes("整句证据评估器"));
    expect(evalCalls).toHaveLength(2);
    expect(result.wholeClaimAudit.reevaluation).toMatchObject({ missingJustifications: [] });
    expect(result.wholeClaimAudit.extraPass).toMatchObject({ reevaluated: true, unresolvedQuestions: [] });
    // 重判真正提交：新 URL 进了 bind 后的 contradict relation
    expect(result.wholeClaimAudit.extraPass).toMatchObject({
      recheckCommitted: true,
      newlyBoundEvidenceUrlsByAtomKey: { [atomText]: [debunkUrl] },
    });
    // gap 已关闭 → gate 不再以 audit-unresolved-bridge-gap 收权，有 sourced-false 支撑时允许 false
    expect(result.finalReport.verdictType).toBe("false");
    const complete = snapshots.at(-1)!;
    expect(complete.conclusion?.judgment).toBe("refuted");
    expect((result.finalReport._conclusionGate as Record<string, unknown> | undefined)?.rule).not.toBe(
      "audit-unresolved-bridge-gap"
    );
  });
});

// ───────────────────────────────────────────────────────────────
// Case 6：LM prior 不是 Evidence
// ───────────────────────────────────────────────────────────────
describe("Case 6：audit 模型先验不得变成 Evidence / refuted", () => {
  it("audit 说「明显不合理」但没有工具来源 → 不产生 Evidence、不产生 refuted", async () => {
    const atomText = "某神奇疗法能三天治愈感冒";
    const { result, snapshots } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
      composerOutput: { verdictType: "true", conclusion: "原句成立。" },
      searchPlan: {}, // 检索零结果
      auditPlanOutput: {
        overallQuestion: "该疗法是否有证据",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [
          { question: "有没有对照试验？", reason: "模型先验认为不合理", suggestedQuery: "神奇疗法 对照试验" },
        ],
      },
      auditEvalOutput: {
        supportedWhere: "这个说法明显不合理",
        biggestGap: "没有任何来源",
        missingJustifications: ["缺任何工具来源"],
        nextQuestions: [],
      },
    });

    // 审计的先验判断没有创建任何来源 / Evidence
    const complete = snapshots.at(-1)!;
    expect(complete.sources).toEqual([]);
    expect(complete.claims[0].evidence).toEqual([]);
    expect(complete.claims[0].judgment).toBe("unresolved");
    // composer 硬 true 被收（无绑定 URL → reviewer 闸；audit 缺口未解决亦收）
    expect(["unverified"]).toContain(result.finalReport.verdictType);
    // 审计文本不进快照
    expect(JSON.stringify(complete)).not.toContain("明显不合理");
    expect(JSON.stringify(complete)).not.toContain("suggestedQuery");
  });
});

// ───────────────────────────────────────────────────────────────
// Case 7：长尾表达 —— 同一语义决策覆盖不同措辞（无字符串 special-case）
// ───────────────────────────────────────────────────────────────
describe("Case 7：长尾表达由模型语义决策覆盖", () => {
  const phrasings = ["每次感冒都应当输液", "感冒一律得挂水", "只要感冒就该打吊瓶"];

  for (const atomText of phrasings) {
    it(`「${atomText}」：模型判定有外部标准即提升并检索`, async () => {
      const { searchQueries } = await runHarness({
        claim: atomText,
        rumor: rumorStep([{ text: atomText, verifiable: false, type: "normative" }]),
        factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
        composerOutput: { verdictType: "unverified", conclusion: "待核查结论。" },
        searchPlan: { [atomText]: [{ url: url(atomText), title: "指南", snippet: "s" }] },
        auditPlanOutput: {
          overallQuestion: "该说法是否有医学标准",
          checkabilityRevisions: [
            { claimAtom: atomText, verifiable: true, reason: "存在外部专业标准可核查" },
          ],
          missingJustifications: [],
          auditQuestions: [],
        },
        auditEvalOutput: {
          supportedWhere: "已进入核查",
          biggestGap: "",
          missingJustifications: [],
          nextQuestions: [],
        },
      });
      expect(searchQueries.some((q) => q.includes(atomText))).toBe(true);
    });
  }
});

// ───────────────────────────────────────────────────────────────
// Case 8：不注入审计 → legacy 行为不回归
// ───────────────────────────────────────────────────────────────
describe("Case 8：不注入 Whole-Claim Audit 时 legacy 行为保持", () => {
  it("无 audit callModel：normative 仍被 forceCheckable legacy 判定为立场型，不写 audit artifact", async () => {
    const atomText = "每次感冒都应当输液";
    const { result, auditCalls } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: false, type: "normative" }]),
      factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
      composerOutput: { verdictType: "unverified", conclusion: "立场型命题不适用真/假判断。" },
      // 不传 auditPlanOutput → 不注入 audit
    });
    expect(auditCalls).toHaveLength(0);
    expect(result.wholeClaimAudit.plan).toBeNull();
    expect(result.wholeClaimAudit.evaluation).toBeNull();
    expect(result.rumorStep.output?.wholeClaimAuditPlan).toBeUndefined();
    expect(result.finalReport.nonVerifiableAtoms).toEqual([{ text: atomText, type: "normative" }]);
  });
});

// ───────────────────────────────────────────────────────────────
// §14：audit artifact 不进入 InvestigationSource / EvidenceLink
// ───────────────────────────────────────────────────────────────
describe("§14：audit artifact 不是 Evidence", () => {
  it("audit 问题 / 建议查询不产生 bundle 来源；只有 searchOne 结果才进证据", async () => {
    const atomText = "某疗法有效";
    const { result } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
      composerOutput: { verdictType: "unverified", conclusion: "c" },
      searchPlan: {}, // 检索零命中
      auditPlanOutput: {
        overallQuestion: "q",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [
          {
            question: "有没有对照试验？",
            reason: "r",
            targetClaimAtom: atomText,
            suggestedQuery: "对照试验 查证",
          },
        ],
      },
      auditEvalOutput: {
        supportedWhere: "s",
        biggestGap: "g",
        missingJustifications: ["缺对照试验来源"],
        nextQuestions: [],
      },
    });
    const bundle = result.atomSearchBundle;
    expect(bundle.byAtomKey[atomText] ?? []).toEqual([]);
    const complete = result.finalReport.investigation as InvestigationSnapshotV1;
    expect(complete.sources).toEqual([]);
    expect(complete.claims[0].evidence).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────
// Composer 输入收权上下文（agentConfigs.buildAgentInput）
// ───────────────────────────────────────────────────────────────
describe("ReportComposer 输入带收权上下文", () => {
  it("nonVerifiableAtoms 与 wholeClaimAudit 进入 composer 输入", () => {
    const rumor = {
      agent: "rumor_detector",
      output: {
        claimAtoms: ["每次感冒都应当输液", "维生素C能治感冒"],
        claimAtomTypes: [
          { text: "每次感冒都应当输液", verifiable: false, type: "normative" },
          { text: "维生素C能治感冒", verifiable: true, type: "fact" },
        ],
        wholeClaimAudit: {
          supportedWhere: "维C部分成立",
          biggestGap: "输液建议缺依据",
          missingJustifications: ["缺桥接依据"],
        },
      },
    };
    const fact = {
      agent: "fact_checker",
      output: {
        factCheckResult: "partial",
        subclaimVerdicts: [{ claimAtom: "维生素C能治感冒", verdict: "partial", evidence: "e", boundary: "b" }],
      },
    };
    const input = buildAgentInput("report_composer", "原句", [rumor, fact]);
    expect(input.nonVerifiableAtoms).toEqual([{ text: "每次感冒都应当输液", type: "normative" }]);
    expect(input.wholeClaimAudit).toMatchObject({ missingJustifications: ["缺桥接依据"] });
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128022550 Blocker 1A：唯一 support 死链 → 硬 true 不得保留
// ───────────────────────────────────────────────────────────────
describe("Blocker 1A：唯一 supporting 来源死链", () => {
  it("liveness 后支撑死光 → true 收为 unverified，Claim/Conclusion 同向，无无主引用", async () => {
    const atomText = "某新药能根治偏头痛";
    const supportUrl = url(atomText, "trial");
    const sourced = {
      claimAtom: atomText,
      verdict: "true",
      evidence: "试验显示有效。",
      boundary: "b",
      supportingSources: [{ url: supportUrl, title: "试验", snippet: "s" }],
      contradictingSources: [],
    };
    const { result, snapshots } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [{ factCheckResult: "true", subclaimVerdicts: [sourced] }],
      composerOutput: {
        verdictType: "true",
        conclusion: "该说法成立，有试验支持。",
        subclaimVerdicts: [sourced],
      },
      searchPlan: { [atomText]: [{ url: supportUrl, title: "试验", snippet: "s" }] },
      auditPlanOutput: {
        overallQuestion: "该药是否有根治依据",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "有试验支持",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
      citationLiveness: new Map([[supportUrl, "dead"]]),
    });

    expect(result.finalReport.verdictType).toBe("unverified");
    expect((result.finalReport._conclusionGate as Record<string, unknown>).rule).toBe(
      "post-liveness-no-surviving-evidence"
    );
    const complete = snapshots.at(-1)!;
    expect(complete.claims[0]).toMatchObject({ judgment: "unresolved" });
    expect(complete.conclusion?.judgment).toBe("unresolved");
    expect(complete.conclusion?.directAnswer ?? "").not.toMatch(/\[\d+\]/);
    expect(complete.conclusion?.directAnswer.startsWith(directAnswer("unverified"))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128022550 Blocker 1B：唯一 contradict 死链 → 硬 false 不得保留
// ───────────────────────────────────────────────────────────────
describe("Blocker 1B：唯一 contradicting 来源死链", () => {
  it("liveness 后反证死光 → false 收为 unverified，不允许死反证支撑 refuted", async () => {
    const atomText = "某食品能包治百病";
    const contraUrl = url(atomText, "watch");
    const sourced = {
      claimAtom: atomText,
      verdict: "false",
      evidence: "观察未见效果。",
      boundary: "b",
      supportingSources: [],
      contradictingSources: [{ url: contraUrl, title: "临床观察", snippet: "未见效果" }],
    };
    const { result, snapshots } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [{ factCheckResult: "false", subclaimVerdicts: [sourced] }],
      composerOutput: {
        verdictType: "false",
        conclusion: "该说法不成立，观察未见效果。",
        subclaimVerdicts: [sourced],
      },
      searchPlan: { [atomText]: [{ url: contraUrl, title: "临床观察", snippet: "未见效果" }] },
      auditPlanOutput: {
        overallQuestion: "该食品是否有疗效依据",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutput: {
        supportedWhere: "有观察反证",
        biggestGap: "",
        missingJustifications: [],
        nextQuestions: [],
      },
      citationLiveness: new Map([[contraUrl, "dead"]]),
    });

    expect(result.finalReport.verdictType).toBe("unverified");
    const complete = snapshots.at(-1)!;
    expect(complete.conclusion?.judgment).not.toBe("refuted");
    expect(complete.conclusion?.judgment).toBe("unresolved");
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128022550 Blocker 2A：search 得新 URL 但重判失败 → 不得关闭 gap
// ───────────────────────────────────────────────────────────────
describe("Blocker 2A：补查得新来源但重判失败", () => {
  it("recheck throw → recheckCommitted=false，不跑第二次 Evaluation，旧 gap 保留，硬 verdict 不放行", async () => {
    const atomText = "某保健品能根治高血压";
    const newUrl = "https://t.test/clinical-a";
    const suggestedQuery = "根治高血压 临床试验";
    const gap = "缺根治效果的临床依据";
    const { result, auditCalls } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [
        {
          factCheckResult: "unverified",
          subclaimVerdicts: [
            {
              claimAtom: atomText,
              verdict: "unverified",
              evidence: "",
              boundary: "",
              supportingSources: [],
              contradictingSources: [],
            },
          ],
        },
        { __throw: "fact_checker down" },
      ],
      composerOutput: { verdictType: "false", conclusion: "该说法不成立。" },
      searchPlan: {
        ["临床试验"]: [{ url: newUrl, title: "高血压临床试验", snippet: "未见根治证据" }],
      },
      auditPlanOutput: {
        overallQuestion: "该保健品是否有根治依据",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutputs: [
        {
          supportedWhere: "该命题尚未取得来源",
          biggestGap: "缺临床依据",
          missingJustifications: [gap],
          nextQuestions: [
            {
              question: "临床试验是否支持根治？",
              reason: "缺核心依据",
              targetClaimAtom: atomText,
              suggestedQuery,
            },
          ],
        },
      ],
    });

    expect(result.wholeClaimAudit.extraPass).toMatchObject({
      recheckCommitted: false,
      reevaluated: false,
      unresolvedQuestions: [gap],
    });
    expect(auditCalls.filter((c) => c.system.includes("整句证据评估器"))).toHaveLength(1);
    // 旧 gap 保留 → gate 照收，硬 false 不放行
    expect(result.finalReport.verdictType).toBe("unverified");
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128022550 Blocker 2B：重判只得到 related-only → 不得关闭 gap
// ───────────────────────────────────────────────────────────────
describe("Blocker 2B：补查重判只得到 sourcesRelatedOnly", () => {
  it("新 URL 未进判词 relation → 不提交，gap 保留", async () => {
    const atomText = "某保健品能根治高血压";
    const newUrl = "https://t.test/clinical-b";
    const suggestedQuery = "根治高血压 临床试验";
    const gap = "缺根治效果的临床依据";
    const { result, auditCalls } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [
        {
          factCheckResult: "unverified",
          subclaimVerdicts: [
            {
              claimAtom: atomText,
              verdict: "unverified",
              evidence: "",
              boundary: "",
              supportingSources: [],
              contradictingSources: [],
            },
          ],
        },
        // 重判成功但判词没有引用任何来源：bind 后只能是 related-only 填充
        {
          factCheckResult: "unverified",
          subclaimVerdicts: [
            {
              claimAtom: atomText,
              verdict: "unverified",
              evidence: "",
              boundary: "",
              supportingSources: [],
              contradictingSources: [],
            },
          ],
        },
      ],
      composerOutput: { verdictType: "false", conclusion: "该说法不成立。" },
      searchPlan: {
        ["临床试验"]: [{ url: newUrl, title: "高血压临床试验", snippet: "未见根治证据" }],
      },
      auditPlanOutput: {
        overallQuestion: "该保健品是否有根治依据",
        checkabilityRevisions: [],
        missingJustifications: [],
        auditQuestions: [],
      },
      auditEvalOutputs: [
        {
          supportedWhere: "该命题尚未取得来源",
          biggestGap: "缺临床依据",
          missingJustifications: [gap],
          nextQuestions: [
            {
              question: "临床试验是否支持根治？",
              reason: "缺核心依据",
              targetClaimAtom: atomText,
              suggestedQuery,
            },
          ],
        },
      ],
    });

    expect(result.wholeClaimAudit.extraPass).toMatchObject({
      recheckCommitted: false,
      reevaluated: false,
      unresolvedQuestions: [gap],
    });
    expect(auditCalls.filter((c) => c.system.includes("整句证据评估器"))).toHaveLength(1);
    expect(result.finalReport.verdictType).toBe("unverified");
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128022550 Blocker 3A：无 audit + reviewer 降级 → 文本必须同步修
// ───────────────────────────────────────────────────────────────
describe("Blocker 3A：audit 不可用时 reviewer 的降级也要修文本", () => {
  it("composer true + 结论“原句成立”被 reviewer 收到 unverified → 最终文案同步收权", async () => {
    const atomText = "某偏方能一夜治愈感冒";
    const { result, snapshots } = await runHarness({
      claim: atomText,
      rumor: rumorStep([{ text: atomText, verifiable: true, type: "fact" }]),
      factOutputs: [{ factCheckResult: "unverified", subclaimVerdicts: [] }],
      composerOutput: { verdictType: "true", conclusion: "原句成立。" },
      searchPlan: {},
    });

    expect(result.finalReport.verdictType).toBe("unverified");
    expect(String(result.finalReport.conclusion)).not.toBe("原句成立。");
    expect(String(result.finalReport.conclusion).startsWith(directAnswer("unverified"))).toBe(true);
    expect(String(result.finalReport.summaryForPublic).startsWith(directAnswer("unverified"))).toBe(true);
    expect(String(result.finalReport.recommendation)).toBe(directAnswer("unverified"));
    const complete = snapshots.at(-1)!;
    expect(complete.conclusion?.judgment).toBe("unresolved");
    expect(complete.conclusion?.directAnswer).toBe(String(result.finalReport.conclusion).slice(0, 400));
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128022550 Blocker 3B：draft 已是弱 verdict 但文本越权 → 仍重建
// ───────────────────────────────────────────────────────────────
describe("Blocker 3B：draft 已是 mixed 但 conclusion 越权", () => {
  it("verdict 无变化时，not-applicable Claim 被写成已证伪仍触发结构化重建", async () => {
    const c1 = "维生素C能治感冒";
    const c2 = "每次感冒都应当输液";
    const { result, snapshots } = await runHarness({
      claim: `${c1}，而且${c2}。`,
      rumor: rumorStep([
        { text: c1, verifiable: true, type: "fact" },
        { text: c2, verifiable: false, type: "normative" },
      ]),
      factOutputs: [
        {
          factCheckResult: "false",
          subclaimVerdicts: [
            {
              claimAtom: c1,
              verdict: "partial",
              evidence: "仅可能略微缓解症状。",
              boundary: "撑不到治愈",
              supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
              contradictingSources: [],
            },
          ],
        },
      ],
      composerOutput: {
        verdictType: "mixed_misleading",
        conclusion: "两条主张均不成立，普通感冒无需输液。",
        subclaimVerdicts: [
          {
            claimAtom: c1,
            verdict: "partial",
            evidence: "仅可能略微缓解症状。",
            boundary: "撑不到治愈",
            supportingSources: [{ url: url(c1), title: "研究", snippet: "s" }],
            contradictingSources: [],
          },
        ],
      },
      searchPlan: { [c1]: [{ url: url(c1), title: "研究", snippet: "s" }] },
      citationLiveness: new Map([[url(c1), "alive"]]),
    });

    expect(result.finalReport.verdictType).toBe("mixed_misleading");
    const complete = snapshots.at(-1)!;
    const finalDirectAnswer = complete.conclusion?.directAnswer ?? "";
    expect(finalDirectAnswer.startsWith(directAnswer("mixed_misleading"))).toBe(true);
    expect(finalDirectAnswer).not.toContain("均不成立");
    expect(finalDirectAnswer).toContain("不适用真假判断");
    expect(finalDirectAnswer).toContain("仅可能略微缓解症状");
  });
});
