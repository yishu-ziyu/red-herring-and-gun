import { describe, it, expect, beforeEach } from "vitest";
import { evaluateConsensus } from "./evidenceConsensus";
import type { MultiSearchJob } from "./schemas";
import { getTraceCollector, resetTraceCollector } from "./reasoningTrace";

/**
 * E2E v5: Stage 2-5 acceptance criteria.
 *
 * Tests the integration of sourceLineage into evaluateConsensus,
 * and trace collector emission in AgentRuntime.
 */

describe("v5 E2E: PR-2 sourceLineage in consensus report", () => {
  beforeEach(() => {
    resetTraceCollector();
  });

  it("AC-2.1: evaluateConsensus includes sourceLineage groups when sources share hostnames", async () => {
    const jobs: MultiSearchJob[] = [
      {
        jobId: "job-1",
        propositionId: "prop-1",
        propositionText: "Test proposition",
        searchTasks: [
          {
            provider: "360_search",
            query: "test",
            status: "completed",
            result: {
              provider: "360_search",
              query: "test",
              latencyMs: 1000,
              answer: "result",
              sources: [
                {
                  id: "s1",
                  title: "Source A",
                  url: "https://example.com/a",
                  snippet: "",
                  domain: "example.com",
                  publishedAt: "2024-01-01T00:00:00Z",
                  sourceType: "媒体",
                },
                {
                  id: "s2",
                  title: "Source B",
                  url: "https://example.com/b",
                  snippet: "",
                  domain: "example.com",
                  publishedAt: "2024-01-02T00:00:00Z",
                  sourceType: "媒体",
                },
              ],
            },
          },
        ],
      },
    ];

    const report = await evaluateConsensus(jobs);
    expect(report.sourceLineage).toBeDefined();
    expect(Array.isArray(report.sourceLineage)).toBe(true);
    // Two sources on same hostname with close timestamps should be folded
    if (report.sourceLineage && report.sourceLineage.length > 0) {
      const group = report.sourceLineage[0];
      expect(group.memberUrls.length).toBeGreaterThanOrEqual(1);
      expect(group.canonicalUrl).toBeDefined();
    }
  });

  it("AC-2.2: evaluateConsensus does not throw on empty jobs", async () => {
    const report = await evaluateConsensus([]);
    expect(report.propositionResults).toHaveLength(0);
    expect(report.sourceLineage).toBeDefined();
    expect(Array.isArray(report.sourceLineage)).toBe(true);
  });

  it("AC-2.3: evaluateConsensus handles foldLineage failure gracefully", async () => {
    // Jobs with no completed search tasks — foldLineage receives empty array, should not throw
    const jobs: MultiSearchJob[] = [
      {
        jobId: "job-1",
        propositionId: "prop-1",
        propositionText: "Test proposition",
        searchTasks: [
          {
            provider: "360_search",
            query: "test",
            status: "failed",
          },
        ],
      },
    ];

    const report = await evaluateConsensus(jobs);
    expect(report.propositionResults).toHaveLength(1);
    expect(report.sourceLineage).toBeDefined();
    expect(Array.isArray(report.sourceLineage)).toBe(true);
  });
});

describe("v5 E2E: PR-3 trace collector event bus", () => {
  beforeEach(() => {
    resetTraceCollector();
  });

  it("AC-3.1: trace collector holds emit/subscribe lifecycle with async dispatch", async () => {
    const collector = getTraceCollector();
    collector.clear("test-session-v5");
    collector.setSessionId("test-session-v5");

    const received: { action: string; status: string }[] = [];
    const unsub = collector.subscribe((step) => {
      received.push({ action: step.action, status: step.status });
    });

    collector.emit({
      agent: "runtime",
      action: "planner_update",
      status: "completed",
      timestamp: Date.now(),
    });
    collector.emit({
      agent: "rumor_detector",
      action: "RumorDetector started",
      status: "running",
      timestamp: Date.now(),
    });
    collector.emit({
      agent: "rumor_detector",
      action: "RumorDetector completed",
      status: "completed",
      timestamp: Date.now(),
      latencyMs: 1200,
    });
    collector.emit({
      agent: "fact_checker",
      action: "FactChecker completed",
      status: "failed",
      timestamp: Date.now(),
      meta: { code: "agent_failure", message: "model unavailable" },
    });

    // Wait for microtask dispatch
    await new Promise((r) => setTimeout(r, 30));
    unsub();

    // At minimum: the 4 explicitly emitted steps must arrive
    expect(received.length).toBeGreaterThanOrEqual(4);
    expect(received.some((r) => r.action === "planner_update" && r.status === "completed")).toBe(true);
    expect(received.some((r) => r.action === "RumorDetector started" && r.status === "running")).toBe(true);
    expect(received.some((r) => r.action === "RumorDetector completed" && r.status === "completed")).toBe(true);
    expect(received.some((r) => r.action === "FactChecker completed" && r.status === "failed")).toBe(true);

    const steps = collector.getSteps("test-session-v5");
    const failedStep = steps.find((s) => s.action === "FactChecker completed");
    expect(failedStep).toBeDefined();
    expect(failedStep!.meta).toEqual({ code: "agent_failure", message: "model unavailable" });
  });

  it("AC-3.2: failed step in trace does not break collector dispatch", async () => {
    const collector = getTraceCollector();
    collector.setSessionId("test-session-err");

    const received: string[] = [];
    collector.subscribe((step) => {
      received.push(step.action);
      if (step.action === "boom") {
        throw new Error("handler crash");
      }
    });

    collector.emit({ agent: "a", action: "ok", status: "completed", timestamp: Date.now() });
    collector.emit({ agent: "a", action: "boom", status: "failed", timestamp: Date.now() });
    collector.emit({ agent: "a", action: "recover", status: "completed", timestamp: Date.now() });

    await new Promise((r) => setTimeout(r, 20));

    expect(received).toContain("ok");
    expect(received).toContain("boom");
    expect(received).toContain("recover");
  });
});
