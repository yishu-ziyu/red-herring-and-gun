import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRail } from "./ScoreRail";

describe("ScoreRail", () => {
  it("renders the overall score with denominator", () => {
    render(
      <ScoreRail
        scoreBreakdown={{ factCheckSignal: 0.3, searchSignal: 0, sourceSignal: 0.5 }}
        credibilityScore={62}
        credibilityLabel="基本可信"
      />,
    );
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByText("/100")).toBeInTheDocument();
  });

  it("renders all three signal names", () => {
    const { container } = render(
      <ScoreRail
        scoreBreakdown={{ factCheckSignal: 0.3, searchSignal: -0.1, sourceSignal: 0.5 }}
        credibilityScore={62}
        credibilityLabel="基本可信"
      />,
    );
    const names = container.querySelectorAll(".score-rail-signal-name");
    expect(names.length).toBe(3);
    expect(names[0]).toHaveTextContent("事实核查");
    expect(names[1]).toHaveTextContent("搜索证据");
    expect(names[2]).toHaveTextContent("来源可靠");
  });

  it("formats signal values with explicit +/- sign and 2 decimals", () => {
    render(
      <ScoreRail
        scoreBreakdown={{ factCheckSignal: 0.31, searchSignal: -0.12, sourceSignal: 0.55 }}
        credibilityScore={62}
        credibilityLabel="基本可信"
      />,
    );
    expect(screen.getByText("+0.31")).toBeInTheDocument();
    expect(screen.getByText("-0.12")).toBeInTheDocument();
    expect(screen.getByText("+0.55")).toBeInTheDocument();
  });

  it("classifies low score as danger tier", () => {
    const { container } = render(
      <ScoreRail
        scoreBreakdown={{ factCheckSignal: -0.5, searchSignal: -0.3, sourceSignal: -0.4 }}
        credibilityScore={12}
        credibilityLabel="谣言"
      />,
    );
    expect(container.querySelector(".score-rail--danger")).toBeTruthy();
  });

  it("classifies high score as great tier", () => {
    const { container } = render(
      <ScoreRail
        scoreBreakdown={{ factCheckSignal: 0.5, searchSignal: 0.4, sourceSignal: 0.6 }}
        credibilityScore={86}
        credibilityLabel="可信"
      />,
    );
    expect(container.querySelector(".score-rail--great")).toBeTruthy();
  });

  it("renders risk chips derived from signals (low score → multiple danger chips)", () => {
    render(
      <ScoreRail
        scoreBreakdown={{ factCheckSignal: -0.5, searchSignal: 0, sourceSignal: -0.4 }}
        credibilityScore={15}
        credibilityLabel="谣言"
      />,
    );
    // 风险标签在 score-rail-chips 容器里
    const chips = document.querySelectorAll(".score-rail-chip");
    expect(chips.length).toBeGreaterThan(0);
  });

  it("handles missing signal values gracefully (defaults to 0)", () => {
    const { container } = render(
      <ScoreRail
        scoreBreakdown={{}}
        credibilityScore={50}
        credibilityLabel="部分可信"
      />,
    );
    const nums = container.querySelectorAll(".score-rail-signal-num");
    expect(nums.length).toBe(3);
    nums.forEach((n) => expect(n.textContent).toBe("+0.00"));
  });

  it("main bar width is bounded 0..100 (out-of-range score clamps to 100)", () => {
    const { container } = render(
      <ScoreRail
        scoreBreakdown={{}}
        credibilityScore={150}
        credibilityLabel="可信"
      />,
    );
    const fill = container.querySelector(".score-rail-main-fill") as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe("100%");
  });
});