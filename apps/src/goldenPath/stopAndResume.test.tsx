/**
 * 停止、重连、保存状态（docs/evals/2026-09-11-run-service.md 片二 D20–D22）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { applyRunEvent, type RunState } from "./useInvestigationRun";
import { investigatingUnassessed } from "./fixtures";

const requestOrchestrateStream = vi.fn();
vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return { ...actual, requestOrchestrateStream: (...args: unknown[]) => requestOrchestrateStream(...args) };
});
vi.mock("../lib/investigationResume", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/investigationResume")>();
  return { ...actual, cancelInvestigation: vi.fn(async () => ({ ok: true, status: "cancelling" })) };
});

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
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCanvas(overrides: Partial<Parameters<typeof InvestigationCanvas>[0]> = {}) {
  return render(
    <InvestigationCanvas
      snapshot={investigatingUnassessed()}
      live
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
      {...overrides}
    />
  );
}

describe("D20 停止：只有服务端确认才说已停止", () => {
  it("调查中显示停止按钮，点了回调一次", () => {
    const onStop = vi.fn();
    renderCanvas({ onStop });
    const button = document.querySelector<HTMLElement>("[data-gp-stop]")!;
    expect(button.textContent).toBe("停止调查");
    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("正在停：按钮变「正在停止」且不可再点，同时不显示已停止", () => {
    renderCanvas({ onStop: () => {}, stop: "stopping" });
    const button = document.querySelector<HTMLElement>("[data-gp-stop]")!;
    expect(button.textContent).toBe("正在停止");
    expect(button.hasAttribute("disabled")).toBe(true);
    const section = document.querySelector("[data-gp-stopped]")!;
    expect(section.getAttribute("data-gp-stop-state")).toBe("stopping");
    expect(section.textContent).toContain("正在停止");
    // 后端还没确认，就不许说「已停止」
    expect(section.textContent).not.toContain("已停止");
  });

  it("已停止：按钮退场，出现「已停止」，材料仍然在", () => {
    renderCanvas({ onStop: () => {}, stop: "stopped" });
    expect(document.querySelector("[data-gp-stop]")).toBeNull();
    const section = document.querySelector("[data-gp-stopped]")!;
    expect(section.getAttribute("data-gp-stop-state")).toBe("stopped");
    expect(section.textContent).toContain("已停止");
    // 已获得的材料不能因为停止就消失
    expect(document.querySelector(".gp-claims")).toBeTruthy();
  });

  it("说「重新调查一次」就必须真的有那个按钮", () => {
    const onReverify = vi.fn();
    renderCanvas({ onStop: () => {}, stop: "stopped", onReverify });
    const retry = document.querySelector<HTMLElement>("[data-gp-stopped-retry]")!;
    expect(retry.textContent).toBe("重新调查");
    fireEvent.click(retry);
    expect(onReverify).toHaveBeenCalledTimes(1);
  });

  it("正在停止时不给重新调查（还在停，不是停完了）", () => {
    renderCanvas({ onStop: () => {}, stop: "stopping" });
    expect(document.querySelector("[data-gp-stopped-retry]")).toBeNull();
  });

  it("已停止时不重复说「中断」：同一次事故只有一种说法", () => {
    const snapshot = { ...investigatingUnassessed(), phase: "interrupted" as const };
    renderCanvas({ snapshot, live: false, onStop: () => {}, stop: "stopped" });
    expect(document.querySelector("[data-gp-interrupted]")).toBeNull();
    expect(document.querySelector("[data-gp-stopped]")!.textContent).toContain("已停止");
  });

  it("不是用户停的，仍然按「中断」读", () => {
    const snapshot = { ...investigatingUnassessed(), phase: "interrupted" as const };
    renderCanvas({ snapshot, live: false });
    expect(document.querySelector("[data-gp-interrupted]")).toBeTruthy();
    expect(document.querySelector("[data-gp-stopped]")).toBeNull();
  });

  it("没有 runId 时不给停止按钮（点了也没有对象可停）", () => {
    renderCanvas({ onStop: undefined });
    expect(document.querySelector("[data-gp-stop]")).toBeNull();
  });
});

describe("D20 run_state 事件驱动停止三态", () => {
  it("run_started 记下 runId", () => {
    const next = applyRunEvent(INITIAL, { type: "run_started", runId: "run-9", caseId: "case-9" });
    expect(next.runId).toBe("run-9");
  });

  it("run_state=cancelling → stopping；=cancelled → stopped", () => {
    const stopping = applyRunEvent(INITIAL, { type: "run_state", status: "cancelling" });
    expect(stopping.stop).toBe("stopping");
    const stopped = applyRunEvent(stopping, { type: "run_state", status: "cancelled" });
    expect(stopped.stop).toBe("stopped");
    expect(stopped.serverStatus).toBe("cancelled");
  });

  it("run_state=completed 不把 stop 说成已停止", () => {
    const done = applyRunEvent(INITIAL, { type: "run_state", status: "completed", terminal: true });
    expect(done.stop).toBe("idle");
    expect(done.serverStatus).toBe("completed");
  });
});

describe("D22 保存状态独立显示", () => {
  it("四种状态各自有可读文案", () => {
    for (const [status, text] of [
      ["local", "已保存在此设备"],
      ["syncing", "同步中"],
      ["synced", "已同步"],
      ["failed", "同步失败，重试"],
    ] as const) {
      cleanup();
      renderCanvas({ saveStatus: status });
      expect(document.querySelector(`[data-gp-save-status="${status}"]`)!.textContent).toBe(text);
    }
  });

  it("idle 不渲染任何保存状态", () => {
    renderCanvas({ saveStatus: "idle" });
    expect(document.querySelector("[data-gp-save-status]")).toBeNull();
  });
});

describe("D21 刷新恢复：接回原 run，不重开调查", () => {
  it("本地留过座标 → 调 resume 而不是 start", async () => {
    vi.resetModules();
    window.localStorage.setItem(
      "rhg:active-run",
      JSON.stringify({ runId: "run-stored-1", claim: "隔夜菜会致癌", intake: { text: "隔夜菜会致癌", links: [], images: [] }, lastSeq: 4, at: 1_760_000_000_000 })
    );
    const resumeSpy = vi.fn(() => ({ cancel: () => {} }));
    vi.doMock("../lib/investigationResume", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../lib/investigationResume")>();
      return { ...actual, resumeInvestigationStream: resumeSpy, cancelInvestigation: vi.fn(async () => ({ ok: true, status: "cancelling" })) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : "";
      if (url.includes("/api/cases")) {
        return new Response(JSON.stringify({ cases: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { "Content-Type": "application/json" } });
    });

    const { default: App } = await import("../App");
    render(<App />);
    await waitFor(() => expect(resumeSpy).toHaveBeenCalled());
    const [runId, after] = resumeSpy.mock.calls[0] as unknown as [string, number];
    expect(runId).toBe("run-stored-1");
    // 从断点接：after 是上次看过的 seq，不是从头
    expect(after).toBe(4);
    window.localStorage.clear();
  });
});
