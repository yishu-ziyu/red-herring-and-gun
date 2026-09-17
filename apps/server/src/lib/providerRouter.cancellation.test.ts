import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAgentWithFallback, isProviderQuotaSkipped, resetProviderQuotaSkipForTests } from "./providerRouter.js";
import { callMiniMaxAgent, callDeepSeekAgent, callCodexAgent } from "./agentProviders.js";

vi.mock("./agentProviders.js", () => ({
  callMiniMaxAgent: vi.fn(), callDeepSeekAgent: vi.fn(), callCodexAgent: vi.fn(),
  callMimoAgent: vi.fn(), callStepFunAgent: vi.fn(), call360ChatAgent: vi.fn(), callAnthropicAgent: vi.fn(),
}));

const schema = { type: "object", properties: { verdict: { enum: ["true", "false", "partial"] } }, required: ["verdict"] };
function call(signal?: AbortSignal, deadlineMs?: number) {
  return callAgentWithFallback({
    systemPrompt: "Return the verdict as JSON", userContent: "test", responseSchema: schema,
    maxTokens: 100, codexBin: "not-authorized-in-tests",
    env: { MINIMAX_API_KEY: "test", DEEPSEEK_API_KEY: "test", ORCHESTRATE_TEXT_PROVIDER_ORDER: "minimax,deepseek" },
    options: { signal, deadlineMs, attemptTimeoutCapMs: 100 },
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); resetProviderQuotaSkipForTests(); });
afterEach(() => vi.useRealTimers());

describe("cancellation and repair share one deadline", () => {
  it("exhausting a request deadline must not globally blacklist a healthy provider", async () => {
    vi.mocked(callMiniMaxAgent).mockImplementation(() => new Promise(() => {}));
    for (let index = 0; index < 2; index++) {
      const check = expect(call(undefined, Date.now() + 50)).rejects.toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(60);
      await check;
    }
    expect(isProviderQuotaSkipped("minimax")).toBe(false);
    expect(callMiniMaxAgent).toHaveBeenCalledTimes(2);
    expect(callDeepSeekAgent).not.toHaveBeenCalled();
  });

  it("pre-aborted work never calls a provider", async () => {
    const ac = new AbortController(); ac.abort(new Error("user-stop"));
    await expect(call(ac.signal)).rejects.toThrow("user-stop");
    expect(callMiniMaxAgent).not.toHaveBeenCalled();
    expect(callCodexAgent).not.toHaveBeenCalled();
  });

  it("cancels a flying request without a repair or fallback", async () => {
    let transportSignal: AbortSignal | undefined;
    vi.mocked(callMiniMaxAgent).mockImplementation((args) => {
      transportSignal = args.signal;
      return new Promise(() => {});
    });
    const ac = new AbortController();
    const result = call(ac.signal);
    const check = expect(result).rejects.toThrow("user-stop");
    ac.abort(new Error("user-stop"));
    await check;
    expect(transportSignal?.aborted).toBe(true);
    expect(callMiniMaxAgent).toHaveBeenCalledTimes(1);
    expect(callDeepSeekAgent).not.toHaveBeenCalled();
    expect(callCodexAgent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repair cannot receive another full timeout after the first response", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(callMiniMaxAgent)
      .mockImplementationOnce(({ signal }) => new Promise((resolve) => {
        signals.push(signal!);
        setTimeout(() => resolve({ text: "NOT JSON", model: "minimax:test" }), 80);
      }))
      .mockImplementationOnce(({ signal }) => { signals.push(signal!); return new Promise(() => {}); });
    const result = call(undefined, Date.now() + 100);
    const check = expect(result).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(81);
    expect(callMiniMaxAgent).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20);
    await check;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(callDeepSeekAgent).not.toHaveBeenCalled();
    expect(callCodexAgent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("valid JSON with an invalid enum is repaired instead of accepted", async () => {
    vi.mocked(callMiniMaxAgent)
      .mockResolvedValueOnce({ text: '{"verdict":"definitely"}', model: "minimax:test" })
      .mockResolvedValueOnce({ text: '{"verdict":"partial"}', model: "minimax:test" });
    const result = await call();
    expect(result.output).toEqual({ verdict: "partial" });
    expect(callMiniMaxAgent).toHaveBeenCalledTimes(2);
  });
});
