import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import {
  conflictKnownReason,
  conflictUnknownReason,
  interruptedPartial,
  investigatingUnassessed,
  LONG_CLAIM_PREFIX,
  longClaimComplete,
  mixedComplete,
  refutedComplete,
  supportedComplete,
  unresolvedComplete,
} from "./fixtures";
import { applyRunEvent, type RunState } from "./useInvestigationRun";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";

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
    const group = claim.querySelector('[data-gp-role="unassessed"]')!;
    expect(within(group as HTMLElement).getByText("待核对")).toBeTruthy();
    expect(group.querySelector('[data-gp-role="support"]')).toBeNull();
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

