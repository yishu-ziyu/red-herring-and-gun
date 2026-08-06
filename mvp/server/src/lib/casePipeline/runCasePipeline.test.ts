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
        expect.objectContaining({ claimAtom: "事实A", verdict: "true" }),
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
});
