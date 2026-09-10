import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInvestigationSnapshot, sourceIdsStableAcross, type InvestigationSnapshotV1 } from "@rhg/core/investigation";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { buildClaimTraceSegments } from "./claimTrace";
import {
  conflictKnownReason,
  conflictUnknownReason,
  interruptedPartial,
  investigatingUnassessed,
  LONG_CLAIM_PREFIX,
  longClaimComplete,
  MIXED_ATOM_A,
  MIXED_ATOM_B,
  MIXED_CLAIM,
  mixedComplete,
  mixedWithoutSpans,
  refutedComplete,
  supportedComplete,
  unresolvedComplete,
} from "./fixtures";
import { applyRunEvent, type RunState } from "./useInvestigationRun";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";
import { identifyEvidenceLinks, type EvidenceRole } from "./snapshotUi";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return { ...actual, requestOrchestrateStream: vi.fn() };
});

afterEach(() => {
  cleanup();
});

function renderCanvas(snapshot: ReturnType<typeof refutedComplete>, finalReport: Record<string, unknown> | null = null) {
  return render(
    <InvestigationCanvas
      snapshot={snapshot}
      live={false}
      finalReport={finalReport}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

describe("golden case 1：明确错误（complete）", () => {
  it("directAnswer 第一视觉层级；judgment=refuted；反驳来源可下钻", () => {
    renderCanvas(refutedComplete());
    const hero = screen.getByLabelText("调查结论");
    expect(within(hero).getByText(/原句站不住/)).toBeTruthy();
    expect(hero.getAttribute("data-gp-conclusion-judgment")).toBe("refuted");
    expect(within(hero).getByText("证据反驳")).toBeTruthy();

    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    expect(within(claim as HTMLElement).getByText("证据反驳")).toBeTruthy();
    const contradictGroup = claim.querySelector('[data-gp-role="contradict"]')!;
    expect(within(contradictGroup as HTMLElement).getByText("世卫组织辟谣平台：无此结论")).toBeTruthy();

    fireEvent.click(within(contradictGroup as HTMLElement).getByText("世卫组织辟谣平台：无此结论"));
    const drawer = document.querySelector(".gp-drawer--source")!;
    const link = drawer.querySelector('a[href="https://piyao.org.cn/overnight-water"]');
    expect(link).toBeTruthy();
  });
});

describe("golden case 2：基本正确（complete）", () => {
  it("judgment=supported，支持组存在", () => {
    renderCanvas(supportedComplete());
    expect(screen.getByLabelText("调查结论").getAttribute("data-gp-conclusion-judgment")).toBe("supported");
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    expect(claim.querySelector('[data-gp-role="support"]')).toBeTruthy();
  });
});

describe("golden case 3：半真半假（complete）", () => {
  it("两条独立命题各自判断，不压成单一真假", () => {
    renderCanvas(mixedComplete());
    const claimA = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    const claimB = document.querySelector('[data-gp-claim-id="claim-2"]')!;
    expect(within(claimA as HTMLElement).getByText("有对有错")).toBeTruthy();
    expect(within(claimB as HTMLElement).getByText("证据反驳")).toBeTruthy();
  });
});

describe("golden case 4：证据不足（complete）", () => {
  it("open Gap 无来源也显示；不显示成反驳", () => {
    renderCanvas(unresolvedComplete());
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    expect(within(claim as HTMLElement).getByText("证据不足")).toBeTruthy();
    expect(within(claim as HTMLElement).getByText("尚缺")).toBeTruthy();
    expect(within(claim as HTMLElement).getByText(/定向检索无结果/)).toBeTruthy();
    // 没找到证据 ≠ 反驳：这条命题不允许出现反驳组
    expect(claim.querySelector('[data-gp-role="contradict"]')).toBeNull();
  });
});

describe("golden case 5：真实冲突（complete）", () => {
  it("known reason：展示争点原因", () => {
    renderCanvas(conflictKnownReason());
    const conflict = document.querySelector("[data-gp-conflict-id]")!;
    expect(within(conflict as HTMLElement).getByText(/分歧来自适用范围/)).toBeTruthy();
  });

  it("unknown reason：如实未知，不渲染虚构原因", () => {
    renderCanvas(conflictUnknownReason());
    const conflict = document.querySelector("[data-gp-conflict-id]")!;
    expect(within(conflict as HTMLElement).getByText("双方材料并存，分歧的原因目前还不清楚。")).toBeTruthy();
    expect(conflict.textContent).not.toContain("分歧来自适用范围");
  });
});

describe("调查态（investigating）", () => {
  it("unassessed 显示中性「待核对」，绝不染成支持/反驳", () => {
    renderCanvas(investigatingUnassessed());
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    const heading = claim.querySelector('[data-gp-group-role="unassessed"]')!;
    expect(within(heading as HTMLElement).getByText("待核对")).toBeTruthy();
    expect(claim.querySelector('[data-gp-role="unassessed"]')).toBeTruthy();
    expect(claim.querySelector('[data-gp-role="support"]')).toBeNull();
    expect(claim.querySelector('[data-gp-role="contradict"]')).toBeNull();
    expect(within(claim as HTMLElement).getByText("正在追查")).toBeTruthy();
  });
});

describe("边界", () => {
  it("interrupted：保留真实数据、无伪结论、可重试", () => {
    const onReverify = vi.fn();
    render(
      <InvestigationCanvas
        snapshot={interruptedPartial()}
        live={false}
        finalReport={null}
        onReverify={onReverify}
        onBackHome={() => {}}
      />
    );
    expect(screen.queryByLabelText("调查结论")).toBeNull();
    expect(screen.getByText("这次调查没有完成")).toBeTruthy();
    expect(document.querySelectorAll("[data-gp-claim-id]").length).toBe(2);
    expect(document.querySelector('[data-gp-interrupted]')).toBeTruthy();
    const banner = document.querySelector("[data-gp-interrupted]")!;
    fireEvent.click(within(banner as HTMLElement).getByText("重新调查"));
    expect(onReverify).toHaveBeenCalled();
  });

  it(">180 字命题完整显示，不使用内部截断键", () => {
    renderCanvas(longClaimComplete());
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    const text = within(claim as HTMLElement).getByText(/某市宣布全市出租车/).textContent!;
    expect(text.length).toBeGreaterThan(180);
    expect(text).not.toContain("…");
    expect(text.startsWith(LONG_CLAIM_PREFIX)).toBe(false);
  });

  it("reachable=false 来源显示不可达，drawer 有警示", () => {
    const snapshot = investigatingUnassessed();
    const withDead = {
      ...snapshot,
      sources: snapshot.sources.map((s) => ({ ...s, reachable: false as const })),
    };
    renderCanvas(withDead);
    fireEvent.click(document.querySelector(".gp-evidence-item")!);
    const drawer = document.querySelector(".gp-drawer--source")!;
    expect(within(drawer as HTMLElement).getByText(/来源目前打不开|打不开/)).toBeTruthy();
  });
});

describe("imageOrigin side-channel", () => {
  it("found：独立辅助卡可点开，且不属于任何命题证据", () => {
    renderCanvas(refutedComplete(), {
      imageOrigin: { status: "found", channel: "reverse-image", url: "https://origin.example/first-post", title: "最早发布页", label: "原图出处" },
    });
    const card = document.querySelector(".gp-image-origin")!;
    const link = card.querySelector('a[href="https://origin.example/first-post"]');
    expect(link).toBeTruthy();
    // 不冒充命题证据：辅助卡不在任何 claim 内
    expect(card.closest("[data-gp-claim-id]")).toBeNull();
  });

  it("not_found：显示「原图出处未查到」全局缺口", () => {
    renderCanvas(refutedComplete(), {
      imageOrigin: { status: "not_found", channel: "none", label: "原图出处未查到" },
    });
    expect(screen.getByText("原图出处未查到")).toBeTruthy();
  });
});

describe("E2 负向测试：raw legacy 事件不产生任何产品语义", () => {
  const INITIAL: RunState = { snapshot: null, connection: "connecting", errorMessage: "", finalReport: null };
  const legacyEvents: OrchestrateStreamEvent[] = [
    { type: "agent_start", agent: "rumor_detector", agentName: "拆题" },
    { type: "agent_complete", agent: "rumor_detector", output: { claimAtoms: ["假命题甲", "假命题乙"] } },
    { type: "tool_start", toolId: "web_search", query: "假命题甲" },
    { type: "tool_result", toolId: "web_search", result: { sources: [{ url: "https://x.example/a", title: "假来源" }] } },
    { type: "search_progress", atom: "假命题甲", phase: "completed", providers: [], sources: [{ title: "假来源", url: "https://x.example/a", providerOrigins: [] }] },
    { type: "consensus_debate_round", debate: { id: "d", status: "running", title: "冲突调解" } as never },
    { type: "planner_update", plan: { claimType: "rumor" } as never },
  ];

  it("只喂 legacy 事件：snapshot 仍为 null，state 不含任何 Claim/Evidence/结论", () => {
    const state = legacyEvents.reduce((prev, event) => applyRunEvent(prev, event), INITIAL);
    expect(state.snapshot).toBeNull();
    expect(state.finalReport).toBeNull();
  });

  it("investigation_snapshot 是唯一能让命题出现的通道；schema 外快照被拒收", () => {
    const good = investigatingUnassessed();
    let state = legacyEvents.reduce((prev, event) => applyRunEvent(prev, event), INITIAL);
    state = applyRunEvent(state, { type: "investigation_snapshot", investigation: good });
    expect(state.snapshot?.claims.length).toBe(1);

    // 契约外字段（closed schema additionalProperties）→ validate 抛错 → 保留上一份
    const broken = { ...good, provider: "minimax" } as unknown as typeof good;
    const rejected = applyRunEvent(state, { type: "investigation_snapshot", investigation: broken });
    expect(rejected.snapshot).toBe(state.snapshot);
  });

  it("complete 事件的 finalReport 只进入 finalReport 字段，embedded investigation 成为完成态快照", () => {
    const good = refutedComplete();
    let state = applyRunEvent(INITIAL, { type: "investigation_snapshot", investigation: investigatingUnassessed() });
    state = applyRunEvent(state, { type: "complete", finalReport: { conclusion: "x", investigation: good } });
    expect(state.connection).toBe("ended");
    expect(state.snapshot?.phase).toBe("complete");
    expect(state.finalReport?.conclusion).toBe("x");
  });
});

describe("E3 负向扫描：生产 Golden Path 源码无实现层语义", () => {
  it("goldenPath 组件与 copy 不含 legacy 事件名 / Agent 名 / provider / token / pipeline / AI Ping / BatchChecker", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    // jsdom 下 import.meta.url 不是 file://，用 process.cwd()（vitest 从 mvp/ 根跑）。
    const dir = join(process.cwd(), "src", "goldenPath");
    const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    // useInvestigationRun.ts 是唯一允许出现 legacy 事件名的文件（显式忽略清单本身），
    // 由 E2 行为测试证明它不消费这些事件；其余文件一律不得出现。
    const EVENT_NAMES = /agent_start|agent_complete|agent_thought|tool_start|tool_result|search_progress|consensus_debate|planner_update/i;
    const PRODUCT_VOCAB = /RumorDetector|FactChecker|SourceValidator|ReportComposer|AI Ping|BatchChecker|Batch Checker|provider|latencyMs|pipeline|credibilityScore/i;
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      if (file.endsWith(".test.tsx") || file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(dir, file), "utf8");
      text.split("\n").forEach((line, i) => {
        const isStreamHook = file === "useInvestigationRun.ts";
        if (!isStreamHook && EVENT_NAMES.test(line)) violations.push({ file, line: i + 1, text: line.trim() });
        if (PRODUCT_VOCAB.test(line)) violations.push({ file, line: i + 1, text: line.trim() });
      });
    }
    expect(violations).toEqual([]);
  });

  it("App.tsx 默认生产路径不渲染 AI Ping / BatchChecker（Dashboard 仅属于 legacy 壳）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(app).toContain("InputStage");
    expect(app).not.toMatch(/BatchChecker|AI Ping/);
    const legacy = readFileSync(join(process.cwd(), "src", "legacy", "LegacyDesk.tsx"), "utf8");
    expect(legacy).toContain("Dashboard");
  });
});

describe("Issue #64 [Reset 4D] Conclusion Emergence", () => {
  const FUTURE_ANSWER = "公开材料还撑不住这条说法。";

  function completeFromInvestigating() {
    const investigating = investigatingUnassessed();
    return {
      investigating,
      complete: {
        ...investigating,
        phase: "complete" as const,
        conclusion: {
          directAnswer: FUTURE_ANSWER,
          judgment: "unresolved" as const,
          boundaries: ["现有公开材料不能推出异味来自新增消毒工艺"],
          sourceIds: investigating.sources.map((s) => s.id),
          claimIds: investigating.claims.map((c) => c.id),
        },
        checkedAt: "2026-09-06T08:00:00.000Z",
      },
    };
  }

  function mockReducedMotion(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: reduce && /prefers-reduced-motion:\s*reduce/.test(query),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  it("1–5、8–10：persistent region 同一引用；不换壳；不抢焦点；不滚动；Drawer 不关", () => {
    const { investigating, complete } = completeFromInvestigating();
    const view = render(
      <InvestigationCanvas snapshot={investigating} live onReverify={() => {}} onBackHome={() => {}} />
    );

    const region = document.querySelector("[data-gp-conclusion-region]");
    const canvas = document.querySelector(".gp-canvas");
    const original = document.querySelector(".gp-original");
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]');
    expect(region).toBeTruthy();
    expect(region).toBeInstanceOf(HTMLElement);
    expect(region!.getAttribute("data-gp-conclusion-state")).toBe("pending");
    expect(region!.getAttribute("aria-hidden")).toBe("true");
    expect(region!.querySelector("[data-gp-direct-answer]")).toBeNull();
    expect(region!.textContent?.trim()).toBe("");
    expect(document.body.textContent).not.toContain(FUTURE_ANSWER);

    fireEvent.click(document.querySelector(".gp-evidence-item")!);
    const drawer = document.querySelector(".gp-drawer--source");
    expect(drawer).toBeTruthy();

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    if (!("scrollIntoView" in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: () => {},
      });
    }
    const scrollSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    view.rerender(
      <InvestigationCanvas snapshot={complete} live={false} onReverify={() => {}} onBackHome={() => {}} />
    );

    const after = document.querySelector("[data-gp-conclusion-region]");
    expect(after).toBe(region);
    expect(document.querySelector(".gp-canvas")).toBe(canvas);
    expect(document.querySelector(".gp-original")).toBe(original);
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')).toBe(claim);
    expect(document.querySelector(".gp-drawer--source")).toBe(drawer);

    expect(after!.getAttribute("data-gp-conclusion-state")).toBe("complete");
    expect(after!.getAttribute("aria-hidden")).toBeNull();
    const answer = after!.querySelector("[data-gp-direct-answer]");
    expect(answer?.textContent).toContain(FUTURE_ANSWER);
    expect(document.querySelector(".gp-hero-kicker")).toBeNull();
    expect(after!.textContent).not.toMatch(/调查完成/);

    expect(focusSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
    scrollSpy.mockRestore();
  });

  it("Evidence A 已 focus：investigating → complete 后同一节点仍在，焦点不被结论抢走", () => {
    const { investigating, complete } = completeFromInvestigating();
    const view = render(
      <InvestigationCanvas snapshot={investigating} live onReverify={() => {}} onBackHome={() => {}} />
    );
    const evidence = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id]') as HTMLButtonElement;
    expect(evidence).toBeInstanceOf(HTMLButtonElement);
    evidence.focus();
    expect(document.activeElement).toBe(evidence);
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]');
    const board = document.querySelector(".gp-evidence-board");

    view.rerender(
      <InvestigationCanvas snapshot={complete} live={false} onReverify={() => {}} onBackHome={() => {}} />
    );

    const after = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id]') as HTMLButtonElement;
    expect(after).toBe(evidence);
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')).toBe(claim);
    expect(document.querySelector(".gp-evidence-board")).toBe(board);
    expect(document.activeElement).toBe(evidence);
    expect(evidence.getAttribute("data-gp-identity")).toBe("stable");
    expect(document.activeElement?.closest("[data-gp-direct-answer]")).toBeNull();
    expect(document.activeElement?.closest("[data-gp-conclusion-region]")).toBeNull();
  });

  it("Drawer live 打开时 investigating → complete：dialog 同节点、仍 live、焦点不被结论抢走", async () => {
    const { investigating, complete } = completeFromInvestigating();
    const view = render(
      <InvestigationCanvas snapshot={investigating} live onReverify={() => {}} onBackHome={() => {}} />,
    );
    const row = document.querySelector(".gp-evidence-item") as HTMLButtonElement;
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const canvas = document.querySelector(".gp-canvas");
    const original = document.querySelector(".gp-original");
    const board = document.querySelector(".gp-evidence-board");
    const region = document.querySelector("[data-gp-conclusion-region]");

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    if (!("scrollIntoView" in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: () => {},
      });
    }
    const scrollSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    view.rerender(
      <InvestigationCanvas snapshot={complete} live={false} onReverify={() => {}} onBackHome={() => {}} />,
    );

    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(still.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.closest("[data-gp-conclusion-region]")).toBeNull();
    expect(document.querySelector(".gp-canvas")).toBe(canvas);
    expect(document.querySelector(".gp-original")).toBe(original);
    expect(document.querySelector(".gp-evidence-board")).toBe(board);
    expect(document.querySelector("[data-gp-conclusion-region]")).toBe(region);
    expect(focusSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
    scrollSpy.mockRestore();
  });

  it("Drawer held 时 investigating → complete：仍 held，内容不被替换，不误变 live", async () => {
    const base = settlingBoard();
    const sourceId = base.claims[0]!.evidence[0]!.sourceId;
    const unique = withClaimEvidence(base, [
      { sourceId, role: "support", finding: "完成前已确认的支持", limitation: "完成前已确认的边界" },
    ]);
    const duplicated = withClaimEvidence(base, [
      { sourceId, role: "support", finding: "不该因结论出现的新支持" },
      { sourceId, role: "contradict", finding: "不该因结论出现的反驳" },
    ]);
    const completeHeld = {
      ...duplicated,
      phase: "complete" as const,
      conclusion: {
        directAnswer: FUTURE_ANSWER,
        judgment: "unresolved" as const,
        boundaries: ["现有公开材料不能推出异味来自新增消毒工艺"],
        sourceIds: duplicated.sources.map((s) => s.id),
        claimIds: duplicated.claims.map((c) => c.id),
      },
      checkedAt: "2026-09-06T08:00:00.000Z",
    };
    const view = render(
      <InvestigationCanvas snapshot={unique} live onReverify={() => {}} onBackHome={() => {}} />,
    );
    fireEvent.click(document.querySelector(`[data-source-id="${sourceId}"]`)!);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    expect(document.querySelector(".gp-drawer--source")?.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(document.querySelector(".gp-drawer--source")?.textContent).toContain("完成前已确认的支持");

    view.rerender(
      <InvestigationCanvas snapshot={duplicated} live onReverify={() => {}} onBackHome={() => {}} />,
    );
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("held");
    expect(within(dialog).getByText("完成前已确认的支持")).toBeTruthy();

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    view.rerender(
      <InvestigationCanvas snapshot={completeHeld} live={false} onReverify={() => {}} onBackHome={() => {}} />,
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("held");
    expect(within(still).getByText("完成前已确认的支持")).toBeTruthy();
    expect(within(still).getByText("完成前已确认的边界")).toBeTruthy();
    expect(still.textContent).not.toContain("不该因结论出现的新支持");
    expect(still.textContent).not.toContain("不该因结论出现的反驳");
    expect(document.querySelector("[data-gp-direct-answer]")?.textContent).toContain(FUTURE_ANSWER);
    expect(document.activeElement?.closest("[data-gp-conclusion-region]")).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it("Claim Trace 在 complete 前后仍工作，hover/focus 仲裁不被结论展开破坏", () => {
    const complete = mixedComplete();
    const investigating = { ...complete, phase: "investigating" as const, conclusion: undefined };
    const view = render(
      <InvestigationCanvas snapshot={investigating} live onReverify={() => {}} onBackHome={() => {}} />,
    );
    const original = document.querySelector(".gp-original") as HTMLElement;
    const originalText = document.querySelector(".gp-original-text") as HTMLElement;
    expect(originalText.textContent).toBe(MIXED_CLAIM);
    expect(originalText.querySelector('mark[data-gp-trace-claim="claim-1"]')?.textContent).toBe(MIXED_ATOM_A);
    fireEvent.mouseEnter(document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')?.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')?.getAttribute("data-gp-trace-active")).toBe("false");

    view.rerender(
      <InvestigationCanvas snapshot={complete} live={false} onReverify={() => {}} onBackHome={() => {}} />,
    );
    expect(document.querySelector(".gp-original")).toBe(original);
    expect(document.querySelector(".gp-original-text")!.textContent).toBe(MIXED_CLAIM);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')?.textContent).toBe(MIXED_ATOM_A);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')?.textContent).toBe(MIXED_ATOM_B);

    fireEvent.mouseLeave(document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!);
    fireEvent.mouseEnter(document.querySelector('[data-gp-claim-id="claim-2"] .gp-claim-head')!);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')?.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')?.getAttribute("data-gp-trace-active")).toBe("false");

    fireEvent.focus(document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')?.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')?.getAttribute("data-gp-trace-active")).toBe("false");
  });

  it("3：directAnswer 是结论区第一可见正文，judgment/meta 在其后", () => {
    renderCanvas(refutedComplete());
    const hero = screen.getByLabelText("调查结论");
    const answer = hero.querySelector("[data-gp-direct-answer]") as HTMLElement;
    const judgment = hero.querySelector("[data-gp-judgment]") as HTMLElement;
    expect(answer.textContent).toMatch(/原句站不住/);
    expect(answer.compareDocumentPosition(judgment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(judgment.classList.contains("gp-chip")).toBe(false);
    expect(hero.querySelector(".gp-hero-kicker")).toBeNull();
    expect(hero.textContent).not.toMatch(/调查完成/);
    expect(hero.textContent).not.toMatch(/\b\d{1,3}\s*分\b/);
  });

  it("6：unresolved 用句子写出证据还不够，不只靠徽章", () => {
    renderCanvas(unresolvedComplete());
    const hero = screen.getByLabelText("调查结论");
    expect(hero.getAttribute("data-gp-conclusion-judgment")).toBe("unresolved");
    expect(within(hero).getByText(/证据还不够/)).toBeTruthy();
    expect(hero.querySelector("[data-gp-uncertainty]")?.textContent).toMatch(/证据还不够/);
  });

  it("7：boundary 是认识论说明，不是 warning alert", () => {
    const { investigating, complete } = completeFromInvestigating();
    render(
      <InvestigationCanvas snapshot={{ ...investigating, ...complete }} live={false} onReverify={() => {}} onBackHome={() => {}} />
    );
    const box = document.querySelector("[data-gp-boundaries]") as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.getAttribute("role")).not.toBe("alert");
    expect(box.getAttribute("role")).not.toBe("warning");
    expect(box.textContent).not.toContain("⚠️");
    expect(box.textContent).toMatch(/不能推出/);
  });

  it("11：reduced-motion 下 complete 后 directAnswer 立即可读", () => {
    mockReducedMotion(true);
    const { investigating, complete } = completeFromInvestigating();
    const view = render(
      <InvestigationCanvas snapshot={investigating} live onReverify={() => {}} onBackHome={() => {}} />
    );
    view.rerender(
      <InvestigationCanvas snapshot={complete} live={false} onReverify={() => {}} onBackHome={() => {}} />
    );
    const answer = document.querySelector("[data-gp-direct-answer]") as HTMLElement;
    expect(answer).toBeTruthy();
    expect(answer.textContent).toContain(FUTURE_ANSWER);
    expect(answer.getAttribute("aria-hidden")).toBeNull();
    expect(document.activeElement === answer).toBe(false);
  });

  it("源码：不 scrollIntoView / autoFocus；emerge token 在 260–420ms；结论区无警报角色", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "src", "goldenPath");
    const canvas = readFileSync(join(dir, "InvestigationCanvas.tsx"), "utf8");
    const hero = readFileSync(join(dir, "ConclusionHero.tsx"), "utf8");
    const css = readFileSync(join(dir, "golden-path.css"), "utf8");
    expect(canvas + hero).not.toMatch(/scrollIntoView/);
    expect(canvas + hero).not.toMatch(/autoFocus/);
    expect(hero).not.toMatch(/role=["']alert["']/);
    expect(hero).not.toMatch(/role=["']warning["']/);
    expect(hero).not.toMatch(/⚠️/);
    expect(css).toMatch(/--gp-motion-emerge:\s*320ms/);
    const emerge = css.match(/--gp-motion-emerge:\s*(\d+)ms/);
    expect(emerge).toBeTruthy();
    const ms = Number(emerge![1]);
    expect(ms).toBeGreaterThanOrEqual(260);
    expect(ms).toBeLessThanOrEqual(420);
    const region = css.match(/\.gp-conclusion-region\s*\{([^}]*)\}/);
    expect(region![1]).toMatch(/overflow-anchor:\s*none/);
    const pending = css.match(/\.gp-conclusion-region\.is-pending\s*\{([^}]*)\}/);
    expect(pending![1]).not.toMatch(/display:\s*none/);
    const boundaries = css.match(/\.gp-hero-boundaries\s*\{([^}]*)\}/);
    expect(boundaries![1]).not.toMatch(/#f[e]?f3c7|#f59e0b|#f97316|yellow/i);
    expect(css).toContain(".gp-conclusion-region");
  });
});

describe("Issue #61 [Reset 4A] 生产视觉基础断言", () => {
  it("golden-path.css 包含 Quiet Editorial tokens，废止大面积语义背景", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    expect(css).toContain("--gp-canvas");
    expect(css).toContain("--gp-hairline");
    expect(css).toContain("--gp-semantic-support");
    expect(css).toContain("--gp-semantic-contradict");
    expect(css).toContain("--gp-focus-ring");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).not.toMatch(/--gp-positive-bg|--gp-negative-bg|--gp-mixed-bg/);
    expect(css).not.toMatch(/transition:\s*all\b/);
  });

  it("focus-visible 与 reduced-motion 只作用于 .gp-shell，不污染全应用", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    expect(css).toMatch(/\.gp-shell\s+:focus-visible/);
    expect(css).not.toMatch(/(^|\n):focus-visible\s*\{/);
    const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reduced).toBeTruthy();
    expect(reduced![1]).toContain(".gp-shell *");
    expect(reduced![1]).not.toMatch(/(^|\n)\s*\*\s*,\s*\*::before/);
  });

  it("PromptInput 嵌入走 CSS 自定义属性，不再劫持 [class*=frame]", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const gp = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    const prompt = readFileSync(join(process.cwd(), "src", "components/v3/promptInput/PromptInput.module.css"), "utf8");
    const promptTsx = readFileSync(join(process.cwd(), "src", "components/v3/promptInput/PromptInput.tsx"), "utf8");
    expect(gp).not.toMatch(/\[class\*=["']frame["']\]/);
    expect(gp).toContain("--prompt-frame-background");
    expect(gp).toContain("--prompt-frame-border");
    expect(gp).toContain("--prompt-frame-shadow");
    expect(prompt).toContain("--prompt-frame-background");
    expect(promptTsx).toContain("data-prompt-frame");
    expect(promptTsx).toContain("data-prompt-add");
    expect(promptTsx).toContain("data-prompt-send");
  });

  it("输入卡片内层可编辑区域消除重复 focus-visible 边框", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const gp = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    expect(gp).toMatch(/\.gp-input-card\s+#claim-input:focus-visible/);
    expect(gp).toMatch(/\.gp-input-card\s+\[contenteditable="true"\]:focus-visible/);
    const match = gp.match(/\.gp-input-card\s+#claim-input:focus-visible[^{]*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    expect(match![1]).toContain("box-shadow: none;");
    expect(match![1]).toContain("outline: none;");
  });

  it("Content Layer 的争点 / 尚缺 / 原图出处不是 inset 圆角卡片", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    const block = (name: string) => {
      const match = css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`));
      expect(match, `missing .${name}`).toBeTruthy();
      return match![1];
    };
    for (const name of ["gp-conflict", "gp-gaps", "gp-image-origin"]) {
      const body = block(name);
      expect(body).toMatch(/background:\s*transparent/);
      expect(body).toMatch(/border-radius:\s*0/);
      expect(body).toMatch(/box-shadow:\s*none/);
      expect(body).not.toMatch(/--gp-surface-inset/);
      expect(body).not.toMatch(/border:\s*1px solid/);
    }
    const interrupted = block("gp-interrupted");
    expect(interrupted).toContain("--gp-surface-inset");
  });

  it("移动端 iconBtn 是 44×44 hit box，视觉圆仍由 ::before 缩到 28", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "components/v3/promptInput/PromptInput.module.css"), "utf8");
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.iconBtn\s*\{[\s\S]*width:\s*44px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.iconBtn::before\s*\{[\s\S]*inset:\s*8px/);
    const base = css.match(/\.iconBtn\s*\{([^}]*)\}/);
    expect(base![1]).toMatch(/width:\s*28px/);
  });

  it("InputStage 正确渲染单层功能 Surface、提示语与示例", async () => {
    const { InputStage } = await import("./InputStage");
    const onSubmit = vi.fn();
    render(<InputStage onSubmit={onSubmit} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(document.querySelector(".gp-input-card")).toBeTruthy();
    expect(document.querySelector(".gp-input-card [data-prompt-frame]")).toBeTruthy();
    expect(document.querySelector("[data-prompt-add]")).toBeTruthy();
    expect(document.querySelector("[data-prompt-send]")).toBeTruthy();
    expect(document.querySelector(".gp-examples")).toBeTruthy();

    const examples = document.querySelectorAll(".gp-example");
    expect(examples.length).toBeGreaterThan(0);
    fireEvent.click(examples[0]);
    expect(examples[0].classList.contains("is-active")).toBe(true);

    const input = document.querySelector("#claim-input") as HTMLElement;
    expect(input).toBeTruthy();
  });
});

describe("Issue #62 Claim Trace", () => {
  const mixed = mixedComplete();
  const claimA = mixed.claims[0]!;
  const claimB = mixed.claims[1]!;

  it("1 valid span → originalClaim.slice(start, end) 精确等于短语", () => {
    expect(claimA.originalSpan).toEqual({ start: 0, end: MIXED_ATOM_A.length });
    expect(MIXED_CLAIM.slice(claimA.originalSpan!.start, claimA.originalSpan!.end)).toBe(MIXED_ATOM_A);
    expect(MIXED_CLAIM.slice(claimB.originalSpan!.start, claimB.originalSpan!.end)).toBe(MIXED_ATOM_B);
    const segments = buildClaimTraceSegments(MIXED_CLAIM, mixed.claims);
    expect(segments.filter((s) => s.traceable).map((s) => s.text)).toEqual([MIXED_ATOM_A, MIXED_ATOM_B]);
    expect(segments.map((s) => s.text).join("")).toBe(MIXED_CLAIM);
  });

  it("2 missing span → no trace", () => {
    const segments = buildClaimTraceSegments(MIXED_CLAIM, mixedWithoutSpans().claims);
    expect(segments.every((s) => s.traceable === false && s.claimId === null)).toBe(true);
    expect(segments.map((s) => s.text).join("")).toBe(MIXED_CLAIM);
    renderCanvas(mixedWithoutSpans());
    expect(document.querySelectorAll("mark.gp-trace-mark").length).toBe(0);
    expect(document.querySelector(".gp-original-text")!.textContent).toBe(MIXED_CLAIM);
  });

  it("3 out-of-range → no trace", () => {
    const claims = mixed.claims.map((c, i) =>
      i === 0 ? { ...c, originalSpan: { start: 0, end: MIXED_CLAIM.length + 8 } } : c,
    );
    const segments = buildClaimTraceSegments(MIXED_CLAIM, claims);
    expect(segments.find((s) => s.claimId === "claim-1")).toBeUndefined();
    expect(segments.filter((s) => s.traceable).map((s) => s.claimId)).toEqual(["claim-2"]);
  });

  it("4 invalid start/end → no trace", () => {
    const emptySlice = buildClaimTraceSegments(MIXED_CLAIM, [
      { ...claimA, originalSpan: { start: 4, end: 4 } },
      { ...claimB, originalSpan: { start: 12, end: 3 } },
    ]);
    expect(emptySlice.every((s) => !s.traceable)).toBe(true);
    expect(emptySlice.map((s) => s.text).join("")).toBe(MIXED_CLAIM);
  });

  it("5 mismatch 与无法解释的重叠 → fail-safe，不模糊猜测", () => {
    const mismatch = buildClaimTraceSegments(MIXED_CLAIM, [
      { ...claimA, originalSpan: { start: 0, end: 2 } },
      claimB,
    ]);
    expect(mismatch.find((s) => s.claimId === "claim-1")).toBeUndefined();
    expect(mismatch.find((s) => s.claimId === "claim-2" && s.traceable)?.text).toBe(MIXED_ATOM_B);
    expect(MIXED_CLAIM.slice(0, 2)).not.toBe(claimA.text);

    const overlap = buildClaimTraceSegments("abcdefghij", [
      { id: "claim-1", text: "abcde", originalSpan: { start: 0, end: 5 } },
      { id: "claim-2", text: "cdefg", originalSpan: { start: 2, end: 7 } },
    ]);
    expect(overlap.every((s) => s.traceable === false)).toBe(true);
    expect(overlap.map((s) => s.text).join("")).toBe("abcdefghij");
  });

  it("6 真实中文 fixture 短语精确一致", () => {
    renderCanvas(mixed);
    const original = document.querySelector(".gp-original-text")!;
    expect(original.textContent).toBe(MIXED_CLAIM);
    const markA = original.querySelector('mark[data-gp-trace-claim="claim-1"]')!;
    const markB = original.querySelector('mark[data-gp-trace-claim="claim-2"]')!;
    expect(markA.textContent).toBe(MIXED_ATOM_A);
    expect(markB.textContent).toBe(MIXED_ATOM_B);
    expect(MIXED_CLAIM.slice(claimA.originalSpan!.start, claimA.originalSpan!.end)).toBe(markA.textContent);
    expect(MIXED_CLAIM.slice(claimB.originalSpan!.start, claimB.originalSpan!.end)).toBe(markB.textContent);
    expect(markA.getAttribute("data-gp-trace-active")).toBe("false");
    expect(original.querySelectorAll("mark:empty").length).toBe(0);
  });

  it("7 hover Claim 01 → 只激活 Claim 01 短语", () => {
    renderCanvas(mixed);
    const head = document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    fireEvent.mouseEnter(head);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.classList.contains("is-active")).toBe(true);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("false");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.classList.contains("is-active")).toBe(false);
  });

  it("8 keyboard focus → 同样激活", () => {
    renderCanvas(mixed);
    const head = document.querySelector('[data-gp-claim-id="claim-2"] .gp-claim-head')!;
    fireEvent.focus(head);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("false");
  });

  it("9 blur / mouseleave → 恢复", () => {
    renderCanvas(mixed);
    const head = document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    fireEvent.mouseEnter(head);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    fireEvent.mouseLeave(head);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("false");
    fireEvent.focus(head);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    fireEvent.blur(head);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("false");
  });

  it("click/focus Claim 01 → mouseEnter Claim 02 → 只激活 Claim 02", () => {
    renderCanvas(mixed);
    const head1 = document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    const head2 = document.querySelector('[data-gp-claim-id="claim-2"] .gp-claim-head')!;
    fireEvent.click(head1);
    fireEvent.focus(head1);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    fireEvent.mouseEnter(head2);
    expect(document.querySelector(".gp-original-text")!.getAttribute("data-gp-traced-claim")).toBe("claim-2");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("false");
  });

  it("mouseLeave Claim 02 → Claim 01 仍 focus → 恢复 Claim 01", () => {
    renderCanvas(mixed);
    const head1 = document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    const head2 = document.querySelector('[data-gp-claim-id="claim-2"] .gp-claim-head')!;
    fireEvent.focus(head1);
    fireEvent.mouseEnter(head2);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    fireEvent.mouseLeave(head2);
    expect(document.querySelector(".gp-original-text")!.getAttribute("data-gp-traced-claim")).toBe("claim-1");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("false");
  });

  it("先前 hover Claim 02 → keyboard focus Claim 01 → 激活 Claim 01", () => {
    renderCanvas(mixed);
    const head1 = document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    const head2 = document.querySelector('[data-gp-claim-id="claim-2"] .gp-claim-head')!;
    fireEvent.mouseEnter(head2);
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    fireEvent.focus(head1);
    expect(document.querySelector(".gp-original-text")!.getAttribute("data-gp-traced-claim")).toBe("claim-1");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-1"]')!.getAttribute("data-gp-trace-active")).toBe("true");
    expect(document.querySelector('mark[data-gp-trace-claim="claim-2"]')!.getAttribute("data-gp-trace-active")).toBe("false");
  });

  it("10 expand/collapse 不回归", () => {
    renderCanvas(mixed);
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    const head = claim.querySelector(".gp-claim-head")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(claim.querySelector(".gp-claim-detail")).toBeTruthy();
    expect(within(claim as HTMLElement).getByText("有对有错")).toBeTruthy();
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(claim.querySelector(".gp-claim-detail")).toBeNull();
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(claim.querySelector('[data-gp-role="support"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-gp-claim-id="claim-2"] .gp-claim-head')!);
    const claimBNode = document.querySelector('[data-gp-claim-id="claim-2"]')!;
    expect(claimBNode.querySelector(".gp-claim-head")!.getAttribute("aria-expanded")).toBe("true");
    expect(within(claimBNode as HTMLElement).getByText("证据反驳")).toBeTruthy();
  });

  it("生产源码没有第二套 token / phrase map", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "src", "goldenPath");
    const files = readdirSync(dir).filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."));
    const banned = /quoteTokens|phraseMap|phrase map/i;
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      if (banned.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);
    const helper = readFileSync(join(dir, "claimTrace.ts"), "utf8");
    expect(helper).toContain("originalSpan");
    expect(helper).not.toMatch(/indexOf\(claim\.text\)/);
  });
});

const src = (url: string, title: string, snippet: string) => ({ url, title, snippet });

function settlingBoard(): InvestigationSnapshotV1 {
  const atom = "三条材料分别待核";
  return buildInvestigationSnapshot(
    {
      originalClaim: "三条材料分别待核。",
      phase: "investigating",
      claimAtoms: [atom],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: {
          [atom]: [
            src("https://a.example/support", "来源甲", "甲摘录仍在"),
            src("https://b.example/contradict", "来源乙", "乙摘录仍在"),
            src("https://c.example/context", "来源丙", "丙摘录仍在"),
          ],
        },
      },
    },
    { claimAtomKeyFn: (s) => s.trim() }
  );
}

function withClaimEvidence(
  snapshot: InvestigationSnapshotV1,
  evidence: InvestigationSnapshotV1["claims"][number]["evidence"],
): InvestigationSnapshotV1 {
  return {
    ...snapshot,
    claims: snapshot.claims.map((claim, index) => (index === 0 ? { ...claim, evidence } : claim)),
  };
}

function withRoles(snapshot: InvestigationSnapshotV1, roles: Record<string, EvidenceRole>): InvestigationSnapshotV1 {
  return {
    ...snapshot,
    claims: snapshot.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.map((link) => ({
        ...link,
        role: roles[link.sourceId] ?? link.role,
      })),
    })),
  };
}

function duplicateSameRoleBoard(): InvestigationSnapshotV1 {
  const base = settlingBoard();
  const source = { ...base.sources[0]!, title: "重复来源标题", excerpt: "重复来源摘录" };
  return {
    ...base,
    sources: [source, ...base.sources.slice(1)],
    claims: base.claims.map((claim, index) =>
      index === 0
        ? {
            ...claim,
            evidence: [
              { sourceId: source.id, role: "support", finding: "关系A的发现", limitation: "关系A的边界" },
              { sourceId: source.id, role: "support", finding: "关系B的发现", limitation: "关系B的边界" },
            ],
          }
        : claim,
    ),
  };
}

function heldIdentityBoard(): InvestigationSnapshotV1 {
  const base = settlingBoard();
  const sourceA = { ...base.sources[0]!, title: "甲来源独有标题", excerpt: "甲来源独有摘录" };
  const sourceB = { ...base.sources[1]!, title: "乙来源共用标题", excerpt: "乙来源共用摘录" };
  const claimA = {
    ...base.claims[0]!,
    id: "claim-a",
    text: "甲命题独有文本",
    evidence: [
      { sourceId: sourceA.id, role: "support" as const, finding: "甲独有发现", limitation: "甲独有边界" },
    ],
  };
  const claimB = {
    ...base.claims[0]!,
    id: "claim-b",
    text: "乙命题独有文本",
    evidence: [
      { sourceId: sourceB.id, role: "support" as const, finding: "乙关系A发现", limitation: "乙关系A边界" },
      { sourceId: sourceB.id, role: "support" as const, finding: "乙关系B发现", limitation: "乙关系B边界" },
    ],
  };
  return {
    ...base,
    claims: [claimA, claimB],
    sources: [sourceA, sourceB, ...base.sources.slice(2)],
  };
}

function uniqueBThenAmbiguous() {
  const board = heldIdentityBoard();
  const sourceB = board.sources[1]!;
  const unique = {
    ...board,
    claims: board.claims.map((claim) =>
      claim.id === "claim-b"
        ? {
            ...claim,
            evidence: [
              { sourceId: sourceB.id, role: "support" as const, finding: "乙已确认发现", limitation: "乙已确认边界" },
            ],
          }
        : claim,
    ),
  };
  const ambiguous = {
    ...board,
    claims: board.claims.map((claim) =>
      claim.id === "claim-b"
        ? {
            ...claim,
            evidence: [
              { sourceId: sourceB.id, role: "support" as const, finding: "乙已确认发现", limitation: "乙已确认边界" },
              {
                sourceId: sourceB.id,
                role: "support" as const,
                finding: "不该被猜进来的乙重复发现",
                limitation: "不该被猜进来的乙重复边界",
              },
            ],
          }
        : claim,
    ),
  };
  return { unique, ambiguous, sourceA: board.sources[0]!, sourceB };
}

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: reduce && /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as MediaQueryList;
}

describe("Issue #63 Evidence Settling：同一证据节点身份", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("稳定键用 claimId:sourceId；同源重复不用出现序号当长期身份", () => {
    const unique = identifyEvidenceLinks("c1", [{ sourceId: "s1", role: "support" }]);
    expect(unique).toEqual([{ link: { sourceId: "s1", role: "support" }, key: "c1:s1", identity: "stable" }]);

    const mixed = identifyEvidenceLinks("c1", [
      { sourceId: "s1", role: "unassessed" },
      { sourceId: "s2", role: "unassessed" },
      { sourceId: "s1", role: "context-only" },
    ]);
    expect(mixed.map((row) => row.key)).toEqual(["c1:s1::unassessed", "c1:s2", "c1:s1::context-only"]);
    expect(mixed.map((row) => row.identity)).toEqual(["relation", "stable", "relation"]);
    expect(mixed.every((row) => !row.key.includes("#"))).toBe(true);

    const one = identifyEvidenceLinks("c1", [{ sourceId: "s1", role: "unassessed" }]);
    const two = identifyEvidenceLinks("c1", [
      { sourceId: "s1", role: "support" },
      { sourceId: "s1", role: "contradict" },
    ]);
    expect(one[0]!.key).toBe("c1:s1");
    expect(two.map((row) => row.key)).toEqual(["c1:s1::support", "c1:s1::contradict"]);
    expect(two.every((row) => row.key !== one[0]!.key)).toBe(true);

    const sameRole = identifyEvidenceLinks("c1", [
      { sourceId: "s1", role: "support", finding: "甲" },
      { sourceId: "s1", role: "support", finding: "乙" },
    ]);
    expect(sameRole.map((row) => row.identity)).toEqual(["relation", "relation"]);
    expect(new Set(sameRole.map((row) => row.key)).size).toBe(2);

    const identical = identifyEvidenceLinks("c1", [
      { sourceId: "s1", role: "support" },
      { sourceId: "s1", role: "support" },
    ]);
    expect(identical.map((row) => row.identity)).toEqual(["ephemeral", "ephemeral"]);
    expect(identical[0]!.key).not.toBe(identical[1]!.key);
  });

  it("生产源码不以 sourceId-index 或出现序号 #n 作为 Evidence key", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const claim = readFileSync(join(process.cwd(), "src", "goldenPath", "ClaimSection.tsx"), "utf8");
    const board = readFileSync(join(process.cwd(), "src", "goldenPath", "EvidenceBoard.tsx"), "utf8");
    const ui = readFileSync(join(process.cwd(), "src", "goldenPath", "snapshotUi.ts"), "utf8");
    expect(claim).not.toMatch(/sourceId\}-\$\{i\}/);
    expect(board).toContain("identifyEvidenceLinks");
    expect(board).not.toMatch(/layoutId/);
    expect(ui).not.toMatch(/#\$\{seen\}/);
    expect(ui).not.toMatch(/sourceId}#\$\{/);
  });

  it("unassessed → support：DOM 节点 before === after", () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[0]!.sourceId;
    const view = renderCanvas(beforeSnap);
    const before = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(before).toBeInstanceOf(HTMLElement);
    view.rerender(
      <InvestigationCanvas
        snapshot={withRoles(beforeSnap, { [sourceId]: "support" })}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const after = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("support");
    expect(after?.getAttribute("data-gp-identity")).toBe("stable");
    expect(after?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}`);
  });

  it("unassessed → contradict：DOM 节点 before === after", () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[1]!.sourceId;
    const view = renderCanvas(beforeSnap);
    const before = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    view.rerender(
      <InvestigationCanvas
        snapshot={withRoles(beforeSnap, { [sourceId]: "contradict" })}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const after = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("contradict");
  });

  it("unassessed → context-only：DOM 节点 before === after", () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[2]!.sourceId;
    const view = renderCanvas(beforeSnap);
    const before = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    view.rerender(
      <InvestigationCanvas
        snapshot={withRoles(beforeSnap, { [sourceId]: "context-only" })}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const after = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("context-only");
  });

  it("role 标签与 data 属性更新；context-only 不被映射成 support", () => {
    const beforeSnap = settlingBoard();
    const [a, b, c] = beforeSnap.claims[0]!.evidence.map((l) => l.sourceId);
    const view = renderCanvas(beforeSnap);
    expect(document.querySelector('[data-gp-group-role="unassessed"]')?.textContent).toContain("待核对");
    view.rerender(
      <InvestigationCanvas
        snapshot={withRoles(beforeSnap, { [a!]: "support", [b!]: "contradict", [c!]: "context-only" })}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const support = document.querySelector(`[data-source-id="${a}"]`)!;
    const contradict = document.querySelector(`[data-source-id="${b}"]`)!;
    const context = document.querySelector(`[data-source-id="${c}"]`)!;
    expect(support.getAttribute("data-gp-role")).toBe("support");
    expect(contradict.getAttribute("data-gp-role")).toBe("contradict");
    expect(context.getAttribute("data-gp-role")).toBe("context-only");
    expect(context.getAttribute("data-gp-role")).not.toBe("support");
    expect(document.querySelector('[data-gp-group-role="support"]')?.textContent).toContain("支持");
    expect(document.querySelector('[data-gp-group-role="contradict"]')?.textContent).toContain("反驳");
    expect(document.querySelector('[data-gp-group-role="context-only"]')?.textContent).toContain("相关材料");
    expect(document.querySelector('[data-gp-group-role="unassessed"]')).toBeNull();
  });

  it("group count 正确，empty group 不在 DOM", () => {
    const beforeSnap = settlingBoard();
    const [a, b, c] = beforeSnap.claims[0]!.evidence.map((l) => l.sourceId);
    renderCanvas(withRoles(beforeSnap, { [a!]: "support", [b!]: "support", [c!]: "context-only" }));
    expect(document.querySelector('[data-gp-group-role="support"]')?.textContent).toMatch(/·\s*2/);
    expect(document.querySelector('[data-gp-group-role="context-only"]')?.textContent).toMatch(/·\s*1/);
    expect(document.querySelector('[data-gp-group-role="contradict"]')).toBeNull();
    expect(document.querySelector('[data-gp-group-role="unassessed"]')).toBeNull();
    expect(document.querySelectorAll('[data-gp-role="support"]').length).toBe(2);
    expect(document.querySelectorAll('[data-gp-role="unassessed"]').length).toBe(0);
  });

  it("Evidence 点击仍打开 Source Drawer", () => {
    const board = settlingBoard();
    const sourceId = board.sources[0]!.id;
    renderCanvas(board);
    fireEvent.click(document.querySelector(`[data-source-id="${sourceId}"]`)!);
    const drawer = document.querySelector(".gp-drawer--source")!;
    expect(drawer).toBeTruthy();
    expect(within(drawer as HTMLElement).getByText("来源甲")).toBeTruthy();
  });

  it("focused Evidence rerender 后节点仍在且保持焦点", () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[0]!.sourceId;
    const view = renderCanvas(beforeSnap);
    const before = document.querySelector(`[data-source-id="${sourceId}"]`) as HTMLButtonElement;
    before.focus();
    expect(document.activeElement).toBe(before);
    view.rerender(
      <InvestigationCanvas
        snapshot={withRoles(beforeSnap, { [sourceId]: "contradict" })}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const after = document.querySelector(`[data-source-id="${sourceId}"]`) as HTMLButtonElement;
    expect(after).toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.getAttribute("data-gp-role")).toBe("contradict");
    expect(after.textContent).toContain("来源甲");
    expect(after.textContent).toContain("甲摘录仍在");
  });

  it("reduced-motion 下立即归位、关闭 layout 运动", () => {
    mockReducedMotion(true);
    const beforeSnap = settlingBoard();
    const [a, b, c] = beforeSnap.claims[0]!.evidence.map((l) => l.sourceId);
    const view = renderCanvas(beforeSnap);
    const before = document.querySelector(`[data-source-id="${a}"]`);
    view.rerender(
      <InvestigationCanvas
        snapshot={withRoles(beforeSnap, { [a!]: "support", [b!]: "contradict", [c!]: "context-only" })}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const after = document.querySelector(`[data-source-id="${a}"]`);
    expect(after).toBe(before);
    expect(document.querySelector(".gp-evidence-board")?.getAttribute("data-gp-layout-motion")).toBe("off");
    expect(after?.getAttribute("data-gp-role")).toBe("support");
    expect((after as HTMLElement).style.transform).toBe("");
    expect(document.querySelector('[data-gp-group-role="support"]')).toBeTruthy();
    expect(document.querySelector('[data-gp-group-role="unassessed"]')).toBeNull();
  });

  it("1× s1 → 2× s1：不能把旧节点续到任一新节点上", () => {
    const base = settlingBoard();
    const s1 = base.sources[0]!.id;
    const one = withClaimEvidence(base, [{ sourceId: s1, role: "unassessed" }]);
    const two = withClaimEvidence(base, [
      { sourceId: s1, role: "support" },
      { sourceId: s1, role: "contradict" },
    ]);
    const view = renderCanvas(one);
    const before = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${s1}"]`);
    expect(before).toBeInstanceOf(HTMLElement);
    expect(before?.getAttribute("data-gp-identity")).toBe("stable");
    expect(before?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${s1}`);
    view.rerender(
      <InvestigationCanvas snapshot={two} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const afterNodes = [
      ...document.querySelectorAll(`[data-gp-claim-id="claim-1"] [data-source-id="${s1}"]`),
    ];
    expect(afterNodes).toHaveLength(2);
    expect(afterNodes[0]).not.toBe(before);
    expect(afterNodes[1]).not.toBe(before);
    expect(document.contains(before)).toBe(false);
    expect(afterNodes.map((node) => node.getAttribute("data-gp-identity"))).toEqual(["relation", "relation"]);
    expect(afterNodes.every((node) => node.getAttribute("data-gp-evidence-key") !== `claim-1:${s1}`)).toBe(true);
    expect(afterNodes.every((node) => !node.getAttribute("data-gp-evidence-key")?.includes("#"))).toBe(true);
    expect(afterNodes.every((node) => node.getAttribute("data-gp-settling") == null)).toBe(true);
  });

  it("2× s1 → 1× s1：剩下那一行不得错误复用原先任一条", () => {
    const base = settlingBoard();
    const s1 = base.sources[0]!.id;
    const two = withClaimEvidence(base, [
      { sourceId: s1, role: "support" },
      { sourceId: s1, role: "contradict" },
    ]);
    const one = withClaimEvidence(base, [{ sourceId: s1, role: "support" }]);
    const view = renderCanvas(two);
    const beforeNodes = [
      ...document.querySelectorAll(`[data-gp-claim-id="claim-1"] [data-source-id="${s1}"]`),
    ];
    expect(beforeNodes).toHaveLength(2);
    const beforeSupport = document.querySelector(
      `[data-gp-claim-id="claim-1"] [data-source-id="${s1}"][data-gp-role="support"]`
    );
    const beforeContradict = document.querySelector(
      `[data-gp-claim-id="claim-1"] [data-source-id="${s1}"][data-gp-role="contradict"]`
    );
    expect(beforeSupport).toBeInstanceOf(HTMLElement);
    expect(beforeContradict).toBeInstanceOf(HTMLElement);
    view.rerender(
      <InvestigationCanvas snapshot={one} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const after = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${s1}"]`);
    expect(after).toBeInstanceOf(HTMLElement);
    expect(after).not.toBe(beforeSupport);
    expect(after).not.toBe(beforeContradict);
    expect(document.contains(beforeSupport)).toBe(false);
    expect(document.contains(beforeContradict)).toBe(false);
    expect(after?.getAttribute("data-gp-identity")).toBe("stable");
    expect(after?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${s1}`);
    expect(after?.getAttribute("data-gp-role")).toBe("support");
  });

  it("duplicate reorder：可区分的两条 s1 不得因数组顺序互换身份", () => {
    const base = settlingBoard();
    const s1 = base.sources[0]!.id;
    const ordered = withClaimEvidence(base, [
      { sourceId: s1, role: "support", finding: "支持摘录" },
      { sourceId: s1, role: "contradict", finding: "反驳摘录" },
    ]);
    const reversed = withClaimEvidence(base, [
      { sourceId: s1, role: "contradict", finding: "反驳摘录" },
      { sourceId: s1, role: "support", finding: "支持摘录" },
    ]);
    const view = renderCanvas(ordered);
    const beforeSupport = document.querySelector(
      `[data-gp-claim-id="claim-1"] [data-source-id="${s1}"][data-gp-role="support"]`
    );
    const beforeContradict = document.querySelector(
      `[data-gp-claim-id="claim-1"] [data-source-id="${s1}"][data-gp-role="contradict"]`
    );
    expect(beforeSupport).toBeInstanceOf(HTMLElement);
    expect(beforeContradict).toBeInstanceOf(HTMLElement);
    expect(beforeSupport).not.toBe(beforeContradict);
    view.rerender(
      <InvestigationCanvas
        snapshot={reversed}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    const afterSupport = document.querySelector(
      `[data-gp-claim-id="claim-1"] [data-source-id="${s1}"][data-gp-role="support"]`
    );
    const afterContradict = document.querySelector(
      `[data-gp-claim-id="claim-1"] [data-source-id="${s1}"][data-gp-role="contradict"]`
    );
    expect(afterSupport).toBe(beforeSupport);
    expect(afterContradict).toBe(beforeContradict);
    expect(afterSupport?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${s1}::support`);
    expect(afterContradict?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${s1}::contradict`);
  });

  it("interrupted snapshot 保留已存在 Evidence，不做伪最终归类", () => {
    const live = settlingBoard();
    const sourceId = live.claims[0]!.evidence[0]!.sourceId;
    const view = renderCanvas(live);
    const before = document.querySelector(`[data-source-id="${sourceId}"]`);
    const interrupted: InvestigationSnapshotV1 = {
      ...live,
      phase: "interrupted",
      claims: live.claims.map((claim) => ({
        ...claim,
        progress: "interrupted",
        judgment: null,
        evidence: claim.evidence.map((link) => ({ ...link, role: "unassessed" as const })),
      })),
    };
    view.rerender(
      <InvestigationCanvas snapshot={interrupted} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const after = document.querySelector(`[data-source-id="${sourceId}"]`);
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("unassessed");
    expect(document.querySelector('[data-gp-group-role="support"]')).toBeNull();
    expect(document.querySelector('[data-gp-group-role="contradict"]')).toBeNull();
    expect(document.querySelector("[data-gp-interrupted]")).toBeTruthy();
    expect(screen.queryByLabelText("调查结论")).toBeNull();
  });
});

function stubMatchMedia(opts: { mobile?: boolean; reduced?: boolean }) {
  const native = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => {
    const matches = query.includes("max-width: 768px")
      ? Boolean(opts.mobile)
      : query.includes("prefers-reduced-motion")
        ? Boolean(opts.reduced)
        : native(query).matches;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;
}

async function openFirstEvidence(role?: string) {
  const selector = role ? `.gp-evidence-item[data-gp-role="${role}"]` : ".gp-evidence-item";
  const row = document.querySelector(selector) as HTMLButtonElement;
  expect(row).toBeTruthy();
  row.focus();
  fireEvent.click(row);
  const sourceId = row.getAttribute("data-gp-source-id");
  const claimId = row.getAttribute("data-gp-evidence-claim");
  await waitFor(() => {
    const drawer = document.querySelector(".gp-drawer--source");
    expect(drawer?.getAttribute("data-gp-source-id")).toBe(sourceId);
    expect(drawer?.getAttribute("data-gp-claim-id")).toBe(claimId);
  });
  await waitFor(() => {
    expect(document.querySelector(".gp-drawer--source")?.contains(document.activeElement)).toBe(true);
  });
  return row;
}

describe("Issue #65 Source Drawer / Bottom Sheet 可审计下钻", () => {
  const nativeMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = nativeMatchMedia;
  });

  it("1. 点击 Evidence 打开对应该 Claim / Link / Source 的 Drawer", async () => {
    renderCanvas(refutedComplete());
    const row = await openFirstEvidence("contradict");
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.getAttribute("data-gp-claim-id")).toBe(row.getAttribute("data-gp-evidence-claim"));
    expect(drawer.getAttribute("data-gp-source-id")).toBe(row.getAttribute("data-gp-source-id"));
    expect(within(drawer).getByText("世卫组织辟谣平台：无此结论")).toBeTruthy();
    expect(within(drawer).getByText("喝隔夜水会致癌")).toBeTruthy();
    expect(within(drawer).getByText(/对这条命题：反驳/)).toBeTruthy();
    expect(drawer.querySelector('a[href="https://piyao.org.cn/overnight-water"]')).toBeTruthy();
  });

  it("2. support / contradict / context-only 关系绑在当前命题，不是来源全局 verdict", async () => {
    const mixed = mixedComplete();
    const extra = {
      id: "src-context",
      url: "https://context.example/note",
      title: "背景材料",
      excerpt: "只提供背景，不单独支撑或反驳。",
    };
    mixed.sources = [...mixed.sources, extra];
    mixed.claims[0]!.evidence.push({ sourceId: extra.id, role: "context-only" });
    renderCanvas(mixed);

    await openFirstEvidence("support");
    expect(document.querySelector(".gp-drawer--source")!.getAttribute("data-gp-role")).toBe("support");
    expect(within(document.querySelector(".gp-drawer--source") as HTMLElement).getByText(/对这条命题：支持/)).toBeTruthy();
    fireEvent.click(document.querySelector("[data-gp-source-close]")!);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());

    const claimB = document.querySelector('[data-gp-claim-id="claim-2"]') as HTMLElement;
    fireEvent.click(within(claimB).getByRole("button"));
    await openFirstEvidence("contradict");
    expect(within(document.querySelector(".gp-drawer--source") as HTMLElement).getByText(/对这条命题：反驳/)).toBeTruthy();
    fireEvent.click(document.querySelector("[data-gp-source-close]")!);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());

    await openFirstEvidence("context-only");
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.getAttribute("data-gp-role")).toBe("context-only");
    expect(within(drawer).getByText(/对这条命题：相关材料/)).toBeTruthy();
    expect(drawer.textContent).not.toMatch(/来源总体|全局/);
  });

  it("3. finding 有值才显示「为什么这条证据重要」", async () => {
    const withFinding = supportedComplete();
    expect(withFinding.claims[0]!.evidence[0]!.finding).toBeTruthy();
    renderCanvas(withFinding);
    await openFirstEvidence("support");
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.querySelector('[data-gp-source-section="finding"]')).toBeTruthy();
    expect(within(drawer).getByText("为什么这条证据重要")).toBeTruthy();
    expect(within(drawer).getByText(/氧气占 20.9%/)).toBeTruthy();
  });

  it("4. limitation 有值才显示；无值时整节不渲染", async () => {
    const none = supportedComplete();
    renderCanvas(none);
    await openFirstEvidence("support");
    expect(document.querySelector('[data-gp-source-section="limitation"]')).toBeNull();
    expect(document.querySelector(".gp-drawer--source")!.textContent).not.toContain("它不能证明什么");
    cleanup();

    const withLimit = supportedComplete();
    withLimit.claims[0]!.evidence[0]!.limitation = "不能推出室内空气比例。";
    renderCanvas(withLimit);
    await openFirstEvidence("support");
    const section = document.querySelector('[data-gp-source-section="limitation"]') as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).getByText("它不能证明什么")).toBeTruthy();
    expect(within(section).getByText("不能推出室内空气比例。")).toBeTruthy();
  });

  it("5. 没有 excerpt 时不出现空摘录容器", async () => {
    const base = supportedComplete();
    const snap = {
      ...base,
      sources: base.sources.map(({ excerpt: _excerpt, ...source }) => source),
    };
    renderCanvas(snap);
    await openFirstEvidence();
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.querySelector('[data-gp-source-section="excerpt"]')).toBeNull();
    expect(drawer.querySelector(".gp-source-excerpt")).toBeNull();
    expect(drawer.textContent).not.toContain("原文摘录");
  });

  it("6. reachable=false 说明原链接打不开，不伪造来源结论", async () => {
    const snapshot = investigatingUnassessed();
    const withDead = {
      ...snapshot,
      sources: snapshot.sources.map((s) => ({ ...s, reachable: false as const })),
    };
    renderCanvas(withDead);
    await openFirstEvidence();
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(within(drawer).getByText(/原始链接目前打不开/)).toBeTruthy();
    expect(drawer.textContent).not.toContain("已经核实");
    expect(drawer.querySelector(".gp-source-unreachable")?.getAttribute("role")).toBe("status");
  });

  it("7. 打开后焦点进入 dialog", async () => {
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("8. Tab 在 dialog 内闭环", async () => {
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    const closeBtn = dialog.querySelector("[data-gp-source-close]") as HTMLElement;
    const link = dialog.querySelector("a") as HTMLElement;
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);
    expect(document.querySelector(".gp-canvas-inner")?.hasAttribute("inert")).toBe(true);
  });

  it("9. Shift+Tab 在 dialog 内闭环", async () => {
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    const closeBtn = dialog.querySelector("[data-gp-source-close]") as HTMLElement;
    const link = dialog.querySelector("a") as HTMLElement;
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("10. Escape 关闭 Drawer", async () => {
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());
  });

  it("11. 点击 scrim 关闭 Drawer", async () => {
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    fireEvent.click(document.querySelector('[data-gp-scrim="source"]')!);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());
  });

  it("12. 关闭后焦点回到原触发 Evidence 行", async () => {
    renderCanvas(refutedComplete());
    const row = await openFirstEvidence();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("13. snapshot 更新时 Drawer 不自动关闭、不抢焦点", async () => {
    const first = refutedComplete();
    const view = render(
      <InvestigationCanvas
        snapshot={first}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />,
    );
    await openFirstEvidence();
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    const closeBtn = dialog.querySelector("[data-gp-source-close]") as HTMLElement;
    expect(document.activeElement).toBe(closeBtn);

    const next = {
      ...first,
      sources: first.sources.map((source) => ({ ...source, title: `${source.title}（更新）` })),
    };
    view.rerender(
      <InvestigationCanvas
        snapshot={next}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />,
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBeTruthy();
    expect(within(still).getByText(/更新/)).toBeTruthy();
    expect(still.contains(document.activeElement)).toBe(true);
  });

  it("14. 窄屏 matchMedia 下是 Bottom Sheet 结构，且 CSS 有贴底约束", async () => {
    stubMatchMedia({ mobile: true });
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.getAttribute("data-gp-placement")).toBe("sheet");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.gp-drawer--source[\s\S]*max-height:\s*85vh/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.gp-drawer--source[\s\S]*translateY\(100%\)/);
  });

  it("15. reduced-motion 下仍可打开、关闭，焦点行为不变", async () => {
    stubMatchMedia({ reduced: true });
    renderCanvas(refutedComplete());
    const row = await openFirstEvidence();
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.getAttribute("data-gp-reduced-motion")).toBe("true");
    expect(drawer.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("外链带安全 rel，且无全大写模板标签 / 编造字段", async () => {
    renderCanvas(refutedComplete());
    await openFirstEvidence();
    const link = document.querySelector(".gp-drawer--source a") as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toMatch(/noopener/);
    expect(link.rel).toMatch(/noreferrer/);
    const text = document.querySelector(".gp-drawer--source")!.textContent ?? "";
    expect(text).not.toMatch(/EXACT EXCERPT|RELEVANCE|BOUNDARY/);
    expect(text).not.toContain("relevanceReason");
  });

  it("12b. 关闭后焦点回到原来那颗 Evidence DOM 节点（before === after）", async () => {
    renderCanvas(refutedComplete());
    const before = document.querySelector(".gp-evidence-item") as HTMLButtonElement;
    expect(before).toBeInstanceOf(HTMLButtonElement);
    before.focus();
    fireEvent.click(before);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());
    const after = document.querySelector(".gp-evidence-item") as HTMLButtonElement;
    expect(after).toBe(before);
    await waitFor(() => expect(document.activeElement).toBe(before));
  });

  it("Drawer 开着时 unique source settling：dialog 不 remount，正文来自最新 snapshot，底层节点仍是同一颗", async () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[0]!.sourceId;
    const view = renderCanvas(beforeSnap);
    const row = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`) as HTMLButtonElement;
    expect(row.getAttribute("data-gp-identity")).toBe("stable");
    row.focus();
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-role")).toBe("unassessed");
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("live");
    const focused = document.activeElement;

    const next = withRoles(beforeSnap, { [sourceId]: "support" });
    next.claims[0]!.evidence = next.claims[0]!.evidence.map((link) =>
      link.sourceId === sourceId ? { ...link, finding: "归位后的支持说明" } : link
    );
    view.rerender(
      <InvestigationCanvas snapshot={next} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-role")).toBe("support");
    expect(still.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(within(still).getByText(/对这条命题：支持/)).toBeTruthy();
    expect(within(still).getByText("归位后的支持说明")).toBeTruthy();
    expect(still.contains(document.activeElement) || document.activeElement === focused).toBe(true);
    const afterRow = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(afterRow).toBe(row);
    expect(afterRow?.getAttribute("data-gp-role")).toBe("support");
  });

  it("duplicate source 无法唯一 resolve 时不猜 relation、不编 finding", async () => {
    const beforeSnap = settlingBoard();
    const s1 = beforeSnap.sources[0]!.id;
    const one = withClaimEvidence(beforeSnap, [{ sourceId: s1, role: "unassessed" }]);
    const two = withClaimEvidence(beforeSnap, [
      { sourceId: s1, role: "support", finding: "不该被猜进来的支持说明" },
      { sourceId: s1, role: "contradict", finding: "也不该被猜进来的反驳说明" },
    ]);
    const view = renderCanvas(one);
    const row = document.querySelector(`[data-source-id="${s1}"]`) as HTMLButtonElement;
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-role")).toBe("unassessed");
    view.rerender(
      <InvestigationCanvas snapshot={two} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("held");
    expect(still.getAttribute("data-gp-role")).toBe("unassessed");
    expect(still.textContent).not.toContain("不该被猜进来的支持说明");
    expect(still.textContent).not.toContain("也不该被猜进来的反驳说明");
    expect(within(still).getByText(/对这条命题：待核对/)).toBeTruthy();
  });

  it("A. 首次直接点击 duplicate relation 打开被点中的那条，不展示另一条", async () => {
    const snap = duplicateSameRoleBoard();
    const sourceId = snap.claims[0]!.evidence[0]!.sourceId;
    renderCanvas(snap);
    const rows = document.querySelectorAll(`[data-source-id="${sourceId}"]`);
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(drawer.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(within(drawer).getByText("关系B的发现")).toBeTruthy();
    expect(within(drawer).getByText("关系B的边界")).toBeTruthy();
    expect(drawer.textContent).not.toContain("关系A的发现");
    expect(drawer.textContent).not.toContain("关系A的边界");
  });

  it("B. 打开 A 关闭后再点 ambiguous duplicate B，不得串入 A 的内容", async () => {
    const snap = heldIdentityBoard();
    const sourceA = snap.sources[0]!;
    const sourceB = snap.sources[1]!;
    renderCanvas(snap);
    const rowA = document.querySelector(`[data-gp-claim-id="claim-a"] [data-source-id="${sourceA.id}"]`) as HTMLButtonElement;
    fireEvent.click(rowA);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    expect(document.querySelector(".gp-drawer--source")?.textContent).toContain("甲来源独有标题");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());

    const rowsB = document.querySelectorAll(`[data-gp-claim-id="claim-b"] [data-source-id="${sourceB.id}"]`);
    expect(rowsB).toHaveLength(2);
    fireEvent.click(rowsB[1]!);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const drawer = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(within(drawer).getByText("乙关系B发现")).toBeTruthy();
    expect(within(drawer).getByText("乙关系B边界")).toBeTruthy();
    expect(within(drawer).getByText("乙命题独有文本")).toBeTruthy();
    expect(within(drawer).getByText("乙来源共用标题")).toBeTruthy();
    expect(drawer.textContent).not.toContain("甲来源独有标题");
    expect(drawer.textContent).not.toContain("甲命题独有文本");
    expect(drawer.textContent).not.toContain("甲独有发现");
    expect(drawer.textContent).not.toContain("甲独有边界");
    expect(drawer.textContent).not.toContain("甲来源独有摘录");
  });

  it("C. B 自己从可解析进入 held 时保留 B 最后确认 view，不回退 A，dialog 不 remount", async () => {
    const { unique, ambiguous, sourceA, sourceB } = uniqueBThenAmbiguous();
    const view = renderCanvas(unique);
    const rowA = document.querySelector(`[data-gp-claim-id="claim-a"] [data-source-id="${sourceA.id}"]`) as HTMLButtonElement;
    fireEvent.click(rowA);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());

    const rowB = document.querySelector(`[data-gp-claim-id="claim-b"] [data-source-id="${sourceB.id}"]`) as HTMLButtonElement;
    fireEvent.click(rowB);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(within(dialog).getByText("乙已确认发现")).toBeTruthy();
    expect(within(dialog).getByText("乙已确认边界")).toBeTruthy();

    view.rerender(
      <InvestigationCanvas snapshot={ambiguous} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />,
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("held");
    expect(within(still).getByText("乙已确认发现")).toBeTruthy();
    expect(within(still).getByText("乙已确认边界")).toBeTruthy();
    expect(still.textContent).not.toContain("不该被猜进来的乙重复发现");
    expect(still.textContent).not.toContain("不该被猜进来的乙重复边界");
    expect(still.textContent).not.toContain("甲来源独有标题");
    expect(still.textContent).not.toContain("甲命题独有文本");
    expect(still.textContent).not.toContain("甲独有发现");
    expect(still.textContent).not.toContain("甲独有边界");
    expect(still.textContent).not.toContain("甲来源独有摘录");
  });

  it("E1. unique support → support+contradict：identity 消失则 held，不读入新 relation", async () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[0]!.sourceId;
    const unique = withClaimEvidence(beforeSnap, [
      { sourceId, role: "support", finding: "旧支持说明", limitation: "旧支持边界" },
    ]);
    const duplicated = withClaimEvidence(beforeSnap, [
      { sourceId, role: "support", finding: "新支持说明不该出现" },
      { sourceId, role: "contradict", finding: "反驳说明不该出现" },
    ]);
    const view = renderCanvas(unique);
    const row = document.querySelector(`[data-source-id="${sourceId}"]`) as HTMLButtonElement;
    expect(row.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}`);
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(within(dialog).getByText("旧支持说明")).toBeTruthy();

    view.rerender(
      <InvestigationCanvas snapshot={duplicated} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />,
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("held");
    expect(within(still).getByText("旧支持说明")).toBeTruthy();
    expect(within(still).getByText("旧支持边界")).toBeTruthy();
    expect(still.textContent).not.toContain("新支持说明不该出现");
    expect(still.textContent).not.toContain("反驳说明不该出现");
  });

  it("E2. unique unassessed → support：identity 仍是 claimId:sourceId，live 取最新 finding", async () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[0]!.sourceId;
    const view = renderCanvas(beforeSnap);
    const row = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`) as HTMLButtonElement;
    expect(row.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}`);
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("live");

    const next = withRoles(beforeSnap, { [sourceId]: "support" });
    next.claims[0]!.evidence = next.claims[0]!.evidence.map((link) =>
      link.sourceId === sourceId ? { ...link, finding: "归位后仍是同一对象" } : link,
    );
    view.rerender(
      <InvestigationCanvas snapshot={next} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />,
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(still.getAttribute("data-gp-role")).toBe("support");
    expect(within(still).getByText("归位后仍是同一对象")).toBeTruthy();
    const afterRow = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`) as HTMLButtonElement;
    expect(afterRow).toBe(row);
    expect(afterRow.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}`);
  });

  it("E3. duplicate relation 只改数组顺序：同一 identity 继续 live，dialog 不 remount", async () => {
    const beforeSnap = settlingBoard();
    const sourceId = beforeSnap.claims[0]!.evidence[0]!.sourceId;
    const supportFirst = withClaimEvidence(beforeSnap, [
      { sourceId, role: "support", finding: "支持关系仍在" },
      { sourceId, role: "contradict", finding: "反驳关系仍在" },
    ]);
    const contradictFirst = withClaimEvidence(beforeSnap, [
      { sourceId, role: "contradict", finding: "反驳关系仍在" },
      { sourceId, role: "support", finding: "支持关系仍在" },
    ]);
    const view = renderCanvas(supportFirst);
    const supportRow = document.querySelector(`[data-source-id="${sourceId}"][data-gp-role="support"]`) as HTMLButtonElement;
    expect(supportRow.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}::support`);
    fireEvent.click(supportRow);
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeTruthy());
    const dialog = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(dialog.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(within(dialog).getByText("支持关系仍在")).toBeTruthy();
    expect(dialog.textContent).not.toContain("反驳关系仍在");

    view.rerender(
      <InvestigationCanvas
        snapshot={contradictFirst}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />,
    );
    const still = document.querySelector(".gp-drawer--source") as HTMLElement;
    expect(still).toBe(dialog);
    expect(still.getAttribute("data-gp-source-resolve")).toBe("live");
    expect(within(still).getByText("支持关系仍在")).toBeTruthy();
    expect(still.textContent).not.toContain("反驳关系仍在");
  });
});

describe("Issue #76 source identity × #63 Evidence Settling", () => {
  it("同 Claim + 同 URL：investigating unassessed → judging support，sourceId 不变且 DOM before === after", () => {
    const atom = "维生素C能治感冒";
    const urlX = "https://ltxc.cqnu.edu.cn/info/1140/7130.htm";
    const urlY = "https://other.example/earlier";
    const urlZ = "https://other.example/later";
    const pack = [
      src(urlY, "先出现的检索", "y"),
      src(urlZ, "后出现的检索", "z"),
      src(urlX, "重庆师大维生素C", "该页把维生素C写成支持材料"),
    ];
    const investigating = buildInvestigationSnapshot(
      {
        originalClaim: `${atom}。`,
        phase: "investigating",
        claimAtoms: [atom],
        atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: pack } },
      },
      { claimAtomKeyFn: (s) => s.trim() }
    );
    const judging = buildInvestigationSnapshot(
      {
        originalClaim: `${atom}。`,
        phase: "judging",
        claimAtoms: [atom],
        atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: pack } },
        subclaimVerdicts: [
          {
            claimAtom: atom,
            verdict: "true",
            evidence: "该页把维生素C写成支持材料[1]。",
            supportingSources: [src(urlX, "重庆师大维生素C", "该页把维生素C写成支持材料")],
            contradictingSources: [],
            evidenceGaps: [],
          },
        ],
      },
      { claimAtomKeyFn: (s) => s.trim() }
    );
    const sourceId = investigating.sources.find((s) => s.url === urlX)!.id;
    expect(sourceId).toBe(judging.sources.find((s) => s.url === urlX)!.id);
    expect(investigating.sources.find((s) => s.url === urlY)!.id).toBe(
      judging.sources.find((s) => s.url === urlY)!.id
    );

    const view = renderCanvas(investigating);
    const before = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(before).toBeInstanceOf(HTMLElement);
    expect(before?.getAttribute("data-gp-role")).toBe("unassessed");
    expect(before?.getAttribute("data-gp-identity")).toBe("stable");
    expect(before?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}`);

    view.rerender(
      <InvestigationCanvas snapshot={judging} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const after = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("support");
    expect(after?.getAttribute("data-gp-identity")).toBe("stable");
    expect(after?.getAttribute("data-gp-evidence-key")).toBe(`claim-1:${sourceId}`);
  });
});

describe("Issue #66 real SSE artifacts (not golden fixtures)", () => {
  function loadReal(name: string): InvestigationSnapshotV1 {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const path = resolve(
      process.cwd(),
      "..",
      "docs/design/2026-09-06-mode3-production/final/real/snapshots",
      name,
    );
    return JSON.parse(readFileSync(path, "utf8")) as InvestigationSnapshotV1;
  }

  it("REAL investigating → judging：src-1 unassessed→support 且 DOM before === after", () => {
    const investigating = loadReal("05-investigating-5.json");
    const judging = loadReal("06-judging.json");
    const view = renderCanvas(investigating);
    const before = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]');
    const region = document.querySelector("[data-gp-conclusion-region]");
    const original = document.querySelector(".gp-original");
    const board = document.querySelector('[data-gp-claim-id="claim-1"] .gp-evidence-board');
    expect(before).toBeInstanceOf(HTMLElement);
    expect(before?.getAttribute("data-gp-role")).toBe("unassessed");
    expect(before?.getAttribute("data-gp-identity")).toBe("stable");
    expect(region?.getAttribute("data-gp-conclusion-state")).toBe("pending");
    expect(region?.querySelector("[data-gp-direct-answer]")).toBeNull();

    view.rerender(
      <InvestigationCanvas snapshot={judging} live onReverify={() => {}} onBackHome={() => {}} />,
    );
    const after = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]');
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("support");
    expect(after?.getAttribute("data-gp-identity")).toBe("stable");
    expect(document.querySelector("[data-gp-conclusion-region]")).toBe(region);
    expect(document.querySelector(".gp-original")).toBe(original);
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-evidence-board')).toBe(board);
    expect(document.querySelector("[data-gp-direct-answer]")).toBeNull();
  });

  it("REAL originalSpan 精确切片，禁止 fuzzy", () => {
    const complete = loadReal("complete.json");
    for (const claim of complete.claims) {
      const span = claim.originalSpan;
      expect(span).toBeTruthy();
      const sliced = complete.originalClaim.slice(span!.start, span!.end);
      expect(sliced).toBe(claim.text);
    }
    const segs = buildClaimTraceSegments(complete.originalClaim, complete.claims);
    const traced = segs.filter((s) => s.traceable).map((s) => s.text);
    expect(traced).toEqual(["维生素C能治感冒", "每次感冒都应当输液"]);
  });
});

describe("Issue #66 post-#74 real SSE artifacts", () => {
  function loadAfter74(name: string): InvestigationSnapshotV1 {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const path = resolve(
      process.cwd(),
      "..",
      "docs/design/2026-09-06-mode3-production/final/real-after-74/snapshots",
      name,
    );
    return JSON.parse(readFileSync(path, "utf8")) as InvestigationSnapshotV1;
  }

  it("claim-2 反向证据不得再是 support，judgment=refuted", () => {
    const complete = loadAfter74("complete.json");
    const claim2 = complete.claims.find((c) => c.text.includes("每次感冒都应当输液"));
    expect(claim2).toBeTruthy();
    expect(claim2!.judgment).toBe("refuted");
    const cited = claim2!.evidence.filter((l) => l.role === "support" || l.role === "contradict");
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((l) => l.role === "contradict")).toBe(true);
    expect(cited.some((l) => l.role === "support")).toBe(false);
    const reverse = /不需要输液|无需输液|没必要输液|不必输液|输液没有必要|输液治疗没有必要/;
    const reverseCited = cited.filter((l) => reverse.test(l.finding || ""));
    expect(reverseCited.length).toBeGreaterThan(0);
    expect(reverseCited.every((l) => l.role === "contradict")).toBe(true);
    for (const claim of complete.claims) {
      const span = claim.originalSpan;
      expect(span).toBeTruthy();
      expect(complete.originalClaim.slice(span!.start, span!.end)).toBe(claim.text);
    }
  });

  it("claim-1 同时有 support 与 contradict 两条 relation，[n] 仍在 finding 里", () => {
    const complete = loadAfter74("complete.json");
    const claim1 = complete.claims.find((c) => c.text.includes("维生素C能治感冒"));
    expect(claim1).toBeTruthy();
    const roles = claim1!.evidence.map((l) => l.role);
    expect(roles).toContain("support");
    expect(roles).toContain("contradict");
    const cited = claim1!.evidence.filter((l) => l.role === "support" || l.role === "contradict");
    expect(cited.every((l) => /\[\d+\]/.test(l.finding || ""))).toBe(true);
    const sourceIds = new Set(cited.map((l) => l.sourceId));
    expect(sourceIds.size).toBe(cited.length);
  });
});

describe("Issue #66 post-#76 real SSE artifacts", () => {
  function loadAfter76(name: string): InvestigationSnapshotV1 {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const path = resolve(
      process.cwd(),
      "..",
      "docs/design/2026-09-06-mode3-production/final/real-after-76/snapshots",
      name,
    );
    return JSON.parse(readFileSync(path, "utf8")) as InvestigationSnapshotV1;
  }

  it("same Claim + same URL + same hashed sourceId：unassessed→support 且 DOM before === after", () => {
    const investigating = loadAfter76("04-investigating-4.json");
    const judging = loadAfter76("05-judging.json");
    const url = "https://ltxc.cqnu.edu.cn/info/1140/7130.htm";
    const sourceId = investigating.sources.find((s) => s.url === url)!.id;
    expect(sourceId).toMatch(/^src-[0-9a-f]{16}$/);
    expect(sourceId).toBe(judging.sources.find((s) => s.url === url)!.id);
    expect(sourceIdsStableAcross([investigating, judging]).stable).toBe(true);

    const beforeLink = investigating.claims[0].evidence.find((l) => l.sourceId === sourceId);
    const afterLink = judging.claims[0].evidence.find((l) => l.sourceId === sourceId);
    expect(beforeLink?.role).toBe("unassessed");
    expect(afterLink?.role).toBe("support");

    const view = renderCanvas(investigating);
    const before = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    const region = document.querySelector("[data-gp-conclusion-region]");
    const original = document.querySelector(".gp-original");
    const board = document.querySelector('[data-gp-claim-id="claim-1"] .gp-evidence-board');
    expect(before).toBeInstanceOf(HTMLElement);
    expect(before?.getAttribute("data-gp-role")).toBe("unassessed");
    expect(before?.getAttribute("data-gp-identity")).toBe("stable");

    view.rerender(
      <InvestigationCanvas snapshot={judging} live onReverify={() => {}} onBackHome={() => {}} />,
    );
    const after = document.querySelector(`[data-gp-claim-id="claim-1"] [data-source-id="${sourceId}"]`);
    expect(after).toBe(before);
    expect(after?.getAttribute("data-gp-role")).toBe("support");
    expect(after?.getAttribute("data-gp-identity")).toBe("stable");
    expect(document.querySelector("[data-gp-conclusion-region]")).toBe(region);
    expect(document.querySelector(".gp-original")).toBe(original);
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-evidence-board')).toBe(board);
  });

  it("claim-2 没有把反向材料标成 support；originalSpan exact", () => {
    const complete = loadAfter76("complete.json");
    const claim2 = complete.claims.find((c) => c.text.includes("每次感冒都应当输液"));
    expect(claim2).toBeTruthy();
    const reverse = /不需要输液|无需输液|没必要输液|不必输液|输液没有必要|输液治疗没有必要/;
    const reverseSupport = (claim2!.evidence || []).filter(
      (l) => l.role === "support" && reverse.test(l.finding || ""),
    );
    expect(reverseSupport).toEqual([]);
    for (const claim of complete.claims) {
      const span = claim.originalSpan;
      expect(span).toBeTruthy();
      expect(complete.originalClaim.slice(span!.start, span!.end)).toBe(claim.text);
    }
  });
});

