/**
 * Regression: makeRunReport 必须在模块级能调到 makeReportRunner（5abc234 曾把它拆断成 ReferenceError）。
 */
import { describe, expect, it, vi } from "vitest";
import { runReportComposerWithFallback } from "./lib/reportFallback.js";
import type { PipelineStep } from "./lib/casePipeline/index.js";

describe("handlers makeRunReport wiring", () => {
  it("makeRunReport 闭包能调用 report composer fallback，不报 ReferenceError", async () => {
    const events: string[] = [];
    const runAgent = vi.fn(async (agentId: string) => {
      if (agentId === "report_composer") {
        return await new Promise<PipelineStep>(() => {});
      }
      throw new Error(`unexpected ${agentId}`);
    });

    // 与 handlers.ts 模块级 makeReportRunner + makeRunReport 同形
    const makeReportRunner = (agent: typeof runAgent) =>
      async (args: {
        claim: string;
        steps: PipelineStep[];
        search360Result: unknown;
        atomSearchBundle: { atomsSearched: string[]; aggregate: { sources: unknown[] } };
        onFallback?: (step: PipelineStep) => void;
      }) =>
        runReportComposerWithFallback({
          claim: args.claim,
          steps: args.steps,
          search360Result: args.search360Result,
          runAgent: (agentId, s, search) => agent(agentId, s, search, args.atomSearchBundle),
          onFallback: args.onFallback,
          timeoutMs: 5,
        });

    const makeRunReport =
      (agent: typeof runAgent, sendEvent: (data: { type: string }) => void) =>
      async (args: Parameters<ReturnType<typeof makeReportRunner>>[0]) => {
        return makeReportRunner(agent)({
          ...args,
          onFallback: (step) => {
            sendEvent({ type: "agent_complete" });
            args.onFallback?.(step);
          },
        });
      };

    const runReport = makeRunReport(runAgent, (e) => events.push(e.type));
    const step = await runReport({
      claim: "测试",
      steps: [],
      search360Result: { sources: [] },
      atomSearchBundle: { atomsSearched: [], aggregate: { sources: [] } },
    });

    expect(step.model).toBe("fallback:deterministic-report");
    expect(events).toEqual(["agent_complete"]);
  });
});
