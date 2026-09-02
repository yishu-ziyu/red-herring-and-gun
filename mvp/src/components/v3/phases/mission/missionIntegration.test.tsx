/**
 * Issue #14 集成接线测试（fixture 驱动，零真实网络）：
 * SSE 事件 → adaptOrchestrateStreamToShell → mapShellToApodexRun → ApodexRunView。
 * 覆盖：三原子顺序检索 / 不可核查原子 / 部分与全部 provider 失败 /
 * SSE 持续到达时选中态保持 / 最终报告按稳定 ID 关联逐条判定 / 旧报告无检索事件降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  OrchestrateStreamEvent,
  SearchProgressProvider,
} from "../../../../lib/agentExpansion";
import { adaptOrchestrateStreamToShell } from "../../../../lib/missionShell";
import { FIXTURE_COMPLETE } from "../../../../lib/missionShell/fixtures";
import { claimAtomKey } from "../../../../lib/claimAtom";
import { mapShellToApodexRun } from "./apodexRunMap";
import { ApodexRunView } from "./ApodexRunView";

// ReactFlow 在 jsdom 下依赖 ResizeObserver/DOMMatrix：与 ClaimDecompositionFlow.test 同款 mock，
// 保留 position / nodeTypes / edges，验证真实接线而非画布实现。
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    Handle: () => null,
    ReactFlow: ({ nodes, edges, nodeTypes }: any) =>
      React.createElement(
        "div",
        { "data-testid": "react-flow" },
        (edges ?? []).map((e: any) =>
          React.createElement("div", { key: e.id, "data-testid": "flow-edge" })
        ),
        nodes.map((n: any) => {
          const Cmp = nodeTypes[n.type];
          return React.createElement(
            "div",
            { key: n.id, "data-testid": "flow-node", "data-node-id": n.id },
            React.createElement(Cmp, { id: n.id, data: n.data, type: n.type, position: n.position })
          );
        })
      ),
  };
});

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const A = "隔夜菜加热会产生亚硝酸盐";
const B = "亚硝酸盐会转化为致癌物";
const C = "所以隔夜菜绝对不能吃";

const pv = (
  id: string,
  status: SearchProgressProvider["status"],
  resultCount = 0
): SearchProgressProvider =>
  ({ id, label: "公开检索", status, resultCount }) as SearchProgressProvider;

const ALL_OK = [pv("360_search", "completed", 4), pv("any_search", "completed", 3)];
const PARTIAL_FAIL = [
  pv("360_search", "completed", 4),
  pv("any_search", "partial", 2),
  pv("tavily_search", "failed", 0),
];
const ALL_FAIL = [pv("360_search", "failed", 0), pv("any_search", "failed", 0)];

const STATS = {
  rawResultCount: 10,
  uniqueSourceCount: 5,
  sharedSourceCount: 2,
  singleProviderSourceCount: 3,
};
const SOURCES = [
  { title: "科普来源一", url: "https://a.test/1", providerOrigins: ["360_search"] },
  { title: "科普来源二", url: "https://b.test/2", providerOrigins: ["any_search"] },
];

let ts = 100;
const sp = (
  atom: string,
  phase: "started" | "progress" | "completed",
  providers: SearchProgressProvider[],
  extra?: { stats?: typeof STATS; sources?: typeof SOURCES }
): OrchestrateStreamEvent => ({
  type: "search_progress",
  atom,
  phase,
  queryCount: 1,
  providers,
  stats: extra?.stats,
  sources: extra?.sources,
  timestamp: (ts += 1),
});

const rumorDone = (
  atoms: Array<{ text: string; verifiable: boolean; type: string }>
): OrchestrateStreamEvent => ({
  type: "agent_complete",
  agent: "rumor_detector",
  output: { claimAtomTypes: atoms },
  timestamp: 10,
});

const THREE_VERIFIABLE = rumorDone([
  { text: A, verifiable: true, type: "fact" },
  { text: B, verifiable: true, type: "causal" },
  { text: C, verifiable: true, type: "fact" },
]);

const run = (events: OrchestrateStreamEvent[], claim = "隔夜菜加热会致癌吗") =>
  mapShellToApodexRun(adaptOrchestrateStreamToShell(events, { claim }));

beforeEach(() => {
  stubMatchMedia();
  ts = 100;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("核查地图接线（拆解 + 雷达 + atomSearch 直通）", () => {
  it("场景1：三个可核查原子 searching→completed 顺序推进；默认选中首个可核查原子", () => {
    const afterSplit = run([THREE_VERIFIABLE]);
    expect(afterSplit.claimMap?.atoms.map((a) => a.status)).toEqual(["idle", "idle", "idle"]);
    expect(afterSplit.claimMap?.defaultAtomId).toBe(claimAtomKey(A));

    const firstSearching = run([
      THREE_VERIFIABLE,
      sp(A, "started", [pv("360_search", "running"), pv("any_search", "pending")]),
    ]);
    expect(firstSearching.claimMap?.atoms.map((a) => a.status)).toEqual([
      "searching",
      "idle",
      "idle",
    ]);

    const secondSearching = run([
      THREE_VERIFIABLE,
      sp(A, "started", [pv("360_search", "running")]),
      sp(A, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
      sp(B, "started", [pv("360_search", "running")]),
    ]);
    expect(secondSearching.claimMap?.atoms.map((a) => a.status)).toEqual([
      "completed",
      "searching",
      "idle",
    ]);

    const allDone = run([
      THREE_VERIFIABLE,
      sp(A, "started", [pv("360_search", "running")]),
      sp(A, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
      sp(B, "started", [pv("360_search", "running")]),
      sp(B, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
      sp(C, "started", [pv("360_search", "running")]),
      sp(C, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
    ]);
    expect(allDone.claimMap?.atoms.map((a) => a.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    // 雷达直通：默认原子的 providers/stats 来自 atomSearch[atom]
    const radarA = allDone.claimMap?.radarByAtom[claimAtomKey(A)];
    expect(radarA?.phase).toBe("completed");
    expect(radarA?.stats).toEqual(STATS);
    expect(radarA?.sources.map((s) => s.url)).toEqual(["https://a.test/1", "https://b.test/2"]);
  });

  it("场景2：不可核查原子永远 unverifiable，即使误收到 search_progress 也不进 searching", () => {
    const model = run([
      rumorDone([
        { text: A, verifiable: true, type: "fact" },
        { text: C, verifiable: false, type: "concept" },
      ]),
      sp(C, "started", [pv("360_search", "running")]),
    ]);
    const atoms = model.claimMap?.atoms ?? [];
    expect(atoms.find((a) => a.id === claimAtomKey(C))?.status).toBe("unverifiable");
    // 不可核查原子不进雷达表；默认选中仍是首个可核查原子
    expect(model.claimMap?.radarByAtom[claimAtomKey(C)]).toBeUndefined();
    expect(model.claimMap?.defaultAtomId).toBe(claimAtomKey(A));
  });

  it("无可核查原子时不生成默认选中（不展示雷达）", () => {
    const model = run([
      rumorDone([
        { text: "这药太好吃了", verifiable: false, type: "value" },
        { text: "大家都该支持", verifiable: false, type: "normative" },
      ]),
    ]);
    expect(model.claimMap?.defaultAtomId).toBeUndefined();
    expect(Object.keys(model.claimMap?.radarByAtom ?? {})).toHaveLength(0);
    expect(model.claimMap?.atoms.every((a) => a.status === "unverifiable")).toBe(true);
  });

  it("场景3：部分 provider 失败但仍有来源 → completed，雷达保留 partial/failed 真实状态", () => {
    const model = run([
      THREE_VERIFIABLE,
      sp(A, "completed", PARTIAL_FAIL, { stats: STATS, sources: SOURCES }),
    ]);
    expect(model.claimMap?.atoms[0].status).toBe("completed");
    expect(model.claimMap?.radarByAtom[claimAtomKey(A)]?.providers.map((p) => p.status)).toEqual([
      "completed",
      "partial",
      "failed",
    ]);
  });

  it("场景4：全部 provider 失败且零来源 → failed", () => {
    const model = run([
      THREE_VERIFIABLE,
      sp(A, "started", [pv("360_search", "running")]),
      sp(A, "completed", ALL_FAIL, { stats: { ...STATS, uniqueSourceCount: 0 }, sources: [] }),
    ]);
    expect(model.claimMap?.atoms[0].status).toBe("failed");
    // 雷达仍如实展示该原子的失败态 provider，不隐藏数据
    expect(model.claimMap?.radarByAtom[claimAtomKey(A)]?.providers.every((p) => p.status === "failed")).toBe(
      true
    );
  });

  it("completed 原子零来源判 failed，有来源判 completed", () => {
    const noSource = run([
      THREE_VERIFIABLE,
      sp(A, "completed", ALL_OK, { stats: { ...STATS, uniqueSourceCount: 0 } }),
    ]);
    expect(noSource.claimMap?.atoms[0].status).toBe("failed");
    const withSource = run([
      THREE_VERIFIABLE,
      sp(A, "completed", ALL_OK, { stats: { ...STATS, uniqueSourceCount: 0 }, sources: SOURCES }),
    ]);
    expect(withSource.claimMap?.atoms[0].status).toBe("completed");
  });
});

describe("最终报告按稳定 ID 关联逐条判定", () => {
  const completeEvent = (
    items: Array<Record<string, unknown>>
  ): OrchestrateStreamEvent => ({
    type: "complete",
    finalReport: {
      verdictType: "mixed_misleading",
      conclusion: "说法存在夸大，加热不当有风险但不宜直接等同致癌。",
      claimItems: items,
    },
    timestamp: 999,
  });

  it("场景6：claimItems 的 verdict 按 claimAtomKey 精确挂到对应命题卡", () => {
    const model = run([
      rumorDone([
        { text: A, verifiable: true, type: "fact" },
        { text: B, verifiable: true, type: "causal" },
        { text: C, verifiable: false, type: "concept" },
      ]),
      completeEvent([
        { text: A, verifiable: true, type: "fact", verdict: { claimAtom: A, verdict: "false" } },
        { text: B, verifiable: true, type: "causal", verdict: { claimAtom: B, verdict: "partial" } },
        { text: C, verifiable: false, type: "concept" },
      ]),
    ]);
    expect(model.report).toBeDefined();
    expect(model.claimMap?.atoms.map((a) => a.verdictLabel)).toEqual([
      "不能信",
      "只能信一部分",
      undefined,
    ]);
  });

  it("判定不靠文本包含或数组位置猜：claimItems 文本对不上任何原子时不挂载", () => {
    const model = run([
      rumorDone([{ text: A, verifiable: true, type: "fact" }]),
      completeEvent([
        { text: "另一条不相干的命题", verifiable: true, type: "fact", verdict: { verdict: "false" } },
      ]),
    ]);
    expect(model.claimMap?.atoms[0].verdictLabel).toBeUndefined();
  });

  it("无 claimItems 时回退 subclaimVerdicts.claimAtom 精确匹配", () => {
    const model = run([
      rumorDone([{ text: A, verifiable: true, type: "fact" }]),
      {
        type: "complete",
        finalReport: {
          verdictType: "false",
          conclusion: "公开材料不支持这句话。",
          subclaimVerdicts: [{ claimAtom: A, verdict: "true", evidence: "", boundary: "" }],
        },
        timestamp: 999,
      },
    ]);
    expect(model.claimMap?.atoms[0].verdictLabel).toBe("能信");
  });
});

describe("工作台渲染接线", () => {
  it("场景5：SSE 持续到达时用户选中保持，雷达与统计切到所选原子", () => {
    const initial = run([
      THREE_VERIFIABLE,
      sp(A, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
    ]);
    const { rerender } = render(
      <ApodexRunView model={initial} runStatus="running" onStop={() => undefined} />
    );

    // 默认选中首个可核查原子：雷达展示 A 的统计
    expect(screen.getByTestId(`atom-card-${claimAtomKey(A)}`)).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("radar-stats")).toHaveTextContent("10 条原始结果 → 5 个去重来源");

    // 用户点击 B
    fireEvent.click(screen.getByTestId(`atom-card-${claimAtomKey(B)}`));
    expect(screen.getByTestId(`atom-card-${claimAtomKey(B)}`)).toHaveAttribute(
      "data-selected",
      "true"
    );
    // B 还没有检索事件 → 不展示雷达
    expect(screen.queryByTestId("search-radar")).not.toBeInTheDocument();

    // 同一运行继续喂事件：B started+completed、A 又收到 completed 快照 ——
    // 重渲染后选中必须仍是 B（不被新事件重置、不被已完成原子跳走），雷达换成 B 的数据
    const updated = run([
      THREE_VERIFIABLE,
      sp(A, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
      sp(B, "started", [pv("360_search", "running")]),
      sp(B, "completed", ALL_OK, {
        stats: { rawResultCount: 4, uniqueSourceCount: 2, sharedSourceCount: 0, singleProviderSourceCount: 2 },
        sources: [SOURCES[0]],
      }),
    ]);
    rerender(<ApodexRunView model={updated} runStatus="running" onStop={() => undefined} />);

    expect(screen.getByTestId(`atom-card-${claimAtomKey(B)}`)).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("radar-stats")).toHaveTextContent("4 条原始结果 → 2 个去重来源");
  });

  it("查看来源明细展开所选原子的真实来源；切换原子后收起", () => {
    const model = run([
      THREE_VERIFIABLE,
      sp(A, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
      sp(B, "completed", ALL_OK, { stats: STATS, sources: SOURCES }),
    ]);
    render(<ApodexRunView model={model} runStatus="running" onStop={() => undefined} />);

    expect(screen.queryByTestId("atom-sources")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看来源明细" }));
    const panel = screen.getByTestId("atom-sources");
    expect(panel).toHaveTextContent("科普来源一");
    expect(panel.querySelector("a")?.getAttribute("href")).toBe("https://a.test/1");

    fireEvent.click(screen.getByTestId(`atom-card-${claimAtomKey(B)}`));
    expect(screen.queryByTestId("atom-sources")).not.toBeInTheDocument();
  });

  it("核查地图是一级内容：命题拆解可见且位于折叠日志之前，日志仍可折叠", () => {
    const model = run([
      THREE_VERIFIABLE,
      sp(A, "started", [pv("360_search", "running")]),
    ]);
    const { container } = render(
      <ApodexRunView model={model} runStatus="running" onStop={() => undefined} />
    );

    expect(screen.getByTestId("claim-map")).toBeInTheDocument();
    expect(screen.getByTestId("claim-decomposition")).toBeInTheDocument();
    const logToggle = screen.getByRole("button", { name: /核查过程/ });
    // 地图在 DOM 中先于运行日志 → 一级内容
    const html = container.innerHTML;
    expect(html.indexOf("claim-map")).toBeLessThan(html.indexOf("核查过程"));
    expect(logToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(logToggle);
    expect(logToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("场景7：旧报告无 search_progress 事件 → 拆解可见但无雷达，不崩溃", () => {
    const model = run(FIXTURE_COMPLETE);
    render(<ApodexRunView model={model} runStatus="completed" onStop={() => undefined} />);
    expect(screen.getByTestId("claim-map")).toBeInTheDocument();
    expect(screen.queryByTestId("search-radar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("核心结论")).toBeInTheDocument();
  });

  it("场景7b：更早的存档（连拆题事件都没有）→ 无地图无雷达，报告照常", () => {
    const model = run([
      {
        type: "complete",
        finalReport: {
          verdictType: "false",
          conclusion: "公开材料不支持这句话。",
          citationSources: [{ title: "示例", url: "https://example.com/x" }],
        },
        timestamp: 1,
      },
    ]);
    expect(model.claimMap).toBeUndefined();
    render(<ApodexRunView model={model} runStatus="completed" onStop={() => undefined} />);
    expect(screen.queryByTestId("claim-map")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-radar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("核心结论")).toBeInTheDocument();
  });

  it("界面不泄漏模型名、Agent 名、密钥或内部错误", () => {
    const model = run([
      THREE_VERIFIABLE,
      sp(A, "completed", ALL_FAIL, { stats: { ...STATS, uniqueSourceCount: 0 } }),
    ]);
    const { container } = render(
      <ApodexRunView model={model} runStatus="running" onStop={() => undefined} />
    );
    expect(container.textContent).not.toMatch(
      /rumor_detector|fact_checker|360_search|any_search|tavily|deepseek|api.?key|quota/i
    );
  });
});
