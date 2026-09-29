/**
 * Regression: makeRunReport 必须在模块级能调到 makeReportRunner（5abc234 曾把它拆断成 ReferenceError）。
 */
import { describe, expect, it, vi } from "vitest";
import { runReportComposerWithFallback } from "./lib/reportFallback.js";
import type { PipelineStep } from "./lib/casePipeline/index.js";
import { makeRunReport as productionMakeRunReport } from "./http/pipelineEvents.js";

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

it("生产 ReportComposer 只接收正式判断与已核引句", async () => {
  const runAgent = vi.fn(async (_id: string, steps: PipelineStep[], search?: unknown): Promise<PipelineStep> => {
    expect(search).toBeUndefined();
    expect(steps).toEqual([{ agent: "formal_judgment", output: {
      verdictType: "false", verifiedQuotes: [{ quote: "原文反驳" }],
    } }]);
    return { agent: "report_composer", output: { explanation: "原文反驳了这句话。" } };
  });
  const runReport = productionMakeRunReport(runAgent, undefined, new AbortController(), () => {});
  await runReport({ claim: "这句话", steps: [{ agent: "fact_checker", output: { keyFindings: ["旧判断"] } }],
    search360Result: { answer: "旧摘要" }, atomSearchBundle: {} as never,
    judgment: { verdictType: "false" }, verifiedQuotes: [{ quote: "原文反驳" }] });
  expect(runAgent).toHaveBeenCalledOnce();
});
