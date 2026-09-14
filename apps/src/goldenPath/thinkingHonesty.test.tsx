/**
 * 契约 docs/evals/2026-09-13-thinking-honesty.md
 * 假三步与真实阶段对不上要失败；原文不得整段回声；入场只打新对象。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { decomposedOnly, investigatingUnassessed, receivedOnly } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const WALL =
  "长城，又称万里长城，是中国古代规模最为宏大的军事防御工程。在流传甚广的说法里，长城是唯一一座能从太空中用肉眼看到的人造建筑。";

function canvas(snapshot: ReturnType<typeof investigatingUnassessed>, live: boolean) {
  return (
    <InvestigationCanvas
      snapshot={snapshot}
      live={live}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

describe("思考区诚实", () => {
  it("received 等 2 秒仍无假三步，也不回声整段原文", () => {
    vi.useFakeTimers();
    const snapshot = { ...receivedOnly(), originalClaim: WALL };
    render(<ThinkingDisclosure snapshot={snapshot} live />);
    const box = () => document.querySelector<HTMLElement>(".gp-thinking-box")!;
    expect(box().textContent).toContain("可以单独核对");
    expect(box().textContent).not.toContain("结构解析");
    expect(box().textContent).not.toContain("证伪边界");
    expect(box().textContent).not.toContain("确立议程");
    expect(box().textContent).not.toContain(WALL);
    expect(document.querySelector("[data-gp-thinking-mode]")!.getAttribute("data-gp-thinking-mode")).toBe("working");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(box().textContent).not.toContain("结构解析");
    expect(box().textContent).not.toContain("证伪边界");
    expect(box().textContent).not.toContain("确立议程");
    expect(box().textContent).not.toContain(WALL);
    expect(document.querySelector("[data-gp-thinking-state]")!.getAttribute("data-gp-thinking-state")).toBe("active");
  });

  it("命题出现后思考默认折叠，点开不复述命题全文，仍无假三步", () => {
    render(<ThinkingDisclosure snapshot={decomposedOnly()} live={false} />);
    expect(document.querySelector(".gp-thinking-title")!.textContent).toContain("3");
    expect(document.querySelector("[data-gp-thinking-mode]")!.getAttribute("data-gp-thinking-mode")).toBe("split");
    expect(document.querySelector(".gp-thinking-box")!.classList.contains("is-closed")).toBe(true);
    expect(document.querySelector(".gp-thinking-body")).toBeNull();

    act(() => {
      document.querySelector<HTMLElement>(".gp-thinking-head")!.click();
    });
    const body = document.querySelector<HTMLElement>(".gp-thinking-body")!;
    expect(body.textContent).toContain("下方按条核对");
    expect(body.textContent).not.toContain("咖啡的争夺");
    expect(body.textContent).not.toContain("结构解析");
    expect(body.textContent).not.toContain("证伪边界");
    expect(body.textContent).not.toContain("确立议程");
  });
});

describe("阶段入场", () => {
  it("live 调查中新命题和来源胶囊带 is-enter；完成态存量不带", () => {
    render(canvas(investigatingUnassessed(), true));
    expect(document.querySelector(".gp-claim.is-enter")).toBeTruthy();
    expect(document.querySelector(".gp-source-container.is-enter")).toBeTruthy();
    cleanup();
    render(canvas(investigatingUnassessed(), false));
    expect(document.querySelector(".gp-claim.is-enter")).toBeNull();
    expect(document.querySelector(".gp-source-container.is-enter")).toBeNull();
  });

  it("同一批 id 入场结束后再渲染不重闪", () => {
    vi.useFakeTimers();
    const snapshot = investigatingUnassessed();
    const { rerender } = render(canvas(snapshot, true));
    expect(document.querySelector(".gp-claim.is-enter")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector(".gp-claim.is-enter")).toBeNull();
    rerender(canvas(snapshot, true));
    expect(document.querySelector(".gp-claim.is-enter")).toBeNull();
    expect(document.querySelector(".gp-source-container.is-enter")).toBeNull();
  });

  it("reduced-motion 关掉命题与胶囊位移", () => {
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.gp-claim\.is-enter/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.gp-source-container\.is-enter/);
    expect(css).not.toMatch(/transition:\s*all/);
  });
});
