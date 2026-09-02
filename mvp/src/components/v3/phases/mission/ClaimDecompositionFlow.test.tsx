import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ClaimDecompositionFlow,
  NARROW_QUERY,
  type ClaimDecompositionNode,
} from "./ClaimDecompositionFlow";

// jsdom 无 matchMedia：默认桌面（graph 布局），窄屏用例单独覆盖。
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
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

// ReactFlow 在 jsdom 下依赖 ResizeObserver/DOMMatrix；测试里 mock 成纯渲染层，
// 保留 position / nodeTypes / edges，以验证确定性布局与自定义节点行为。
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
          React.createElement("div", {
            key: e.id,
            "data-testid": "flow-edge",
            "data-source": e.source,
            "data-target": e.target,
          })
        ),
        nodes.map((n: any) => {
          const Cmp = nodeTypes[n.type];
          return React.createElement(
            "div",
            {
              key: n.id,
              "data-testid": "flow-node",
              "data-node-id": n.id,
              "data-x": n.position.x,
              "data-y": n.position.y,
            },
            React.createElement(Cmp, { id: n.id, data: n.data, type: n.type, position: n.position })
          );
        })
      ),
  };
});

const ATOMS: ClaimDecompositionNode[] = [
  { id: "a1", text: "隔夜菜中含有亚硝酸盐", verifiable: true, type: "fact", status: "completed" },
  { id: "a2", text: "亚硝酸盐加热后转化为致癌物", verifiable: true, type: "causal", status: "searching" },
  { id: "a3", text: "所以隔夜菜绝对不能吃", verifiable: false, type: "concept", status: "idle" },
];

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClaimDecompositionFlow", () => {
  it("1 claim + 3 atoms → 1 root + 3 atom nodes with correct edges", () => {
    render(<ClaimDecompositionFlow claim="隔夜菜加热会致癌吗" atoms={ATOMS} />);

    expect(screen.getByTestId("claim-decomposition")).toHaveAttribute("data-layout", "graph");
    expect(screen.getByTestId("claim-root-card")).toHaveTextContent("隔夜菜加热会致癌吗");

    const nodes = screen.getAllByTestId("flow-node");
    expect(nodes).toHaveLength(4);
    const ids = nodes.map((n) => n.getAttribute("data-node-id"));
    expect(ids).toEqual(["claim-root", "a1", "a2", "a3"]);

    const edges = screen.getAllByTestId("flow-edge");
    expect(edges).toHaveLength(3);
    for (const e of edges) expect(e.getAttribute("data-source")).toBe("claim-root");
    expect(edges.map((e) => e.getAttribute("data-target"))).toEqual(["a1", "a2", "a3"]);
  });

  it("deterministic layout for 2 and 6 atoms: no overlap, root beside centered column", () => {
    const two = ATOMS.slice(0, 2);
    const six = Array.from({ length: 6 }, (_, i) => ({
      id: `b${i}`,
      text: `命题六条之${i + 1}`,
      verifiable: true,
      type: "fact",
      status: "idle" as const,
    }));

    for (const atoms of [two, six]) {
      cleanup();
      render(<ClaimDecompositionFlow claim="原句" atoms={atoms} />);
      const nodes = screen.getAllByTestId("flow-node");
      const ys = nodes.slice(1).map((n) => Number(n.getAttribute("data-y")));
      const xs = nodes.slice(1).map((n) => Number(n.getAttribute("data-x")));
      // 纵向排列：y 严格递增且间距 ≥ 行高（140 > 节点高 112），x 同列 → 不重叠
      expect(new Set(ys).size).toBe(atoms.length);
      expect(ys.every((y, i) => i === 0 || y - ys[i - 1] >= 140)).toBe(true);
      expect(new Set(xs).size).toBe(1);
      const root = nodes[0];
      expect(Number(root.getAttribute("data-x"))).toBeLessThan(xs[0]);
      const mid = (ys[0] + ys[ys.length - 1]) / 2;
      expect(Math.abs(Number(root.getAttribute("data-y")) - mid)).toBeLessThan(70);
    }
  });

  it("status labels are text: searching/completed/failed/unverifiable/idle", () => {
    const all: ClaimDecompositionNode[] = [
      { id: "s1", text: "待核查命题", verifiable: true, status: "idle" },
      { id: "s2", text: "核查中命题", verifiable: true, status: "searching" },
      { id: "s3", text: "已核查命题", verifiable: true, status: "completed" },
      { id: "s4", text: "核查失败命题", verifiable: true, status: "failed" },
      { id: "s5", text: "无法核查命题", verifiable: false, status: "unverifiable" },
    ];
    render(<ClaimDecompositionFlow claim="原句" atoms={all} />);

    expect(within(screen.getByTestId("atom-card-s1")).getByText("待核查")).toBeInTheDocument();
    expect(within(screen.getByTestId("atom-card-s2")).getByText("核查中")).toBeInTheDocument();
    expect(within(screen.getByTestId("atom-card-s3")).getByText("已核查")).toBeInTheDocument();
    expect(within(screen.getByTestId("atom-card-s4")).getByText("核查失败")).toBeInTheDocument();
    expect(within(screen.getByTestId("atom-card-s5")).getByText("无法核查")).toBeInTheDocument();
    // 可核查性也是文字，不单靠颜色
    expect(within(screen.getByTestId("atom-card-s5")).getByText("不可核查")).toBeInTheDocument();
    expect(within(screen.getByTestId("atom-card-s2")).getByText("可核查")).toBeInTheDocument();
  });

  it("unverifiable atom never shows 核查中 even when status=searching", () => {
    render(
      <ClaimDecompositionFlow
        claim="原句"
        atoms={[{ id: "u1", text: "主观感受命题", verifiable: false, status: "searching" }]}
      />
    );
    const card = screen.getByTestId("atom-card-u1");
    expect(card).toHaveAttribute("data-status", "unverifiable");
    expect(within(card).getByText("无法核查")).toBeInTheDocument();
    expect(within(card).queryByText("核查中")).not.toBeInTheDocument();
  });

  it("click, Enter and Space all call onSelectAtom with the atom id", () => {
    const onSelectAtom = vi.fn();
    render(
      <ClaimDecompositionFlow claim="原句" atoms={ATOMS} selectedAtomId="a1" onSelectAtom={onSelectAtom} />
    );
    const card = screen.getByTestId("atom-card-a2");
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabindex", "0");

    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onSelectAtom).toHaveBeenCalledTimes(3);
    expect(onSelectAtom).toHaveBeenNthCalledWith(1, "a2");
    expect(onSelectAtom).toHaveBeenNthCalledWith(2, "a2");
    expect(onSelectAtom).toHaveBeenNthCalledWith(3, "a2");
  });

  it("selected state lands on exactly one proposition", () => {
    render(<ClaimDecompositionFlow claim="原句" atoms={ATOMS} selectedAtomId="a2" />);
    const selected = ATOMS.filter(
      (a) => screen.getByTestId(`atom-card-${a.id}`).getAttribute("data-selected") === "true"
    );
    expect(selected).toHaveLength(1);
    expect(screen.getByTestId("atom-card-a2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("atom-card-a1")).toHaveAttribute("aria-pressed", "false");
  });

  it("root claim node is not selectable", () => {
    const onSelectAtom = vi.fn();
    render(<ClaimDecompositionFlow claim="原句" atoms={ATOMS} onSelectAtom={onSelectAtom} />);
    const root = screen.getByTestId("claim-root-card");
    fireEvent.click(root);
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onSelectAtom).not.toHaveBeenCalled();
    expect(root).not.toHaveAttribute("role", "button");
  });

  it("narrow screens switch to a vertical stack with no graph canvas", () => {
    stubMatchMedia(true);
    render(<ClaimDecompositionFlow claim="隔夜菜加热会致癌吗" atoms={ATOMS} selectedAtomId="a3" />);

    expect(screen.getByTestId("claim-decomposition")).toHaveAttribute("data-layout", "stack");
    expect(screen.queryByTestId("react-flow")).not.toBeInTheDocument();

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4); // 原句 + 3 命题，DOM 顺序即纵向顺序
    // 堆叠布局下信息完整：文字状态保留
    expect(within(screen.getByTestId("atom-card-a3")).getByText("无法核查")).toBeInTheDocument();
    expect(screen.getByTestId("atom-card-a3")).toHaveAttribute("data-selected", "true");
  });

  it("uses the shared narrow breakpoint query", () => {
    render(<ClaimDecompositionFlow claim="原句" atoms={ATOMS} />);
    expect(window.matchMedia).toHaveBeenCalledWith(NARROW_QUERY);
  });
});
