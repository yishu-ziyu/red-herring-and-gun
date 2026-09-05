import { describe, expect, it } from "vitest";
import { toPublicStreamEvent } from "./toPublicStreamEvent.js";

describe("toPublicStreamEvent", () => {
  it("strips provider even when the key is exactly provider", () => {
    const publicEvent = toPublicStreamEvent({
      type: "search.source.finished",
      provider: "any_search",
      model: "minimax:MiniMax-M3",
      error: "MiniMax API 调用失败：sk-secret",
      requestId: "req_secret",
      request_id: "req_secret_2",
      latency: 12,
      latencyMs: 12,
      query: "官方通报",
      claimId: "c1",
      outcome: "failed",
      hitCount: 0,
      errorCategory: "unknown",
    });
    const text = JSON.stringify(publicEvent);
    expect(publicEvent.provider).toBeUndefined();
    expect(publicEvent.model).toBeUndefined();
    expect(publicEvent.error).toBeUndefined();
    expect(publicEvent.requestId).toBeUndefined();
    expect(publicEvent.request_id).toBeUndefined();
    expect(publicEvent.latency).toBeUndefined();
    expect(publicEvent.latencyMs).toBeUndefined();
    expect(publicEvent.errorCategory).toBe("unknown");
    expect(publicEvent.query).toBe("官方通报");
    expect(publicEvent.outcome).toBe("failed");
    expect(text).not.toMatch(/any_search|minimax|sk-secret|req_secret/i);
  });
});
