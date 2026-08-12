import { describe, expect, it } from "vitest";
import { adaptOrchestrateStreamToShell } from "./streamAdapter";
import {
  FIXTURE_AGENT_ERROR,
  FIXTURE_COMPLETE,
  FIXTURE_EARLY,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_REVIEW_FAIL,
} from "./fixtures";
import {
  buildVisibleProcessRows,
  humanizeProcessTitle,
  narrativeHasBannedPrimaryCopy,
  primaryNarrativeCopy,
  semanticActionTitleForAgent,
} from "./visibleProcessRows";

describe("buildVisibleProcessRows", () => {
  it("humanizeProcessTitle strips orchestrator voice", () => {
    expect(humanizeProcessTitle("先派发可行动线索")).toBe("确定核查切入点");
    expect(humanizeProcessTitle("理解命题与路径")).toBe("确认核查问题");
  });

  it("semanticActionTitleForAgent is action not role label", () => {
    expect(semanticActionTitleForAgent("rumor_detector")).toBe("确认核查切入点");
    expect(semanticActionTitleForAgent("fact_checker")).toBe("对照公开事实");
    expect(semanticActionTitleForAgent("rumor_detector")).not.toBe("拆题");
  });

  it("FIXTURE_EARLY: no pending wall; tools nested not primary", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY);
    const n = buildVisibleProcessRows(model);

    expect(n.mode).toBe("running");
    expect(n.rows.every((r) => r.status !== "pending")).toBe(true);
    const primaryTitles = n.rows.map((r) => r.title);
    expect(primaryTitles).not.toContain("查阅历史案件");
    const nestedMemory = n.rows.some((r) =>
      r.activities.some((a) => /历史|查阅/.test(a.title))
    );
    expect(nestedMemory).toBe(true);
    expect(n.currentKey).toBeTruthy();
    expect(n.rows.filter((r) => r.isCurrent)).toHaveLength(1);
    // Agents must not be primary kind
    expect(n.rows.every((r) => (r as { kind: string }).kind !== "agent")).toBe(true);
  });

  it("FIXTURE_MID: one current; tools nested; agents never primary rows", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const n = buildVisibleProcessRows(model);

    expect(n.mode).toBe("running");
    expect(n.rows.filter((r) => r.isCurrent)).toHaveLength(1);

    // No kind=agent primary timeline nodes
    expect(n.rows.every((r) => r.kind !== ("agent" as never))).toBe(true);
    // Role labels are not primary titles
    const titles = n.rows.map((r) => r.title);
    expect(titles).not.toContain("拆题");
    expect(titles).not.toContain("事实核查");
    expect(titles).not.toContain("信源审计");
    // Role names appear only as actor attribution on semantic steps
    const withActor = n.rows.filter((r) => r.actor);
    expect(withActor.length).toBeGreaterThan(0);
    for (const r of withActor) {
      expect(r.actor!.name).toBeTruthy();
      expect(r.title).not.toBe(r.actor!.name);
    }

    const hasNestedSearch = n.rows.some((r) =>
      r.activities.some((a) => /检索|公开材料|历史/.test(a.title))
    );
    expect(hasNestedSearch).toBe(true);

    // Tool titles not primary
    expect(titles).not.toContain("检索公开材料");
    expect(titles).not.toContain("查阅历史案件");

    expect(narrativeHasBannedPrimaryCopy(n)).toBe(false);
    const copy = primaryNarrativeCopy(n).join("\n");
    expect(copy).not.toMatch(/中控|派发|可行动线索|handoff|relay|tool result/i);
  });

  it("FIXTURE_COMPLETE: showVerdict, process demoted, no current parade", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);
    const n = buildVisibleProcessRows(model);

    expect(n.mode).toBe("complete");
    expect(n.showVerdict).toBe(true);
    expect(n.deferredReview).toBe(false);
    expect(n.rows.every((r) => !r.isCurrent)).toBe(true);
    expect(n.collapsedCount).toBeGreaterThan(0);
    expect(n.rows.every((r) => r.kind !== ("agent" as never))).toBe(true);
  });

  it("FIXTURE_REVIEW_FAIL: deferred, no formal showVerdict", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_REVIEW_FAIL);
    const n = buildVisibleProcessRows(model);

    expect(n.mode).toBe("deferred");
    expect(n.deferredReview).toBe(true);
    expect(n.showVerdict).toBe(false);
  });

  it("FIXTURE_ERROR: error mode, tools not dual primary", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_ERROR);
    const n = buildVisibleProcessRows(model);

    expect(n.mode).toBe("error");
    expect(n.errorMessage).toContain("上游中断");
    expect(n.showVerdict).toBe(false);
    expect(n.rows.filter((r) => r.title === "检索公开材料").length).toBe(0);
  });

  it("FIXTURE_AGENT_ERROR: local failure on semantic step, not role primary", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_AGENT_ERROR);
    const n = buildVisibleProcessRows(model);

    expect(n.mode).toBe("running");
    expect(n.errorMessage).toBeUndefined();
    const failed = n.rows.find((r) => r.status === "error");
    expect(failed).toBeTruthy();
    expect(failed!.kind).not.toBe("agent" as never);
    expect(failed!.title).not.toBe("拆题");
    if (failed!.actor) {
      expect(failed!.title).not.toBe(failed!.actor.name);
    }
    expect(n.rows.filter((r) => r.isCurrent).length).toBeLessThanOrEqual(1);
  });
});
