import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInvestigationSnapshot, type InvestigationSnapshotV1 } from "@rhg/core/investigation";
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
    renderCanvas(settlingBoard());
    fireEvent.click(document.querySelector('[data-source-id="src-1"]')!);
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
    const one = withClaimEvidence(base, [{ sourceId: "src-1", role: "unassessed" }]);
    const two = withClaimEvidence(base, [
      { sourceId: "src-1", role: "support" },
      { sourceId: "src-1", role: "contradict" },
    ]);
    const view = renderCanvas(one);
    const before = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]');
    expect(before).toBeInstanceOf(HTMLElement);
    expect(before?.getAttribute("data-gp-identity")).toBe("stable");
    expect(before?.getAttribute("data-gp-evidence-key")).toBe("claim-1:src-1");
    view.rerender(
      <InvestigationCanvas snapshot={two} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const afterNodes = [
      ...document.querySelectorAll('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]'),
    ];
    expect(afterNodes).toHaveLength(2);
    expect(afterNodes[0]).not.toBe(before);
    expect(afterNodes[1]).not.toBe(before);
    expect(document.contains(before)).toBe(false);
    expect(afterNodes.map((node) => node.getAttribute("data-gp-identity"))).toEqual(["relation", "relation"]);
    expect(afterNodes.every((node) => node.getAttribute("data-gp-evidence-key") !== "claim-1:src-1")).toBe(true);
    expect(afterNodes.every((node) => !node.getAttribute("data-gp-evidence-key")?.includes("#"))).toBe(true);
    expect(afterNodes.every((node) => node.getAttribute("data-gp-settling") == null)).toBe(true);
  });

  it("2× s1 → 1× s1：剩下那一行不得错误复用原先任一条", () => {
    const base = settlingBoard();
    const two = withClaimEvidence(base, [
      { sourceId: "src-1", role: "support" },
      { sourceId: "src-1", role: "contradict" },
    ]);
    const one = withClaimEvidence(base, [{ sourceId: "src-1", role: "support" }]);
    const view = renderCanvas(two);
    const beforeNodes = [
      ...document.querySelectorAll('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]'),
    ];
    expect(beforeNodes).toHaveLength(2);
    const beforeSupport = document.querySelector(
      '[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="support"]'
    );
    const beforeContradict = document.querySelector(
      '[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="contradict"]'
    );
    expect(beforeSupport).toBeInstanceOf(HTMLElement);
    expect(beforeContradict).toBeInstanceOf(HTMLElement);
    view.rerender(
      <InvestigationCanvas snapshot={one} live={false} finalReport={null} onReverify={() => {}} onBackHome={() => {}} />
    );
    const after = document.querySelector('[data-gp-claim-id="claim-1"] [data-source-id="src-1"]');
    expect(after).toBeInstanceOf(HTMLElement);
    expect(after).not.toBe(beforeSupport);
    expect(after).not.toBe(beforeContradict);
    expect(document.contains(beforeSupport)).toBe(false);
    expect(document.contains(beforeContradict)).toBe(false);
    expect(after?.getAttribute("data-gp-identity")).toBe("stable");
    expect(after?.getAttribute("data-gp-evidence-key")).toBe("claim-1:src-1");
    expect(after?.getAttribute("data-gp-role")).toBe("support");
  });

  it("duplicate reorder：可区分的两条 s1 不得因数组顺序互换身份", () => {
    const base = settlingBoard();
    const ordered = withClaimEvidence(base, [
      { sourceId: "src-1", role: "support", finding: "支持摘录" },
      { sourceId: "src-1", role: "contradict", finding: "反驳摘录" },
    ]);
    const reversed = withClaimEvidence(base, [
      { sourceId: "src-1", role: "contradict", finding: "反驳摘录" },
      { sourceId: "src-1", role: "support", finding: "支持摘录" },
    ]);
    const view = renderCanvas(ordered);
    const beforeSupport = document.querySelector(
      '[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="support"]'
    );
    const beforeContradict = document.querySelector(
      '[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="contradict"]'
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
      '[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="support"]'
    );
    const afterContradict = document.querySelector(
      '[data-gp-claim-id="claim-1"] [data-source-id="src-1"][data-gp-role="contradict"]'
    );
    expect(afterSupport).toBe(beforeSupport);
    expect(afterContradict).toBe(beforeContradict);
    expect(afterSupport?.getAttribute("data-gp-evidence-key")).toBe("claim-1:src-1::support");
    expect(afterContradict?.getAttribute("data-gp-evidence-key")).toBe("claim-1:src-1::contradict");
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
    const one = withClaimEvidence(beforeSnap, [{ sourceId: "src-1", role: "unassessed" }]);
    const two = withClaimEvidence(beforeSnap, [
      { sourceId: "src-1", role: "support", finding: "不该被猜进来的支持说明" },
      { sourceId: "src-1", role: "contradict", finding: "也不该被猜进来的反驳说明" },
    ]);
    const view = renderCanvas(one);
    const row = document.querySelector('[data-source-id="src-1"]') as HTMLButtonElement;
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
});
