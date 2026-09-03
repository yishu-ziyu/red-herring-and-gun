/**
 * memoryCandidateGenerator unit tests (server copy)
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMemoryCandidatesFromRun } from "./memoryCandidateGenerator";
import { JsonlMemoryCandidateStore } from "./memoryCandidateStore";
import type { SearchStrategyMemoryPayload } from "./memoryCandidateTypes";

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

  it("effectiveQueries 收 support/contradict 与打中的 hop query，不含原句、未打中 hop、旧案 URL", () => {
    const claim = "我说我的电瓶车叫谁偷走了，原来送到非洲去了";
    const candidates = buildMemoryCandidatesFromRun({
      runId: "run-reuse",
      claim,
      steps: [
        {
          output: {
            pursuitHops: [
              { query: "电瓶车 失窃 警方通报", resultKind: "primary", newEvidence: 1 },
            ],
          },
        },
      ],
      finalReport: {
        conclusion: "不能信",
        credibilityScore: 18,
        evidencePursuit: {
          hops: [
            { query: "电瓶车被偷至境外 非洲 P图 辟谣 警方通报", resultKind: "refutation", newEvidence: 2 },
            { query: "无关天气 问法", resultKind: "empty", newEvidence: 0 },
          ],
        },
      },
      searchResult: {
        sources: [{ url: "https://old-case.example/africa", title: "旧案", domain: "old-case.example" }],
        supportQuery: "电瓶车 非洲 证据",
        contradictQuery: "电瓶车 非洲 辟谣 官方通报",
        relatedQuestions: ["冷藏多久安全"],
        hops: [{ query: "https://old-case.example/africa", resultKind: "repost", newEvidence: 0 }],
      },
    });

    const strategy = candidates.find((c) => c.kind === "search_strategy");
    expect(strategy).toBeTruthy();
    const queries = (strategy?.payload as SearchStrategyMemoryPayload).effectiveQueries;
    expect(queries).toEqual(
      expect.arrayContaining([
        "电瓶车 非洲 证据",
        "电瓶车 非洲 辟谣 官方通报",
        "电瓶车被偷至境外 非洲 P图 辟谣 警方通报",
        "电瓶车 失窃 警方通报",
      ])
    );
    expect(queries).not.toContain(claim);
    expect(queries).not.toContain("无关天气 问法");
    expect(queries).not.toContain("冷藏多久安全");
    expect(queries.some((q) => q.includes("https://"))).toBe(false);
    expect(strategy?.provenance.sourceUrls).toContain("https://old-case.example/africa");
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
