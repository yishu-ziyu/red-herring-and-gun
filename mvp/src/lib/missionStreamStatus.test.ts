import { describe, expect, it } from "vitest";
import { summarizeMissionStreamStatus } from "./missionStreamStatus";

describe("summarizeMissionStreamStatus", () => {
  it("counts real stream statuses without synthetic percentage", () => {
    const summary = summarizeMissionStreamStatus(
      [
        { status: "queued" },
        { status: "running" },
        { status: "completed" },
        { status: "failed" },
        { status: "final" },
      ],
      "running",
    );

    expect(summary).toEqual({
      total: 5,
      queued: 1,
      running: 1,
      completed: 1,
      failed: 1,
      final: 1,
      done: 2,
      headline: "2 完成 · 1 运行 · 1 失败",
      detail: "5 条真实事件 · 1 排队",
    });
  });

  it("uses waiting copy when a run has started but no events arrived yet", () => {
    expect(summarizeMissionStreamStatus([], "running")).toEqual({
      total: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      final: 0,
      done: 0,
      headline: "等待事件",
      detail: "中控已启动，等待第一条真实事件",
    });
  });

  it("does not contain percent-based progress language", () => {
    const summary = summarizeMissionStreamStatus([{ status: "running" }], "running");

    expect(summary.headline).not.toMatch(/\d+%|进度/);
    expect(summary.detail).not.toMatch(/\d+%|进度/);
  });
});
