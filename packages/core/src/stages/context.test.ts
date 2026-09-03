import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext } from "./context.js";

describe("createStageContext", () => {
  it("emit 填 seq/at，校验后折叠进 current，并记录到 emitted", () => {
    const { case: c } = createCase({ id: "c1", text: "原句", at: "2026-09-03T00:00:00.000Z" });
    const ctx = createStageContext({ case: c, llm: createFakeLlm({}), now: () => "2026-09-03T00:00:01.000Z" });
    const next = ctx.emit({ type: "stage.started", stage: "decompose" });
    expect(next.seq).toBe(2);
    expect(ctx.current.stages).toEqual([{ stage: "decompose", startedAt: "2026-09-03T00:00:01.000Z", seq: 2 }]);
    expect(ctx.emitted.map((e) => e.type)).toEqual(["stage.started"]);
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
});
