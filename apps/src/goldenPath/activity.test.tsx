import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { applyRunEvent, type RunState } from "./useInvestigationRun";
import { conflictKnownReason, investigatingUnassessed } from "./fixtures";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";
import type { InvestigationSnapshotV1, PublicActivity } from "../lib/investigation";

afterEach(() => {
  cleanup();
});

const RUN = "run-1";

function activity(seq: number, overrides: Partial<PublicActivity> = {}): PublicActivity {
  return {
    version: 1,
    id: `${RUN}:${seq}`,
    runId: RUN,
    seq,
    occurredAt: "2026-09-11T10:00:00.000Z",
    kind: "search_started",
    role: "source",
    claimIds: [],
    sourceIds: [],
    snapshotRevision: 1,
    payload: { query: `查询 ${seq}` },
    ...overrides,
  } as PublicActivity;
}

function eventFor(activityValue: PublicActivity): OrchestrateStreamEvent {
  return { type: "investigation_activity", activity: activityValue };
}

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

function stateAfter(...activities: PublicActivity[]): RunState {
  return activities.reduce((state, item) => applyRunEvent(state, eventFor(item)), INITIAL);
}

function renderCanvas(snapshot: InvestigationSnapshotV1, activities: PublicActivity[] = []) {
  return render(
    <InvestigationCanvas
      snapshot={snapshot}
      live
      activities={activities}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

describe("C9 活动累计：去重、乱序、重放", () => {
  it("同 id 到达两次只留一条", () => {
    const state = stateAfter(activity(1), activity(1));
    expect(state.activities).toHaveLength(1);
  });

  it("乱序到达按 seq 归位", () => {
    const state = stateAfter(activity(3), activity(1), activity(2));
    expect(state.activities.map((a) => a.seq)).toEqual([1, 2, 3]);
  });

  it("整段重放不增加条目", () => {
    const once = [activity(1), activity(2)];
    const state = stateAfter(...once, ...once);
    expect(state.activities.map((a) => a.seq)).toEqual([1, 2]);
  });

  it("换 run 后旧 run 的活动不混在一起", () => {
    const state = stateAfter(activity(1), { ...activity(1), runId: "run-2", id: "run-2:1" });
    expect(state.activities.map((a) => a.runId)).toEqual(["run-2"]);
    expect(state.activityRunId).toBe("run-2");
  });

  it("契约外的活动不进 state", () => {
    const bad = { ...activity(1), kind: "agent_thought", role: "source" } as unknown as PublicActivity;
    expect(stateAfter(bad).activities).toHaveLength(0);
    // 未知版本、缺字段同样拒绝
    expect(stateAfter({ ...activity(1), version: 2 } as unknown as PublicActivity).activities).toHaveLength(0);
    expect(stateAfter({ ...activity(1), runId: undefined } as unknown as PublicActivity).activities).toHaveLength(0);
  });
});

describe("C10 终态不被晚到活动倒退", () => {
  it("complete 之后到达的活动不改 state", () => {
    const ended = applyRunEvent(INITIAL, { type: "complete", finalReport: { claim: "x" } });
    const after = applyRunEvent(ended, eventFor(activity(1)));
    expect(after.activities).toHaveLength(0);
    expect(after.connection).toBe("ended");
  });

  it("error 之后到达的活动不改 state", () => {
    const failed = applyRunEvent(INITIAL, { type: "error", message: "boom" });
    expect(applyRunEvent(failed, eventFor(activity(1))).activities).toHaveLength(0);
  });
});

describe("C11 活动层坏了不影响结果", () => {
  it("没有活动时画布仍渲染完整结果", () => {
    render(
      <InvestigationCanvas
        snapshot={conflictKnownReason()}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    expect(screen.getByLabelText("调查结论")).toBeTruthy();
    expect(document.querySelector("[data-gp-activity-count]")).toBeNull();
  });

  it("只有快照、没有 activity 字段的事件流仍能出结果", () => {
    const snapshot = conflictKnownReason();
    const state = applyRunEvent(INITIAL, { type: "investigation_snapshot", investigation: snapshot });
    expect(state.snapshot).toBeTruthy();
    expect(state.activities).toEqual([]);
  });
});

describe("C13/C14 调查中渲染活动行并可从活动打开来源", () => {
  it("按顺序渲染模板文案", () => {
    const snapshot = investigatingUnassessed();
    const sourceId = snapshot.sources[0]?.id ?? "";
    renderCanvas(snapshot, [
      activity(1, {
        kind: "claim_decomposed",
        role: "question",
        claimIds: [snapshot.claims[0]!.id],
        payload: { claimText: "某市下周将试点无人驾驶公交" },
      }),
      activity(2, {
        kind: "source_checked",
        role: "source",
        claimIds: [snapshot.claims[0]!.id],
        sourceIds: [sourceId],
        payload: { title: "某市交通局公告", domain: "example.org", role: "support" },
      }),
    ]);
    expect(screen.getByText("拆出问题：某市下周将试点无人驾驶公交")).toBeTruthy();
    expect(screen.getByText(/判定这条材料：支持/)).toBeTruthy();
  });

  it("有源引用的活动可点开对应来源", () => {
    const snapshot = investigatingUnassessed();
    const claim = snapshot.claims[0]!;
    const link = claim.evidence.find((item) => item.role !== "unassessed") ?? claim.evidence[0];
    if (!link) return;
    renderCanvas(snapshot, [
      activity(1, {
        kind: "source_found",
        role: "source",
        claimIds: [claim.id],
        sourceIds: [link.sourceId],
        payload: { title: "某市交通局公告", domain: "example.org" },
      }),
    ]);
    const line = document.querySelector<HTMLElement>(".gp-activity-line.is-linked");
    expect(line).toBeTruthy();
    fireEvent.click(line!);
    const panel = document.querySelector("[data-gp-source-layer] [data-gp-source-id]");
    expect(panel?.getAttribute("data-gp-source-id")).toBe(link.sourceId);
  });

  it("引用对象不在快照里就不渲染成可点行", () => {
    const snapshot = investigatingUnassessed();
    renderCanvas(snapshot, [
      activity(1, {
        kind: "source_found",
        role: "source",
        claimIds: [snapshot.claims[0]!.id],
        sourceIds: ["src-does-not-exist"],
        payload: { title: "不存在", domain: "example.org" },
      }),
    ]);
    expect(document.querySelector(".gp-activity-line.is-linked")).toBeNull();
    expect(screen.getByText("带回材料：不存在 · example.org")).toBeTruthy();
  });
});

describe("C15 用户上滚时新发现不抢滚动", () => {
  it("不在底部时显示「有 N 条新发现」，点它才回到底部", () => {
    const snapshot = investigatingUnassessed();
    const { rerender } = renderCanvas(snapshot, [activity(1)]);
    const scroller = document.querySelector<HTMLElement>(".gp-activity-scroller")!;
    // jsdom 没有布局：把滚动几何定死，模拟「用户已经上滚看旧项」
    Object.defineProperty(scroller, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(scroller.getAttribute("data-gp-activity-pinned")).toBe("0");

    rerender(
      <InvestigationCanvas
        snapshot={snapshot}
        live
        activities={[activity(1), activity(2), activity(3)]}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const badge = document.querySelector<HTMLElement>("[data-gp-activity-unseen]")!;
    expect(badge.textContent).toBe("有 2 条新发现");
    expect(scroller.scrollTop).toBe(0);

    fireEvent.click(badge);
    expect(document.querySelector("[data-gp-activity-unseen]")).toBeNull();
  });
});
