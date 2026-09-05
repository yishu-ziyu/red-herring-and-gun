import { afterEach, describe, expect, it, vi } from "vitest";
import { callJob, type JobDispatch } from "./callJob.js";
import type { JobCandidate } from "./jobModels.js";

function abortErr(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErr());
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortErr());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function baseParams(dispatch: JobDispatch, extra: Partial<Parameters<typeof callJob>[0]> = {}) {
  return {
    job: "assess",
    systemPrompt: "return json",
    userContent: "claim",
    env: {},
    dispatch,
    hedgeAfterMs: 8_000,
    ...extra,
  };
}

describe("callJob hedge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首候选 20s 不回、次候选 1s 回 → 结果来自次候选、首候选 aborted、总时长 ≈ hedge+1s", async () => {
    vi.useFakeTimers();
    const seen: AbortSignal[] = [];
    const dispatch: JobDispatch = async ({ candidate, signal }) => {
      seen.push(signal);
      if (candidate.provider === "minimax") {
        await sleep(20_000, signal);
        return { text: '{"from":"first"}', model: "minimax:MiniMax-M3" };
      }
      await sleep(1_000, signal);
      return { text: '{"from":"second"}', model: "stepfun:step-3.7-flash" };
    };
    const pending = callJob(baseParams(dispatch));
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    expect(result.output).toEqual({ from: "second" });
    expect(result.model).toBe("stepfun:step-3.7-flash");
    expect(seen[0]?.aborted).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(8_000);
    expect(result.latencyMs).toBeLessThan(10_000);
  });

  it("首候选 429 → 立即发次候选（不等 hedge）", async () => {
    vi.useFakeTimers();
    const started: number[] = [];
    const dispatch: JobDispatch = async ({ candidate }) => {
      started.push(Date.now());
      if (candidate.provider === "minimax") throw new Error("429 too many requests");
      return { text: '{"ok":true}', model: "stepfun:step-3.7-flash" };
    };
    const pending = callJob(baseParams(dispatch));
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(result.output).toEqual({ ok: true });
    expect(started).toHaveLength(2);
    expect(started[1]! - started[0]!).toBe(0);
  });

  it("deadline 剩 2s → 不调 dispatch 直接抛", async () => {
    const dispatch = vi.fn<JobDispatch>();
    await expect(
      callJob(baseParams(dispatch, { deadlineMs: Date.now() + 2_000 })),
    ).rejects.toThrow(/deadline exceeded/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("外部 signal.abort() → 所有在飞尝试 aborted、抛 AbortError", async () => {
    vi.useFakeTimers();
    const seen: AbortSignal[] = [];
    const ac = new AbortController();
    const dispatch: JobDispatch = async ({ signal }) => {
      seen.push(signal);
      await sleep(30_000, signal);
      return { text: '{"x":1}', model: "minimax:MiniMax-M3" };
    };
    const pending = callJob(baseParams(dispatch, { signal: ac.signal }));
    await vi.advanceTimersByTimeAsync(8_000);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seen.every((item) => item.aborted)).toBe(true);
  });

  it("坏 JSON → 该次失败并进入下一候选", async () => {
    const dispatch: JobDispatch = async ({ candidate }) => {
      if (candidate.provider === "minimax") {
        return { text: "not-json", model: "minimax:MiniMax-M3" };
      }
      return { text: '{"ok":true}', model: "stepfun:step-3.7-flash" };
    };
    const result = await callJob(baseParams(dispatch));
    expect(result.output).toEqual({ ok: true });
    expect(result.attempts[0]).toMatchObject({ provider: "minimax", ok: false });
    expect(result.attempts[1]).toMatchObject({ provider: "stepfun", ok: true });
  });

  it("attempts 记录每次 provider/model/ok/latency", async () => {
    const dispatch: JobDispatch = async ({ candidate }: { candidate: JobCandidate }) => {
      if (candidate.provider === "minimax") throw new Error("429");
      return { text: '{"ok":true}', model: "stepfun:step-3.7-flash" };
    };
    const result = await callJob(baseParams(dispatch));
    expect(result.attempts).toHaveLength(2);
    for (const row of result.attempts) {
      expect(row).toEqual(
        expect.objectContaining({
          provider: expect.any(String),
          model: expect.any(String),
          ok: expect.any(Boolean),
          latencyMs: expect.any(Number),
        }),
      );
    }
    expect(result.attempts[0]?.error).toMatch(/429/);
  });

  it("fetch failed 同候选重试一次，attempts 两条同 provider/model", async () => {
    vi.useFakeTimers();
    let hits = 0;
    const dispatch: JobDispatch = async ({ candidate }) => {
      hits += 1;
      if (hits === 1) throw new Error("fetch failed");
      return { text: '{"ok":true}', model: `${candidate.provider}:${candidate.model}` };
    };
    const pending = callJob(
      baseParams(dispatch, { env: { RHG_MODEL_ASSESS: "minimax:MiniMax-M3:low" } }),
    );
    await vi.advanceTimersByTimeAsync(400);
    const result = await pending;
    expect(result.output).toEqual({ ok: true });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ provider: "minimax", model: "MiniMax-M3", ok: false });
    expect(result.attempts[1]).toMatchObject({ provider: "minimax", model: "MiniMax-M3", ok: true });
  });

  it("4xx 不重试：第二候选 provider 不同", async () => {
    const dispatch: JobDispatch = async ({ candidate }) => {
      if (candidate.provider === "minimax") throw new Error("StepFun API 调用失败：400 bad request");
      return { text: '{"ok":true}', model: "stepfun:step-3.7-flash" };
    };
    const result = await callJob(baseParams(dispatch));
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ provider: "minimax", ok: false });
    expect(result.attempts[1]).toMatchObject({ provider: "stepfun", ok: true });
    expect(result.attempts[0]?.provider).not.toBe(result.attempts[1]?.provider);
  });

  it("无 RHG_MODEL 时前两个失败后继续试 env 里已配置的 DeepSeek", async () => {
    const started: string[] = [];
    const dispatch: JobDispatch = async ({ candidate }) => {
      started.push(candidate.provider);
      if (candidate.provider === "minimax" || candidate.provider === "stepfun") {
        throw new Error(`${candidate.provider} down`);
      }
      return { text: '{"ok":true}', model: `${candidate.provider}:${candidate.model}` };
    };
    const result = await callJob(
      baseParams(dispatch, {
        env: {
          MINIMAX_API_KEY: "sk-mm-test",
          MINIMAX_MODEL: "MiniMax-M3",
          STEPFUN_API_KEY: "sk-sf-test",
          STEPFUN_MODEL: "step-3.7-flash",
          DEEPSEEK_API_KEY: "sk-ds-test",
          DEEPSEEK_MODEL: "deepseek-v4-flash",
          MIMO_API_KEY: "sk-mimo-test",
          MIMO_MODEL: "mimo-v2.5-pro",
        },
      }),
    );
    expect(started).toEqual(["minimax", "stepfun", "deepseek"]);
    expect(result.model).toBe("deepseek:deepseek-v4-flash");
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[2]).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash", ok: true });
    expect(JSON.stringify(result.attempts)).not.toMatch(/sk-mm-test|sk-sf-test|sk-ds-test|sk-mimo-test/);
  });

  it("deadline 只剩 3s 时 fetch failed 不重试", async () => {
    const dispatch = vi.fn<JobDispatch>(async () => {
      throw new Error("fetch failed");
    });
    await expect(
      callJob(
        baseParams(dispatch, {
          deadlineMs: Date.now() + 3_000,
          env: { RHG_MODEL_ASSESS: "minimax:MiniMax-M3:low" },
        }),
      ),
    ).rejects.toMatchObject({
      attempts: [expect.objectContaining({ provider: "minimax", ok: false, error: expect.stringMatching(/fetch failed/) })],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
