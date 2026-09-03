import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext, type LlmJob } from "./context.js";

describe("createStageContext", () => {
  it("emit 填 seq/at，校验后折叠进 current，并记录到 emitted", () => {
    const { case: c } = createCase({ id: "c1", text: "原句", at: "2026-09-03T00:00:00.000Z" });
    const ctx = createStageContext({ case: c, llm: createFakeLlm({}), now: () => "2026-09-03T00:00:01.000Z" });
    const next = ctx.emit({ type: "stage.started", stage: "decompose" });
    expect(next.seq).toBe(2);
    expect(ctx.current.stages).toEqual([{ stage: "decompose", startedAt: "2026-09-03T00:00:01.000Z", seq: 2 }]);
    expect(ctx.emitted.map((e) => e.type)).toEqual(["stage.started"]);
  });

  it("onEvent 按 emit 顺序同步收到已折叠事件", () => {
    const { case: c } = createCase({ id: "c1", text: "原句" });
    const seen: string[] = [];
    const ctx = createStageContext({ case: c, llm: createFakeLlm({}), onEvent: (e) => seen.push(`${e.type}@${e.seq}`) });
    ctx.emit({ type: "stage.started", stage: "decompose" });
    ctx.emit({ type: "stage.finished", stage: "decompose", outcome: "ok" });
    expect(seen).toEqual(["stage.started@2", "stage.finished@3"]);
  });

  it("非法事件在 emit 处抛错，current 不变", () => {
    const { case: c } = createCase({ id: "c1", text: "原句" });
    const ctx = createStageContext({ case: c, llm: createFakeLlm({}) });
    expect(() => ctx.emit({ type: "stage.finished", stage: "x", outcome: "nope" } as never)).toThrow();
    expect(ctx.current.seq).toBe(1);
  });

  it("llm 成功与失败都发 llm.called，脚本按次序消费", async () => {
    const { case: c } = createCase({ id: "c1", text: "原句" });
    const fake = createFakeLlm({ decompose: [{ claims: [] }, new Error("boom")] });
    const ctx = createStageContext({ case: c, llm: fake });
    const ok = await ctx.llm({ job: "decompose", systemPrompt: "s", userContent: "u" });
    expect(ok.output).toEqual({ claims: [] });
    await expect(ctx.llm({ job: "decompose", systemPrompt: "s", userContent: "u" })).rejects.toThrow("boom");
    expect(ctx.current.llmCalls.map((r) => r.ok)).toEqual([true, false]);
    const failed = ctx.emitted.find((e) => e.type === "llm.called" && !e.ok);
    expect(failed && "error" in failed ? failed.error : undefined).toBe("boom");
    expect(fake.calls).toHaveLength(2);
  });

  it("llm 把 signal 与 deadlineMs 传给 FakeLlm，并写入 attempts", async () => {
    const { case: c } = createCase({ id: "c1", text: "原句" });
    const ac = new AbortController();
    const inner = createFakeLlm({
      assess: { stances: [] },
    });
    const llm: LlmJob = async (params) => {
      const result = await inner(params);
      return {
        ...result,
        attempts: [{ provider: "minimax", model: "MiniMax-M3", ok: true, latencyMs: 1 }],
      };
    };
    const ctx = createStageContext({
      case: c,
      llm,
      signal: ac.signal,
      deadline: 1_700_000_000_000,
    });
    const result = await ctx.llm({ job: "assess", systemPrompt: "s", userContent: "u" });
    expect(inner.calls[0]?.signal).toBe(ac.signal);
    expect(inner.calls[0]?.deadlineMs).toBe(1_700_000_000_000);
    expect(result.attempts).toEqual([{ provider: "minimax", model: "MiniMax-M3", ok: true, latencyMs: 1 }]);
    expect(ctx.emitted.find((event) => event.type === "llm.called")).toMatchObject({
      attempts: [{ provider: "minimax", model: "MiniMax-M3", ok: true, latencyMs: 1 }],
    });
  });

  it("调用方 deadlineMs 优先于 context deadline", async () => {
    const { case: c } = createCase({ id: "c1", text: "原句" });
    const inner = createFakeLlm({ assess: { stances: [] } });
    const ctx = createStageContext({ case: c, llm: inner, deadline: 100 });
    await ctx.llm({ job: "assess", systemPrompt: "s", userContent: "u", deadlineMs: 900 });
    expect(inner.calls[0]?.deadlineMs).toBe(900);
  });

  it("不传 deadlineMs 则用 context deadline", async () => {
    const { case: c } = createCase({ id: "c1", text: "原句" });
    const inner = createFakeLlm({ assess: { stances: [] } });
    const ctx = createStageContext({ case: c, llm: inner, deadline: 100 });
    await ctx.llm({ job: "assess", systemPrompt: "s", userContent: "u" });
    expect(inner.calls[0]?.deadlineMs).toBe(100);
  });
});
