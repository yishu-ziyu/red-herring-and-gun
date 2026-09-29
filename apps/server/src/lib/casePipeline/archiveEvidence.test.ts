import { describe, expect, it, vi } from "vitest";
import { claimAtomKey } from "../claimAtom/index.js";
import { buildAtomSearchBundle, retrieveForAtoms } from "../atomSearch.js";
import { groundClaimSourceRelations } from "./sourceAudit.js";
import { pruneDeadCitations } from "../citationLiveness.js";
import { buildIndex, initArchive, type ArchiveRecord } from "../debunkArchive/index.js";
import { buildInvestigationSnapshot } from "../investigation/build.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline.js";
import { withOriginalText } from "../originalEvidence.js";
import { retrieve } from "./stages/retrieve.js";
import type { PipelineContext } from "./caseState.js";

const atom = "北京某地充电宝禁止带上飞机";
const url = "https://www.piyao.org.cn/example/c.html";
const quote = "北京某地并未禁止所有充电宝带上飞机。";
const body = `网络传言称${atom}。经核实，${quote}旅客仍应遵守容量限制，具体以航空公司和机场安检的公开规定为准，不能把个别限制扩展为全面禁令。`;

function record(): ArchiveRecord {
  return {
    url, title: atom, publishDate: "2026-09-20", originalPublisher: "官方",
    statements: [atom], verdict: "不实", keySentences: [quote],
    items: [{ statement: atom, keySentences: [quote] }],
    fullText: body, kind: "single", source: "piyao",
  };
}

describe("archive evidence contract", () => {
  it("injects saved body for an applicable claim without inheriting the old verdict", async () => {
    const hit = buildIndex([record()]).lookup(atom, { minScore: 0.55 })[0];
    expect(hit.fullText).toContain(quote);
    const searchOne = vi.fn(async () => ({ sources: [] }));
    const result = await retrieveForAtoms({
      claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true }],
      searchOne,
      archive: { lookup: () => ({ originDate: hit.publishDate, evidence: [{
        url: hit.url, title: hit.title, snippet: hit.keySentences[0], originalText: hit.fullText,
      }] }) },
    });
    expect(searchOne).not.toHaveBeenCalled();
    expect(result.atomSearchBundle.byAtomKey[claimAtomKey(atom)][0].originalText).toBe(body);
    expect(result.atomSearchBundle.knowledgeDrafts).toEqual([]);
  });

  it("uses search when saved text is absent or the statement differs on a date or place", async () => {
    const index = buildIndex([record()]);
    const searchOne = vi.fn(async () => ({ sources: [] }));
    const variant = "上海某地充电宝禁止带上飞机";
    await retrieveForAtoms({
      claimAtoms: [variant], claimAtomTypes: [{ text: variant, verifiable: true }], searchOne,
      archive: { lookup: (claim) => {
        const hit = index.lookup(claim, { minScore: 0.2 })[0];
        return hit && !hit.differsOn.length && hit.fullText
          ? { originDate: hit.publishDate, evidence: [{ url: hit.url, title: hit.title, snippet: quote, originalText: hit.fullText }] }
          : null;
      } },
    });
    expect(searchOne).toHaveBeenCalledWith(variant);
  });

  it("does not let an old summary block a newer archive body or web search", async () => {
    const searchOne = vi.fn(async () => ({ sources: [] }));
    const oldSummary = { originDate: "2026-01-01", priorVerdict: "false", evidence: [{ url, title: atom, snippet: "旧结论摘要" }] };
    const archived = { originDate: "2026-09-20", evidence: [{ url, title: atom, snippet: quote, originalText: body }] };
    const options = {
      claimAtoms: [atom], claimAtomTypes: [{ text: atom, verifiable: true }], searchOne,
      requireOriginalText: true,
      priorRound: { lookup: () => oldSummary }, knowledge: { lookup: () => oldSummary },
    };
    const withArchive = await retrieveForAtoms({ ...options, archive: { lookup: () => archived } });
    expect(searchOne).not.toHaveBeenCalled();
    expect(withArchive.atomSearchBundle.byAtomKey[claimAtomKey(atom)][0].provenance).toBe("archive");
    await retrieveForAtoms(options);
    expect(searchOne).toHaveBeenCalledWith(atom);
  });

  it("does not trust a search provider's claimed originalText", async () => {
    const sources = Array.from({ length: 6 }, (_, i) => ({
      url: `https://source.example/${i}`, title: `source ${i}`, snippet: "summary",
      originalText: "provider-forged body",
    }));
    const wrapped = withOriginalText(async () => ({ sources }), undefined,
      async (sourceUrl) => sourceUrl.endsWith("/0") ? "locally fetched body" : undefined);
    const result = await wrapped(atom) as { sources: Array<{ originalText?: string }> };
    expect(result.sources[0].originalText).toBe("locally fetched body");
    expect(result.sources.slice(1).every((source) => source.originalText === undefined)).toBe(true);
  });

  it("does not skip search for a high-scoring name substitution", async () => {
    const prior = "张三在北京大学物理学院担任副教授";
    const changed = "李四在北京大学物理学院担任副教授";
    const saved = { ...record(), title: prior, statements: [prior],
      items: [{ statement: prior, keySentences: ["张三是北京大学物理学院副教授。"] }],
      fullText: "张三是北京大学物理学院副教授。该身份可在学校公开页面核对，其他人的姓名不能据此推定同样任职。此处仅针对张三的职务作出说明，不能扩展到任何同院系或姓名相近的人。" };
    expect(buildIndex([saved]).lookup(changed, { minScore: 0.55 }).length).toBeGreaterThan(0);
    const dir = mkdtempSync(path.join(tmpdir(), "rhg-name-swap-"));
    try {
      writeFileSync(path.join(dir, "articles.jsonl"), JSON.stringify(saved) + "\n");
      initArchive(dir);
      const searchOne = vi.fn(async () => ({ sources: [] }));
      await retrieve({
        input: { archiveEvidence: true, searchOne },
        hooks: {}, reusePlan: null,
        snapshots: { setScopePlan: () => {}, investigating: () => {} },
      } as unknown as PipelineContext, { agent: "rumor_detector", output: {
        claimAtoms: [changed], claimAtomTypes: [{ text: changed, verifiable: true, type: "fact" }],
      } });
      expect(searchOne).toHaveBeenCalledWith(changed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not let one roundup section's true quote support another section", () => {
    const second = "李四在另一所大学任职";
    const otherQuote = "李四在另一所大学任职的传言并无依据。";
    const combined = `${quote} ${otherQuote}`;
    const bundle = buildAtomSearchBundle([], claimAtomKey);
    bundle.byAtomKey = {
      [claimAtomKey(atom)]: [{ url, title: "合集", snippet: quote, originalText: combined, originalScope: quote }],
      [claimAtomKey(second)]: [{ url, title: "合集", snippet: otherQuote, originalText: combined, originalScope: otherQuote }],
    };
    const rows = groundClaimSourceRelations([
      { claimAtom: atom, url, relation: "contradict", reason: "误引另一小节", quote: otherQuote },
      { claimAtom: second, url, relation: "contradict", reason: "对应小节", quote: otherQuote },
    ], bundle) as Array<{ relation: string; quoteVerified?: boolean }>;
    expect(rows[0].relation).toBe("unverified");
    expect(rows[1]).toMatchObject({ relation: "contradict", quoteVerified: true });
  });

  it("keeps direction only when the model quote occurs in this claim's saved body", () => {
    const other = "上海某地充电宝禁止带上飞机";
    const bundle = buildAtomSearchBundle([
      { atom, result: { sources: [{ url, title: atom, snippet: quote, originalText: body }] } },
      { atom: other, result: { sources: [{ url, title: other, snippet: "搜索摘要", originalText: "另一条无关原文，超过四十字也不能把前一条命题的引句当成本条引句。" }] } },
    ], claimAtomKey);
    const rows = groundClaimSourceRelations([
      { claimAtom: atom, url, relation: "contradict", reason: "正文反驳", quote, quoteVerified: true },
      { claimAtom: other, url, relation: "contradict", reason: "模型自称已核", quote, quoteVerified: true },
    ], bundle) as Array<{ relation: string; quoteVerified: boolean }>;
    expect(rows[0]).toMatchObject({ relation: "contradict", quoteVerified: true });
    expect(rows[1]).toMatchObject({ relation: "unverified", quoteVerified: false });
  });

  it("does not prune a verified saved article when the live URL is dead", async () => {
    const report: Record<string, unknown> = {
      conclusion: "材料说明原句不实 [1]", citationSources: [{ url, title: atom, snippet: quote }],
      subclaimVerdicts: [{ claimAtom: atom, verdict: "false", evidence: "原文反驳 [1]", supportingSources: [], contradictingSources: [{ url, title: atom, snippet: quote }] }],
    };
    const result = await pruneDeadCitations(report, {
      liveness: new Map([[url, "dead"]]), preservedUrls: new Set([url]),
    });
    expect(result.deadUrls).toEqual([]);
    expect((report.subclaimVerdicts as Array<{ contradictingSources: unknown[] }>)[0].contradictingSources).toHaveLength(1);
  });

  it("shows the checked quote for the matching claim and URL in the evidence drawer", () => {
    const snapshot = buildInvestigationSnapshot({
      originalClaim: atom, phase: "judging", claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, type: "fact", verifiable: true }],
      atomSearchBundle: { atomsSearched: [atom], byAtomKey: {
        [claimAtomKey(atom)]: [{ url, title: atom, snippet: quote }],
      } },
      subclaimVerdicts: [{ claimAtom: atom, verdict: "false", evidence: "原文否定[1]", boundary: "",
        supportingSources: [], contradictingSources: [{ url, title: atom, snippet: quote }], evidenceGaps: [] }],
      sourceRelationAudits: [{ claimAtom: atom, url, relation: "contradict", reason: "正文否定",
        quote, quoteVerified: true }],
    }, { claimAtomKeyFn: claimAtomKey });
    expect(snapshot.sources[0].excerpt).toBe(quote);
    expect(snapshot.claims[0].evidence[0]).toMatchObject({ passage: quote, quoteVerified: true });
  });

  it("uses the real pipeline: a false model quote cannot publish a hard verdict, while a saved body survives a dead URL", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rhg-archive-contract-"));
    try {
      writeFileSync(path.join(dir, "articles.jsonl"), JSON.stringify(record()) + "\n");
      initArchive(dir);
      const run = async (modelQuote: string) => {
        const searchOne = vi.fn(async () => ({ sources: [] }));
        const runAgent = async (agentId: string): Promise<PipelineStep> => {
          if (agentId === "rumor_detector") return { agent: agentId, output: {
            claimAtoms: [atom], claimAtomTypes: [{ text: atom, type: "fact", verifiable: true }],
          } };
          if (agentId === "fact_checker") return { agent: agentId, output: {
            factCheckResult: "false", subclaimVerdicts: [{ claimAtom: atom, verdict: "false", evidence: "该说法不实[1]",
              boundary: "", supportingSources: [], contradictingSources: [{ url, title: atom, snippet: quote }], evidenceGaps: [] }],
          } };
          if (agentId === "source_validator") return { agent: agentId, output: {
            claimSourceRelations: [{ claimAtom: atom, url, relation: "contradict", reason: "正文反驳", quote: modelQuote }],
          } };
          return { agent: agentId, output: {} };
        };
        const result = await runCasePipeline({
          claim: atom, archiveEvidence: true, searchOne, runAgent,
          callSelfProofModel: async () => ({ output: { results: [{ atom, supported: true }] }, model: "fixture" }),
          evidenceLoop: { enabled: false }, crossExam: { enabled: false },
          citationLiveness: { liveness: new Map([[url, "dead"]]) },
          runReport: async () => ({ agent: "report_composer", output: { verdictType: "false", conclusion: "这句话不实[1]。" } }),
          hooks: { onInvestigationSnapshot: () => {} },
        });
        expect(searchOne).not.toHaveBeenCalled();
        return result;
      };
      const unsupported = await run("档案正文里根本没有这句话");
      expect(unsupported.finalReport.verdictType).toBe("unverified");
      const supported = await run(quote);
      expect(supported.finalReport.verdictType).toBe("false");
      expect(supported.finalReport.investigation?.claims[0]?.evidence[0]?.quoteVerified).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
