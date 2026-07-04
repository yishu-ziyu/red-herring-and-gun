import { describe, it, expect } from "vitest";
import { composeReport } from "./reportComposer";
import { gradeAll } from "./graderRules";
import { demoCase } from "../data/demoCase";
import { aggregateInferences } from "./inferenceLicense";
import { foldLineage } from "./sourceLineage";
import { requestOrchestrateStream } from "./agentExpansion";
import type { SearchResultSource } from "./schemas";

/**
 * E2E v2 — Acceptance criteria 1.1 through 3.5 codification.
 *
 * These tests run against the public API surface (composeReport,
 * aggregateInferences, foldLineage). They prove that the v2
 * data flow holds end-to-end, not just unit-by-unit.
 */

describe("v2 E2E: PR-1 inferenceLicense aggregation", () => {
  it("AC-1.1 + AC-1.3: composeReport output includes inferenceLicense field", () => {
    const caseData = demoCase;
    const gradedEvidence = gradeAll(caseData.candidates, caseData.subclaims);
    const report = composeReport(caseData, gradedEvidence);
    expect(report.inferenceLicense).toBeDefined();
    expect(Array.isArray(report.inferenceLicense!.allowed)).toBe(true);
    expect(Array.isArray(report.inferenceLicense!.blocked)).toBe(true);
  });

  it("AC-1.2: high-volume aggregation produces non-empty canSay/cannotSay", () => {
    const caseData = demoCase;
    const gradedEvidence = gradeAll(caseData.candidates, caseData.subclaims);
    // demoCase has >5 subclaims; expect at least one canSay or cannotSay
    const report = composeReport(caseData, gradedEvidence);
    const total = report.inferenceLicense!.allowed.length +
      report.inferenceLicense!.blocked.length;
    expect(total).toBeGreaterThan(0);
  });

  it("AC-1.5: FinalReport schema extension does not break old callers", () => {
    // 旧使用方只读 allowedConclusion / doNotInfer 等必要字段
    const caseData = demoCase;
    const gradedEvidence = gradeAll(caseData.candidates, caseData.subclaims);
    const report = composeReport(caseData, gradedEvidence);
    expect(report.allowedConclusion).toBeDefined();
    expect(report.doNotInfer).toBeDefined();
    expect(report.subclaimStatuses).toBeDefined();
    // inferenceLicense 是 optional,不能阻塞旧读取
  });
});

describe("v2 E2E: PR-2 sourceLineage folding", () => {
  it("AC-2.1+AC-2.4: returns lineage groups in canonical schema shape", async () => {
    const sources: SearchResultSource[] = [
      {
        id: "s1", title: "A", url: "https://news.yahoo.com/a",
        snippet: "", domain: "news.yahoo.com", sourceType: "媒体",
        publishedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      },
      {
        id: "s2", title: "B", url: "https://news.yahoo.com/b",
        snippet: "", domain: "news.yahoo.com", sourceType: "媒体",
        publishedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
    ];
    const result = await foldLineage(sources);
    expect(Array.isArray(result.groups)).toBe(true);
    // 每个 group 都有完整字段
    for (const g of result.groups) {
      expect(g.canonicalUrl).toBeDefined();
      expect(Array.isArray(g.memberUrls)).toBe(true);
      expect(["high", "medium", "low"]).toContain(g.independenceCorrected);
      expect(["llm_keyword", "url_hostname", "domain_exact", "fallback"]).toContain(g.detectionMethod);
    }
  });

  it("AC-2.3+AC-2.4: LLM failure degrades to URL hostname tier 2 without throwing", async () => {
    const sources: SearchResultSource[] = [
      {
        id: "s1", title: "A", url: "https://news.yahoo.com/a",
        snippet: "", domain: "news.yahoo.com", sourceType: "媒体",
        publishedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      },
      {
        id: "s2", title: "B", url: "https://news.yahoo.com/b",
        snippet: "", domain: "news.yahoo.com", sourceType: "媒体",
        publishedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
    ];
    const result = await foldLineage(sources, {
      llmClient: {
        clusterByKeywords: async () => {
          throw new Error("forced failure");
        },
      },
    });
    expect(result.stats.llmFailures).toBe(1);
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups[0].detectionMethod).toBe("url_hostname");
  });
});

describe("v2 E2E: PR-3 reasoningTrace event bus", () => {
  it("AC-3.1+AC-3.4: collector singleton holds emit/subscribe lifecycle", async () => {
    const { getTraceCollector, resetTraceCollector } = await import("./reasoningTrace");
    resetTraceCollector();
    const c = getTraceCollector();
    c.setSessionId("e2e-sess");
    const received: string[] = [];
    const unsub = c.subscribe((s) => received.push(s.action));
    c.emit({ agent: "a", action: "step1", status: "running", timestamp: 1 });
    c.emit({ agent: "a", action: "step2", status: "completed", timestamp: 2 });
    // microtask dispatch
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toContain("step1");
    expect(received).toContain("step2");
    unsub();
  });

  it("AC-3.2: agentExpansion trace hook session init (smoke)", () => {
    // 验证 agentExpansion 在导入时不抛错 + 包含新的 site B 函数引用
    // 这里只是 import-level smoke test,因为 requestOrchestrateStream 需要 fetch,
    // 不在 E2E 里跑网络请求
    expect(typeof requestOrchestrateStream).toBe("function");
  });
});

describe("v2 E2E: Stage 2 验收 — 全栈 data flow", () => {
  it("完整 data flow: DemoCase -> gradeAll -> composeReport -> 有 inferenceLicense", () => {
    // 模拟完整 demo run
    const result = (() => {
      const caseData = demoCase;
      const gradedEvidence = gradeAll(caseData.candidates, caseData.subclaims);
      return composeReport(caseData, gradedEvidence);
    })();
    expect(result).toBeDefined();
    expect(result.inferenceLicense).toBeDefined();
    expect(result.inferenceLicense!.coverage.totalSubclaims).toBeGreaterThan(0);
  });
});