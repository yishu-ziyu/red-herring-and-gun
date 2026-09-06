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
