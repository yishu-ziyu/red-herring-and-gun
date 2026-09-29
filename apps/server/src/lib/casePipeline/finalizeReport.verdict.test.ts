import { describe, expect, it } from "vitest";
import { claimAtomKey } from "../claimAtom/index.js";
import { pruneDeadCitations } from "../citationLiveness.js";
import { assembleFinalReport } from "../reportAssembly/index.js";
import { applySentenceVerdict, listAssessedClaims, settleClaimVerdicts } from "../sentenceVerdict.js";
import { finalizeReport } from "./finalizeReport.js";
import { scoreReport } from "./scoreReport.js";
import type { PipelineStep } from "./runCasePipeline.js";

const source = (id: string) => ({ url: `https://example.org/${id}`, title: id, snippet: `${id} 原文` });
type Atom = { text: string; verifiable?: boolean; role?: string; type?: string };

async function prepared(atoms: Atom[], verdicts: Array<Record<string, unknown>>, deadUrls: string[] = []) {
  const rumorStep: PipelineStep = { agent: "rumor_detector", output: {
    claimAtoms: atoms.map((atom) => atom.text),
    claimAtomTypes: atoms.map((atom) => ({ text: atom.text, verifiable: atom.verifiable !== false,
      type: atom.type ?? "fact", role: atom.role ?? "main" })),
  } };
  const factStep: PipelineStep = { agent: "fact_checker", output: { factCheckResult: "unverified", subclaimVerdicts: verdicts } };
  const sourceStep: PipelineStep = { agent: "source_validator", output: { claimSourceRelations: [] } };
  const byAtomKey = Object.fromEntries(verdicts.map((verdict) => [
    claimAtomKey(String(verdict.claimAtom)),
    [...(Array.isArray(verdict.supportingSources) ? verdict.supportingSources : []),
      ...(Array.isArray(verdict.contradictingSources) ? verdict.contradictingSources : [])],
  ]));
  const judgment: Record<string, unknown> = {};
  assembleFinalReport({ finalReport: judgment, rumorStep, verdicts,
    atomSearchBundle: { atomsSearched: atoms.filter((atom) => atom.verifiable !== false).map((atom) => atom.text), byAtomKey } as never });
  if (deadUrls.length) {
    await pruneDeadCitations(judgment, { liveness: new Map(deadUrls.map((url) => [url, "dead" as const])) });
  }
  settleClaimVerdicts(judgment);
  applySentenceVerdict(judgment, listAssessedClaims(judgment, rumorStep.output));
  const finish = async (draft: Record<string, unknown> = {}) => finalizeReport({
    claim: atoms.map((atom) => atom.text).join("，"), rumorStep, factStep, sourceStep,
    judgment, search360Result: {}, reportStep: { agent: "report_composer", output: draft },
    finalizeHook: scoreReport,
  });
  return { judgment, finish };
}

describe("正式判定先于报告", () => {
  it("原子级守门：整句 false 漂移，但并列主张有据之真 + 有据之假 → 有真有假，不写整句 false", async () => {
    const { judgment, finish } = await prepared(
      [{ text: "甲", role: "main" }, { text: "乙", role: "main" }],
      [{ claimAtom: "甲", verdict: "true", supportingSources: [source("a")] },
       { claimAtom: "乙", verdict: "false", contradictingSources: [source("b")] }],
    );
    const { finalReport } = await finish({ verdictType: "false", subclaimVerdicts: [], explanation: "甲有原文支持，乙被原文反驳。" });
    expect(judgment.verdictType).toBe("mixed_misleading");
    expect(finalReport.verdictType).toBe("mixed_misleading");
    expect(finalReport.subclaimVerdicts).toEqual(judgment.subclaimVerdicts);
    expect(finalReport.conclusion).toContain("甲有原文支持，乙被原文反驳");
  });

  it("立场型部分只作边界：主要主张有据成立时整句能信，正文写明立场句不计入", async () => {
    const { judgment, finish } = await prepared(
      [{ text: "甲", role: "main" }, { text: "应该支持甲", verifiable: false, type: "value" }],
      [{ claimAtom: "甲", verdict: "true", supportingSources: [source("a")] }],
    );
    const { finalReport } = await finish({ explanation: "甲有原文支持；价值判断不计入真假。" });
    expect(judgment.verdictType).toBe("true");
    expect(finalReport.verdictType).toBe("true");
    expect(finalReport.nonVerifiableAtoms).toEqual([{ text: "应该支持甲", type: "value" }]);
    expect(finalReport.conclusion).toContain("价值判断不计入真假");
  });

  it("辟谣走正常路径才算数：模型逐条判了站不住并给了反驳出处 → 不能信", async () => {
    const { finish } = await prepared([{ text: "甲" }],
      [{ claimAtom: "甲", verdict: "false", contradictingSources: [source("a")] }]);
    const { finalReport } = await finish({ verdictType: "true", explanation: "公开原文反驳了甲。" });
    expect(finalReport.verdictType).toBe("false");
    expect(finalReport.conclusion).toContain("公开原文反驳了甲");
  });

  it("有争议：verdictType、faceVerdict、结论首句、摘要、快照徽章一致", async () => {
    const { finish } = await prepared([{ text: "甲" }], [{ claimAtom: "甲", verdict: "disputed",
      supportingSources: [source("a")], contradictingSources: [source("b")] }]);
    const { finalReport } = await finish({ explanation: "两份原文结论相反。", summaryExplanation: "仍需解释冲突。" });
    expect(finalReport.verdictType).toBe("disputed");
    expect(finalReport.faceVerdict).toBe("有争议");
    expect(finalReport.conclusion).toContain("两份原文结论相反");
    expect(finalReport.summaryForPublic).toContain("仍需解释冲突");
  });

  it("来源明确反驳了原句里的数字，并逐字引出：仍是部分成立", async () => {
    const { finish } = await prepared([{ text: "甲增加十倍" }], [{ claimAtom: "甲增加十倍", verdict: "partial",
      contradictedElement: "十倍", supportingSources: [source("a")], contradictingSources: [source("b")] }]);
    const { finalReport } = await finish({ explanation: "原文只支持增加，十倍不成立。" });
    expect(finalReport.verdictType).toBe("partial");
    expect(finalReport.conclusion).toContain("十倍不成立");
  });

  it("来源探活：唯一支撑的链接死了，硬 true 不能留下", async () => {
    const cited = source("a");
    const { judgment, finish } = await prepared([{ text: "甲" }],
      [{ claimAtom: "甲", verdict: "true", supportingSources: [cited] }], [cited.url]);
    const { finalReport } = await finish({ verdictType: "true", explanation: "甲已证实。" });
    expect(judgment.verdictType).toBe("unverified");
    expect(finalReport.verdictType).toBe("unverified");
    expect(String(finalReport.conclusion)).not.toContain("甲已证实");
    expect((finalReport.subclaimVerdicts as Array<{ verdict: string }>)[0]?.verdict).toBe("unverified");
    expect(finalReport.subclaimVerdicts).toEqual(judgment.subclaimVerdicts);
  });

  it("报告模型的解释进入最终结果，伪造判词和未核 URL 不进入", async () => {
    const cited = source("a");
    const { judgment, finish } = await prepared([{ text: "甲" }],
      [{ claimAtom: "甲", verdict: "true", supportingSources: [cited] }]);
    const { finalReport } = await finish({
      explanation: "甲在原文限定范围内成立。", verdictType: "false", subclaimVerdicts: [{ claimAtom: "甲", verdict: "false" }],
      evidenceChain: [{ layer: "材料", finding: "甲", evidence: "原文", boundary: "仅此范围", sourceRefs: [cited.url, "https://fake.test/x"] }],
    });
    expect(finalReport.conclusion).toContain("甲在原文限定范围内成立");
    expect(finalReport.verdictType).toBe("true");
    expect(finalReport.subclaimVerdicts).toEqual(judgment.subclaimVerdicts);
    expect(JSON.stringify(finalReport.evidenceChain)).not.toContain("fake.test");
  });

  it("生产评分钩子保留有原文支持的因果解释，不虚构缺口、空证据层或存疑动作", async () => {
    const { finish } = await prepared([{ text: "甲导致乙" }],
      [{ claimAtom: "甲导致乙", verdict: "true", supportingSources: [source("causal")] }]);
    const { finalReport } = await finish({
      explanation: "研究原文证明甲导致乙[1]。",
      summaryExplanation: "研究原文证明甲导致乙[1]。",
      whyHardToVerify: [],
      evidenceChain: [],
    });
    expect(finalReport.conclusion).toContain("证明甲导致乙");
    expect(finalReport.conclusion).not.toContain("关联到");
    expect(finalReport.whyHardToVerify).toEqual([]);
    expect(finalReport.evidenceChain).toEqual([]);
    expect(finalReport.closureActions).toBeUndefined();
  });
});
