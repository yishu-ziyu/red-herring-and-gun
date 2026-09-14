/**
 * 同一案追问快路径（契约 docs/evals/2026-09-13-followup-fast-path.md Evaluator 3）。
 *
 * 打桩模型与检索：断言已核命题不再拆题、不再联网；新问题只搜新的；
 * 无档案走完整管道。结论带来源。
 */
import { describe, expect, it, vi } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { collapseFollowUpAtoms, FOLLOW_UP_MARKER, priorReportFromVisibleBrief } from "../followUpReuse.js";

const ATOM_NITRITE = "隔夜菜的亚硝酸盐含量会超标";
const ATOM_POISON = "吃了隔夜菜会导致中毒";
const URL_A = "https://cdc.example/leftover-nitrite";
const URL_B = "https://who.example/foodborne";
const PRIOR_CLAIM = "隔夜菜亚硝酸盐超标，吃了会中毒。";

const PRIOR_REPORT = {
  verdictType: "mixed_misleading",
  conclusion: "隔夜菜亚硝酸盐会升高，但普通家庭剂量谈不上中毒。",
  subclaimVerdicts: [
    {
      claimAtom: ATOM_NITRITE,
      verdict: "true",
      supportingSources: [{ url: URL_A, title: "疾控说明", snippet: "冷藏会升高，远低于限值" }],
      contradictingSources: [],
    },
    {
      claimAtom: ATOM_POISON,
      verdict: "false",
      supportingSources: [],
      contradictingSources: [{ url: URL_B, title: "食源性疾病", snippet: "普通家庭剂量谈不上中毒" }],
    },
  ],
};

function composed(followUp: string): string {
  return [followUp, "", `（${FOLLOW_UP_MARKER}）`, `原对象：${PRIOR_CLAIM}`, "请直接回答这次追问。"].join("\n");
}

function stubAgents(atoms: string[]) {
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
          factCheckResult: "mixed_misleading",
          subclaimVerdicts: atoms.map((atom) => ({
            claimAtom: atom,
            verdict: atom === ATOM_POISON ? "false" : "true",
            evidence: "按现有材料判定[1]",
            boundary: "以现有公开材料为准",
            supportingSources:
              atom === ATOM_POISON
                ? []
                : [{ url: URL_A, title: "疾控说明", snippet: "冷藏会升高" }],
            contradictingSources:
              atom === ATOM_POISON
                ? [{ url: URL_B, title: "食源性疾病", snippet: "谈不上中毒" }]
                : [],
          })),
        },
      };
    }
    if (agentId === "source_validator") {
      return { agent: "source_validator", output: { sourceReliability: "medium" } };
    }
    throw new Error(`unexpected ${agentId}`);
  });
  return runAgent;
}

const callSelfProofModel = async () => ({
  output: {
    results: [ATOM_NITRITE, ATOM_POISON].map((atom) => ({ atom, supported: true, reason: "在句内" })),
  },
  model: "selfproof-m",
});

const stubRunReport = async ({ claim, steps }: { claim: string; steps: PipelineStep[] }) => {
  const fact = steps.find((step) => step.agent === "fact_checker");
  return {
    agent: "report_composer",
    output: {
      verdictType: "mixed_misleading",
      conclusion: "直接回答这句追问：普通家庭剂量谈不上中毒。",
      subclaimVerdicts: fact?.output?.subclaimVerdicts ?? [],
      citationSources: [{ url: URL_B, title: "食源性疾病" }],
    },
  } satisfies PipelineStep;
};

describe("同一案追问快路径", () => {
  it("有档案且追问被覆盖：不拆题、已核命题不检索、来源标 prior-round", async () => {
    const searchOne = vi.fn(async () => ({ sources: [] }));
    const runAgent = stubAgents([ATOM_NITRITE, ATOM_POISON]);

    const result = await runCasePipeline({
      claim: composed("吃了隔夜菜会导致中毒吗？"),
      runAgent,
      searchOne,
      callSelfProofModel,
      runReport: stubRunReport,
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      followUpReuse: {
        priorReport: PRIOR_REPORT,
        priorClaim: PRIOR_CLAIM,
        priorCreatedAt: Date.parse("2026-09-12T12:00:00.000Z"),
      },
    });

    expect(runAgent.mock.calls.map((call) => call[0])).not.toContain("rumor_detector");
    expect(searchOne).not.toHaveBeenCalled();
    expect(result.atomSearchBundle.atomsSearched).toEqual([ATOM_NITRITE, ATOM_POISON]);
    expect(result.atomSearchBundle.byAtomKey[ATOM_NITRITE]![0]).toMatchObject({
      url: URL_A,
      provenance: "prior-round",
      originDate: "2026-09-12",
    });
    expect(String(result.finalReport.conclusion)).toMatch(/中毒/);
    const cited = (result.finalReport.subclaimVerdicts as Array<{ contradictingSources?: Array<{ url?: string }> }>)
      .flatMap((row) => row.contradictingSources ?? [])
      .map((source) => source.url);
    expect(cited).toContain(URL_B);
  });

  it("有档案且冒出新问题：只搜新的，已核命题不进 searchOne", async () => {
    const searchOne = vi.fn(async (query: string) => ({
      sources: [{ url: "https://search.example/seafood", title: query, snippet: "海鲜检索" }],
    }));
    const newQuestion = "那隔夜海鲜呢？会不会同样中毒？";
    const runAgent = stubAgents([ATOM_NITRITE, ATOM_POISON, newQuestion]);

    const result = await runCasePipeline({
      claim: composed(newQuestion),
      runAgent,
      searchOne,
      callSelfProofModel,
      runReport: stubRunReport,
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      followUpReuse: {
        priorReport: PRIOR_REPORT,
        priorClaim: PRIOR_CLAIM,
        priorCreatedAt: Date.parse("2026-09-12T12:00:00.000Z"),
      },
    });

    expect(runAgent.mock.calls.map((call) => call[0])).not.toContain("rumor_detector");
    expect(searchOne.mock.calls.map((call) => call[0])).toEqual([newQuestion]);
    expect(result.atomSearchBundle.byAtomKey[ATOM_POISON]![0]).toMatchObject({ provenance: "prior-round" });
    expect((result.atomSearchBundle.byAtomKey[newQuestion] ?? [])[0]).not.toHaveProperty("provenance");
  });

  it("不传档案：完整管道，拆题仍跑、逐命题检索", async () => {
    const searchOne = vi.fn(async (query: string) => ({
      sources: [{ url: `https://search.example/${encodeURIComponent(query)}`, title: query, snippet: "检索" }],
    }));
    const runAgent = stubAgents([ATOM_NITRITE, ATOM_POISON]);

    await runCasePipeline({
      claim: composed("吃了隔夜菜会导致中毒吗？"),
      runAgent,
      searchOne,
      callSelfProofModel,
      runReport: stubRunReport,
      citationLiveness: false,
      evidenceLoop: { enabled: false },
    });

    expect(runAgent.mock.calls.map((call) => call[0])).toContain("rumor_detector");
    const claim = composed("吃了隔夜菜会导致中毒吗？");
    expect(searchOne.mock.calls.map((call) => call[0]).sort()).toEqual(
      collapseFollowUpAtoms(claim, [ATOM_NITRITE, ATOM_POISON]).sort()
    );
  });

  it("访客可见材料形状的档案：不拆题、已核命题不检索", async () => {
    const searchOne = vi.fn(async () => ({ sources: [] }));
    const runAgent = stubAgents([ATOM_NITRITE, ATOM_POISON]);
    const priorReport = priorReportFromVisibleBrief({
      originalClaim: PRIOR_CLAIM,
      conclusion: "隔夜菜亚硝酸盐会升高，但普通家庭剂量谈不上中毒。",
      claims: [
        {
          text: ATOM_NITRITE,
          judgment: "supported",
          evidence: [{ url: URL_A, title: "疾控说明", excerpt: "冷藏会升高", role: "support" }],
        },
        {
          text: ATOM_POISON,
          judgment: "refuted",
          evidence: [{ url: URL_B, title: "食源性疾病", excerpt: "谈不上中毒", role: "contradict" }],
        },
      ],
    });

    await runCasePipeline({
      claim: composed("吃了隔夜菜会导致中毒吗？"),
      runAgent,
      searchOne,
      callSelfProofModel,
      runReport: stubRunReport,
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      followUpReuse: {
        priorReport,
        priorClaim: PRIOR_CLAIM,
        priorCreatedAt: Date.parse("2026-09-12T12:00:00.000Z"),
      },
    });

    expect(runAgent.mock.calls.map((call) => call[0])).not.toContain("rumor_detector");
    expect(searchOne).not.toHaveBeenCalled();
  });
});
