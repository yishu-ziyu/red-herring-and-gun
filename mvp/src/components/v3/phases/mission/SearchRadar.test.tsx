import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SearchRadar,
  type SearchRadarProvider,
  type SearchRadarStats,
} from "./SearchRadar";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  // jsdom 无 matchMedia；这里同时覆盖 addEventListener/removeEventListener。
  (window as unknown as { matchMedia: unknown }).matchMedia = (media: string) => ({
    media,
    matches,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
    onchange: null,
    dispatchEvent: () => false,
  });
}

const P = (
  id: string,
  status: SearchRadarProvider["status"],
  resultCount = 0
): SearchRadarProvider => ({ id, label: `检索源 ${id}`, status, resultCount });

const STATS: SearchRadarStats = {
  rawResultCount: 42,
  uniqueSourceCount: 17,
  sharedSourceCount: 9,
  singleProviderSourceCount: 8,
};

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("SearchRadar 布局", () => {
  it("支持 1、3、5 路 provider，行数与入参一致", () => {
    for (const n of [1, 3, 5]) {
      const providers = Array.from({ length: n }, (_, i) => P(`p${i}`, "completed", i + 1));
      const { unmount } = render(<SearchRadar providers={providers} phase="progress" />);
      expect(screen.getAllByTestId(/^radar-provider-/)).toHaveLength(n);
      unmount();
    }
  });

  it("providers 为空时不渲染", () => {
    const { container } = render(<SearchRadar providers={[]} phase="idle" />);
    expect(container.querySelector("[data-testid='search-radar']")).toBeNull();
  });
});

describe("SearchRadar 五种状态的可读展示", () => {
  it("pending/running/completed/partial/failed 都有文字，partial 明说部分返回、failed 明说失败", () => {
    render(
      <SearchRadar
        providers={[
          P("a", "pending"),
          P("b", "running"),
          P("c", "completed", 12),
          P("d", "partial", 5),
          P("e", "failed"),
        ]}
        phase="progress"
      />
    );
    expect(screen.getByTestId("radar-provider-a")).toHaveTextContent("等待中");
    expect(screen.getByTestId("radar-provider-b")).toHaveTextContent("检索中");
    expect(screen.getByTestId("radar-provider-c")).toHaveTextContent("完成 · 12 条");
    expect(screen.getByTestId("radar-provider-d")).toHaveTextContent("部分返回 · 5 条");
    expect(screen.getByTestId("radar-provider-e")).toHaveTextContent("失败");
    // 状态不只靠颜色：每行带 data-status 与文字
    expect(screen.getByTestId("radar-provider-e")).toHaveAttribute("data-status", "failed");
  });

  it("pending/running/failed 不预告数字，completed/partial 展示真实 resultCount", () => {
    render(
      <SearchRadar
        providers={[P("a", "pending"), P("b", "running"), P("c", "failed"), P("d", "completed", 7)]}
        phase="progress"
      />
    );
    expect(screen.getByTestId("radar-provider-a").textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("radar-provider-b").textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("radar-provider-c").textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("radar-provider-d")).toHaveTextContent("7 条");
  });

  it("failed/partial 不影响其它成功路继续展示", () => {
    render(
      <SearchRadar
        providers={[P("x", "failed"), P("y", "partial", 3), P("z", "completed", 9)]}
        phase="progress"
      />
    );
    expect(screen.getByTestId("radar-provider-z")).toHaveTextContent("完成 · 9 条");
    expect(screen.getByTestId("radar-provider-y")).toHaveTextContent("部分返回 · 3 条");
  });
});

describe("SearchRadar 统计", () => {
  it("stats 未返回时不显示 0 占位、不编造数字", () => {
    render(<SearchRadar providers={[P("a", "running")]} phase="progress" />);
    expect(screen.queryByTestId("radar-stats")).toBeNull();
    expect(screen.queryByTestId("radar-summary")).toBeNull();
    expect(screen.getByTestId("radar-pool")).toHaveTextContent("来源统计整理中");
    expect(screen.getByTestId("search-radar").textContent).not.toMatch(/0 条原始结果|→ 0 /);
  });

  it("completed 严格使用传入的四项 stats", () => {
    render(
      <SearchRadar
        providers={[P("a", "completed", 12), P("b", "completed", 30)]}
        stats={STATS}
        phase="completed"
      />
    );
    expect(screen.getByTestId("radar-summary")).toHaveTextContent("2 路检索");
    expect(screen.getByTestId("radar-stats")).toHaveTextContent("42 条原始结果 → 17 个去重来源");
    expect(screen.getByTestId("radar-overlap")).toHaveTextContent(
      "共同命中 9 个 · 单路发现 8 个"
    );
    expect(screen.getByTestId("search-radar")).toHaveTextContent("检索完成");
  });

  it("共同命中措辞附带『不代表结论可信度』说明", () => {
    render(<SearchRadar providers={[P("a", "completed", 1)]} stats={STATS} phase="completed" />);
    expect(screen.getByTestId("search-radar").textContent).toMatch(
      /共同命中.*不代表结论可信度/
    );
  });
});

describe("SearchRadar 动效与可达性", () => {
  it("非 reduce 下仅 running 路有移动光束，其余为静态线", () => {
    render(
      <SearchRadar
        providers={[P("a", "running"), P("b", "completed", 4), P("c", "pending")]}
        phase="progress"
      />
    );
    expect(document.querySelectorAll('[data-testid="beam-animated"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="beam-static"]')).toHaveLength(2);
  });

  it("prefers-reduced-motion：无循环光束，但状态与统计信息完整", () => {
    mockMatchMedia(true);
    render(
      <SearchRadar
        providers={[P("a", "running"), P("b", "completed", 12)]}
        stats={STATS}
        phase="completed"
      />
    );
    expect(screen.getByTestId("search-radar")).toHaveAttribute("data-reduced-motion", "true");
    expect(document.querySelectorAll('[data-testid="beam-animated"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="beam-static"]')).toHaveLength(2);
    // 信息不丢失
    expect(screen.getByTestId("radar-provider-a")).toHaveTextContent("检索中");
    expect(screen.getByTestId("radar-summary")).toHaveTextContent("42 条原始结果");
  });

  it("查看来源明细是原生 button，可访问名清晰并触发回调", () => {
    const onOpenSources = vi.fn();
    render(
      <SearchRadar providers={[P("a", "completed", 1)]} stats={STATS} phase="completed" onOpenSources={onOpenSources} />
    );
    const btn = screen.getByRole("button", { name: "查看来源明细" });
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });
});
