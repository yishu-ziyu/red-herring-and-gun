/** R10 E8：notice 帧进入运行状态并常驻（契约 docs/evals/2026-09-29-r10-image.md）。 */
import { describe, expect, it } from "vitest";
import { applyRunEvent, type RunState } from "./useInvestigationRun";

const INITIAL: RunState = {
  snapshot: null,
  connection: "connecting",
  errorMessage: "",
  finalReport: null,
  activities: [],
  activityRunId: null,
  lastActivitySeq: 0,
  runId: null,
  serverStatus: null,
  stop: "idle",
  timeoutPending: false,
};

const TEXT = "图片没能读出来，已按你输入的文字继续";

describe("notice 帧", () => {
  it("记下文案，连接与快照不动", () => {
    const next = applyRunEvent(INITIAL, { type: "notice", code: "image_unreadable", message: TEXT });
    expect(next.notice).toBe(TEXT);
    expect(next.connection).toBe("connecting");
    expect(next.snapshot).toBeNull();
  });

  it("调查完成后提示仍在", () => {
    const withNotice = applyRunEvent(INITIAL, { type: "notice", code: "image_unreadable", message: TEXT });
    const done = applyRunEvent(withNotice, { type: "complete", finalReport: { conclusion: "x" } }, "原句");
    expect(done.connection).toBe("ended");
    expect(done.notice).toBe(TEXT);
  });

  it("没有文案的 notice 帧被忽略", () => {
    expect(applyRunEvent(INITIAL, { type: "notice" }).notice).toBeUndefined();
  });
});
