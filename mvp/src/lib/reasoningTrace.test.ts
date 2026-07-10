import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getTraceCollector,
  resetTraceCollector,
  type TraceStep,
} from "./reasoningTrace";

describe("getTraceCollector", () => {
  beforeEach(() => {
    resetTraceCollector();
  });

  it("returns a singleton collector", () => {
    const c1 = getTraceCollector();
    const c2 = getTraceCollector();
    expect(c1).toBe(c2);
  });

  it("emits step with monotonic id", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-1");
    c.emit({ agent: "rumor_detector", action: "start", status: "running", timestamp: 1 });
    c.emit({ agent: "rumor_detector", action: "done", status: "completed", timestamp: 2 });
    await new Promise((r) => setTimeout(r, 10));
    const steps = c.getSteps("sess-1");
    expect(steps.length).toBe(2);
    expect(steps[0].id).toBe(1);
    expect(steps[1].id).toBe(2);
  });

  it("subscribe receives emitted steps", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-2");
    const received: TraceStep[] = [];
    const unsub = c.subscribe((s) => received.push(s));
    c.emit({ agent: "fact_checker", action: "x", status: "completed", timestamp: 100 });
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);
    expect(received[0].action).toBe("x");
    unsub();
  });

  it("unsubscribe stops further deliveries", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-3");
    const received: TraceStep[] = [];
    const unsub = c.subscribe((s) => received.push(s));
    c.emit({ agent: "a", action: "1", status: "running", timestamp: 1 });
    await new Promise((r) => setTimeout(r, 10));
    unsub();
    c.emit({ agent: "a", action: "2", status: "running", timestamp: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);
    expect(received[0].action).toBe("1");
  });

  it("failed step does not throw", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-4");
    expect(() =>
      c.emit({
        agent: "x",
        action: "fail",
        status: "failed",
        timestamp: 1,
        meta: { error: "boom" },
      }),
    ).not.toThrow();
    const steps = c.getSteps("sess-4");
    expect(steps[0].status).toBe("failed");
  });

  it("subscribe handler throwing does not break dispatch", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-5");
    const good: TraceStep[] = [];
    c.subscribe(() => {
      throw new Error("handler-1-broke");
    });
    c.subscribe((s) => good.push(s));
    c.emit({ agent: "x", action: "y", status: "running", timestamp: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(good.length).toBe(1);
  });

  it("clear removes only matching session", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-A");
    c.emit({ agent: "x", action: "y", status: "completed", timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    c.setSessionId("sess-B");
    c.emit({ agent: "x", action: "z", status: "completed", timestamp: 2 });
    await new Promise((r) => setTimeout(r, 5));
    c.clear("sess-A");
    expect(c.getSteps("sess-A")).toHaveLength(0);
    expect(c.getSteps("sess-B").length).toBeGreaterThan(0);
  });

  it("getSteps without sessionId returns all steps", async () => {
    const c = getTraceCollector();
    c.setSessionId("sess-all");
    c.emit({ agent: "x", action: "1", status: "completed", timestamp: 1 });
    c.emit({ agent: "y", action: "2", status: "completed", timestamp: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(c.getSteps().length).toBeGreaterThanOrEqual(2);
  });

  it("explicit sessionId on emit overrides current session", async () => {
    const c = getTraceCollector();
    c.setSessionId("default");
    c.emit({
      agent: "x",
      action: "y",
      status: "completed",
      timestamp: 1,
      sessionId: "explicit-sess",
    });
    await new Promise((r) => setTimeout(r, 5));
    const explicit = c.getSteps("explicit-sess");
    expect(explicit.length).toBe(1);
  });
});