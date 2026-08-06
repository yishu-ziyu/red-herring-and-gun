/**
 * memoryCandidateGenerator unit tests (server copy)
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMemoryCandidatesFromRun } from "./memoryCandidateGenerator";
import { JsonlMemoryCandidateStore } from "./memoryCandidateStore";

describe("buildMemoryCandidatesFromRun", () => {
  it("always emits actionable case_pattern from claim + finalReport", () => {
    const candidates = buildMemoryCandidatesFromRun({
      runId: "run-abc",
      claim: "隔夜菜会致癌吗",
      steps: [],
      finalReport: {
        verdictType: "mixed_misleading",
        conclusion: "没有充分证据支持隔夜菜必然致癌",
        credibilityScore: 42,
        credibilityLabel: "部分可信",
        summaryForPublic: "别把相关性说成致癌定论",
      },
      searchResult: {
        sources: [{ url: "https://example.com/a", title: "A", domain: "example.com" }],
        supportQuery: "隔夜菜 致癌 证据",
        contradictQuery: "隔夜菜 亚硝酸盐 官方",
        relatedQuestions: ["冷藏多久安全"],
        _source: "360-ai-search",
      },
    });

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.every((c) => c.status === "proposed")).toBe(true);
    expect(candidates.some((c) => c.kind === "case_pattern")).toBe(true);
    expect(candidates[0].provenance.runId).toBe("run-abc");
    expect(candidates[0].provenance.claim).toBe("隔夜菜会致癌吗");
    expect(candidates.every((c) => c.tags.includes("actionable-memory"))).toBe(true);
  });

  it("pulls unresolved gaps from pipeline step output", () => {
    const candidates = buildMemoryCandidatesFromRun({
      runId: "run-gap",
      claim: "某药能根治癌症",
      steps: [
        {
          output: {
            unresolvedEvidenceGaps: ["缺少双盲试验原文"],
          },
        },
      ],
      finalReport: {
        conclusion: "证据不足",
        credibilityScore: 30,
      },
      searchResult: {
        sources: [],
        unresolvedEvidenceGaps: ["缺少监管批件"],
      },
    });

    const failure = candidates.find((c) => c.kind === "failure_record");
    expect(failure).toBeTruthy();
    expect(failure?.provenance.unresolvedQuestions).toEqual(
      expect.arrayContaining(["缺少双盲试验原文", "缺少监管批件"])
    );
  });
});

describe("pipeline propose into JsonlMemoryCandidateStore", () => {
  let dir: string;
  let store: JsonlMemoryCandidateStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mem-cand-gen-"));
    store = new JsonlMemoryCandidateStore(join(dir, "candidates.jsonl"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("propose writes candidates readable by list", async () => {
    const candidates = buildMemoryCandidatesFromRun({
      runId: "run-store",
      claim: "测试命题",
      finalReport: { conclusion: "结论边界", credibilityScore: 55 },
      searchResult: { sources: [{ url: "https://news.test/x", title: "x" }] },
    });
    await store.propose(candidates);
    const listed = await store.list();
    expect(listed.length).toBe(candidates.length);
    expect(listed.every((c) => c.status === "proposed")).toBe(true);
  });
});
