/**
 * 整句判定只有一个决定点：收尾链里没有第二个能改整句结论的关卡。
 *
 * 前半是被删掉的关卡当年各自防的失败，改写成对「整句规则表 + 收尾链」的检查（先写这里、通过，才删关卡）；
 * 后半是首句、徽章、正文、快照必须读同一个结果。
 * 规则表每一行与评分规则 1–6 的逐条测试在 domain/verdict.test.ts 与 sentenceVerdict.test.ts。
 */
import { describe, expect, it } from "vitest";
import { claimAtomKey } from "../claimAtom/index.js";
import { pruneDeadCitations } from "../citationLiveness.js";
import { rebuildInvestigationFromReport } from "../investigation/index.js";
import { faceVerdictFor } from "../reportAssembly/index.js";
import { finalizeReport, type FinalizeReportInput } from "./finalizeReport.js";
import type { PipelineStep } from "./runCasePipeline.js";

type Source = { url: string; title: string; snippet: string };
type AtomSpec = { text: string; role?: "main" | "premise" | "background"; verifiable?: boolean; type?: string };

const src = (n: string): Source => ({ url: `https://gov.example.cn/${n}`, title: `标题${n}`, snippet: `摘录${n}` });

function caseInput(args: {
  claim?: string;
  atoms: AtomSpec[];
  verdicts?: Array<Record<string, unknown>>;
  draft?: Record<string, unknown>;
  gaps?: string[];
  searchSources?: Source[];
}): FinalizeReportInput {
  const texts = args.atoms.map((a) => a.text);
  const rumorStep: PipelineStep = {
    agent: "rumor_detector",
    output: {
      claimAtoms: texts,
      claimAtomTypes: args.atoms.map((a) => ({
        text: a.text,
        verifiable: a.verifiable !== false,
        type: a.type ?? "fact",
        ...(a.role ? { role: a.role } : {}),
      })),
    },
  };
  const factStep: PipelineStep = {
    agent: "fact_checker",
    output: { factCheckResult: "false", subclaimVerdicts: args.verdicts ?? [] },
  };
  const sourceStep: PipelineStep = { agent: "source_validator", output: { claimSourceRelations: [] } };
  const reportStep: PipelineStep = {
    agent: "report_composer",
    output: { verdictType: "true", conclusion: "模型自己写的整句结论。", ...(args.draft ?? {}) },
  };
  const byAtomKey: Record<string, Source[]> = {};
  for (const v of args.verdicts ?? []) {
    const list = [...((v.supportingSources as Source[]) ?? []), ...((v.contradictingSources as Source[]) ?? [])];
    byAtomKey[claimAtomKey(String(v.claimAtom))] = list;
  }
  return {
    claim: args.claim ?? texts.join("，"),
    reportStep,
    rumorStep,
    factStep,
    sourceStep,
    steps: [rumorStep, factStep, sourceStep, reportStep],
    search360Result: { sources: args.searchSources ?? Object.values(byAtomKey).flat() },
    atomSearchBundle: { atomsSearched: texts, byAtomKey },
    auditUnresolvedGaps: args.gaps ?? [],
    pruneCitations: async () => ({ pruned: false, deadUrls: [] }),
  };
}

const TRUE_A = (a = "甲") => ({ claimAtom: a, verdict: "true", evidence: `${a}属实[1]。`, supportingSources: [src(`${a}s`)] });
const FALSE_B = (b = "乙") => ({ claimAtom: b, verdict: "false", evidence: `${b}不实[1]。`, contradictingSources: [src(`${b}c`)] });

describe("被删关卡当年防的失败（现在由整句规则表 + 收尾链兜住）", () => {
  it("原子级守门：整句 false 漂移，但并列主张有据之真 + 有据之假 → 有真有假，不写整句 false", async () => {
    const input = caseInput({
      atoms: [{ text: "甲", role: "main" }, { text: "乙", role: "main" }],
      verdicts: [TRUE_A(), FALSE_B()],
      draft: { verdictType: "false" },
    });
    const { finalReport } = await finalizeReport(input);
    expect(finalReport.verdictType).toBe("mixed_misleading");
    // 公式分读到的整体判定跟着规则表走，不再是模型漂出来的 false。
    expect(input.factStep.output!.factCheckResult).toBe("partial");
  });

  it("全部命题不适用真假判断 → 不下任何硬结论", async () => {
    const { finalReport } = await finalizeReport(
      caseInput({ atoms: [{ text: "这样做不应该", verifiable: false, type: "value" }], draft: { verdictType: "true" } }),
    );
    expect(finalReport.verdictType).toBe("unverified");
    expect(finalReport.faceVerdict).toBe("还查不清");
  });

  it("整句 false 没有带出处的证伪判词支撑（没有出处、出处只是检索垫）→ 不写 false", async () => {
    const noSource = { claimAtom: "乙", verdict: "false", evidence: "x" };
    const relatedOnly = { claimAtom: "乙", verdict: "false", evidence: "x", contradictingSources: [src("r")], sourcesRelatedOnly: true };
    for (const verdict of [noSource, relatedOnly]) {
      const { finalReport } = await finalizeReport(
        caseInput({ atoms: [{ text: "乙", role: "main" }], verdicts: [verdict], draft: { verdictType: "false" } }),
      );
      expect(finalReport.verdictType).toBe("unverified");
    }
  });

  it("整句 true 没有带出处的证实判词支撑 → 不写 true", async () => {
    const noSource = { claimAtom: "甲", verdict: "true", evidence: "x" };
    const wrongBucket = { claimAtom: "甲", verdict: "true", evidence: "x", contradictingSources: [src("w")] };
    for (const verdict of [noSource, wrongBucket]) {
      const { finalReport } = await finalizeReport(
        caseInput({ atoms: [{ text: "甲", role: "main" }], verdicts: [verdict], draft: { verdictType: "true" } }),
      );
      expect(finalReport.verdictType).toBe("unverified");
    }
  });

  it("桥接缺口：前提各自为真，但推出整句结论的那一步（主要主张）没查清 → 证据不足，不写 true", async () => {
    const { finalReport } = await finalizeReport(
      caseInput({
        atoms: [{ text: "甲", role: "premise" }, { text: "所以整句成立", role: "main", type: "causal" }],
        verdicts: [TRUE_A("甲"), { claimAtom: "所以整句成立", verdict: "unverified", evidence: "" }],
        draft: { verdictType: "true" },
        gaps: ["甲为真如何推出整句成立"],
      }),
    );
    expect(finalReport.verdictType).toBe("unverified");
  });

  it("来源探活：唯一支撑的链接死了，硬 true 不能留下", async () => {
    const input = caseInput({
      atoms: [{ text: "甲", role: "main" }],
      verdicts: [TRUE_A()],
      draft: { verdictType: "true" },
    });
    const dead = TRUE_A().supportingSources[0]!.url;
    const { finalReport, deadUrls } = await finalizeReport({
      ...input,
      pruneCitations: (report) => pruneDeadCitations(report, { liveness: new Map([[dead, "dead"]]) }),
    });
    expect(deadUrls).toEqual([dead]);
    expect(finalReport.verdictType).toBe("unverified");
  });

  it("辟谣材料不绕过规则表（基准 v1 的 NEW-406）：模型没有判这一条时，检索里标题带「辟谣」的材料不能直接把整句判成不能信", async () => {
    // 原先的短谣通道会把检索里的「辟谣」标题挂成反驳出处、整句返回 false（「检索到针对这句话的辟谣材料，未见对题的支持材料」），
    // 即使这些材料说的是别的事。辟谣要走逐条的关系判断：模型没判、没有通过关系审核的出处，这一条只能是没查清。
    const claim = "从9月1日起，AI生成的内容必须加标识";
    const debunks = [
      { url: "https://piyao.example/ai1", title: "AI生成的内容被造谣：从9月1日起要加标识说法不实？辟谣", snippet: "辟谣 不实 内容加标识" },
      { url: "https://piyao.example/ai2", title: "网传AI生成内容加标识是谣言 辟谣", snippet: "谣言 AI生成 标识" },
    ];
    const { finalReport } = await finalizeReport(
      caseInput({ claim, atoms: [{ text: claim, role: "main" }], verdicts: [], draft: { verdictType: "unverified" }, searchSources: debunks }),
    );
    expect(finalReport.verdictType).toBe("unverified");
    expect(String(finalReport.conclusion)).not.toContain("检索到针对这句话的辟谣材料");
  });

  it("辟谣走正常路径才算数：模型逐条判了站不住并给了反驳出处 → 不能信", async () => {
    const claim = "常穿黑色内衣易患癌";
    const debunk = { url: "https://piyao.example/black", title: "常穿黑色内衣易患癌？谣言", snippet: "没有科学依据，这是谣言" };
    const judged = { claimAtom: claim, verdict: "false", evidence: "辟谣平台明确这是谣言[1]。", contradictingSources: [debunk] };
    const { finalReport } = await finalizeReport(
      caseInput({ claim, atoms: [{ text: claim, role: "main" }], verdicts: [judged], draft: { verdictType: "unverified" }, searchSources: [debunk] }),
    );
    expect(finalReport.verdictType).toBe("false");
  });

  it("立场型部分只作边界：主要主张有据成立时整句能信，正文写明立场句不计入", async () => {
    const { finalReport } = await finalizeReport(
      caseInput({
        atoms: [{ text: "甲", role: "main" }, { text: "所以这样很好", verifiable: false, type: "value" }],
        verdicts: [TRUE_A()],
        draft: { verdictType: "true" },
      }),
    );
    expect(finalReport.verdictType).toBe("true");
    expect(String(finalReport.conclusion)).toContain("「所以这样很好」不适用真假判断，未计入真假结论。");
  });

  it("审核降级过的判词（模型判 true，出处关系没通过而降成 unverified）不撑整句 true", async () => {
    const demoted = { claimAtom: "甲", verdict: "unverified", evidence: "", demotedFrom: "true", supportingSources: [src("d")], sourcesRelatedOnly: true };
    const { finalReport } = await finalizeReport(
      caseInput({ atoms: [{ text: "甲", role: "main" }], verdicts: [demoted], draft: { verdictType: "true" } }),
    );
    expect(finalReport.verdictType).toBe("unverified");
  });
});

describe("部分支持按要素严格判（基准 v1：NEW-401 / 403 / 405 / 411 的模型判词形状）", () => {
  // 三条都是真话：模型给了 partial，边界里写的是并不反驳原句的适用条件或「不是 100%」，来源全是支持方向。
  const fixtures = [
    { name: "NEW-403", atom: "没有3C标识的充电宝不让带上飞机了", boundary: "仅适用于境内航班；国际航班不受此限制" },
    { name: "NEW-405", atom: "打HPV疫苗能预防宫颈癌", boundary: "预防不是100%；接种后仍需按建议筛查" },
    { name: "NEW-401", atom: "国家现在每个孩子每年发3600元育儿补贴，一直发到3岁", boundary: "需本地户籍并经审核；政策从2025年1月1日起实施" },
  ];
  for (const f of fixtures) {
    it(`${f.name}：partial 但没有来源反驳原句里的任何要素 → 被证实，整句能信`, async () => {
      const verdict = { claimAtom: f.atom, verdict: "partial", evidence: "权威来源明确证实[1]。", boundary: f.boundary, supportingSources: [src(f.name)] };
      const { finalReport } = await finalizeReport(
        caseInput({ atoms: [{ text: f.atom, role: "main" }], verdicts: [verdict], draft: { verdictType: "mixed_misleading" } }),
      );
      expect(finalReport.verdictType).toBe("true");
      expect(String(finalReport.conclusion)).toMatch(/^公开材料撑得住这条说法。/);
    });
  }

  it("来源明确反驳了原句里的数字，并逐字引出：仍是部分成立", async () => {
    const atom = "国家现在每个孩子每年发3600元育儿补贴";
    const verdict = {
      claimAtom: atom,
      verdict: "partial",
      evidence: "补贴制度存在[1]，但金额是每年3600元只适用于3岁以下[2]。",
      contradictedElement: "每年发3600元",
      supportingSources: [src("s")],
      contradictingSources: [src("c")],
    };
    const { finalReport } = await finalizeReport(caseInput({ atoms: [{ text: atom, role: "main" }], verdicts: [verdict] }));
    expect(finalReport.verdictType).toBe("partial");
  });
});

describe("首句、徽章、正文、快照读同一个结果", () => {
  const cases: Array<{ name: string; atoms: AtomSpec[]; verdicts: Array<Record<string, unknown>>; type: string; face: string; judgment: string; lead: string }> = [
    { name: "能信", atoms: [{ text: "甲", role: "main" }], verdicts: [TRUE_A()], type: "true", face: "能信", judgment: "supported", lead: "公开材料撑得住这条说法。" },
    { name: "不能信", atoms: [{ text: "乙", role: "main" }], verdicts: [FALSE_B()], type: "false", face: "不能信", judgment: "refuted", lead: "公开材料不支持这条说法。" },
    {
      name: "有真有假",
      atoms: [{ text: "甲", role: "main" }, { text: "乙", role: "premise" }],
      verdicts: [TRUE_A(), FALSE_B()],
      type: "mixed_misleading",
      face: "有真有假",
      judgment: "mixed",
      lead: "这句话里有站住的部分，也有没站住的部分。",
    },
    {
      name: "部分成立",
      atoms: [{ text: "甲", role: "main" }],
      verdicts: [
        { claimAtom: "甲", verdict: "partial", evidence: "只在小范围成立[1]，超出的部分被否认[2]。", contradictedElement: "甲", supportingSources: [src("p")], contradictingSources: [src("p2")] },
      ],
      type: "partial",
      face: "部分成立",
      judgment: "mixed",
      lead: "这句话只在有限范围内成立。",
    },
    {
      name: "有争议",
      atoms: [{ text: "甲", role: "main" }],
      verdicts: [{ claimAtom: "甲", verdict: "disputed", evidence: "两边说法不同[1][2]。", supportingSources: [src("d1")], contradictingSources: [src("d2")] }],
      type: "disputed",
      face: "有争议",
      judgment: "disputed",
      lead: "权威来源之间说法不一致，这句话有争议。",
    },
    { name: "证据不足", atoms: [{ text: "甲", role: "main" }], verdicts: [], type: "unverified", face: "还查不清", judgment: "unresolved", lead: "公开材料还撑不住判断。" },
  ];
  for (const c of cases) {
    it(`${c.name}：verdictType、faceVerdict、结论首句、摘要、快照徽章一致`, async () => {
      // 模型的整句文字故意写成相反的话：首句必须来自规则表。
      const { finalReport } = await finalizeReport(
        caseInput({ atoms: c.atoms, verdicts: c.verdicts, draft: { verdictType: "true", conclusion: "这句话完全站不住。核对后完全吻合。" } }),
      );
      expect(finalReport.verdictType).toBe(c.type);
      expect(finalReport.faceVerdict).toBe(c.face);
      expect(faceVerdictFor(finalReport.verdictType)).toBe(c.face);
      expect(String(finalReport.conclusion).startsWith(c.lead)).toBe(true);
      expect(String(finalReport.summaryForPublic).startsWith(c.lead)).toBe(true);
      const snapshot = rebuildInvestigationFromReport({ report: finalReport, claim: c.atoms.map((a) => a.text).join("，") });
      expect(snapshot.conclusion?.judgment).toBe(c.judgment);
      expect(snapshot.conclusion?.verdictLead).toBe(c.lead);
    });
  }

  it("正文每一条命题状态与整句结论不打架：能信时正文没有「站不住」", async () => {
    const { finalReport } = await finalizeReport(
      caseInput({
        atoms: [{ text: "甲", role: "main" }, { text: "背景", role: "background" }],
        verdicts: [TRUE_A()],
        draft: { verdictType: "mixed_misleading", conclusion: "有站不住的部分。" },
      }),
    );
    expect(finalReport.verdictType).toBe("true");
    expect(String(finalReport.conclusion)).not.toContain("站不住");
  });
});
