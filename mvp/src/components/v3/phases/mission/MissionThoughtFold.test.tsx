import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissionThoughtFold } from "./MissionThoughtFold";

describe("MissionThoughtFold", () => {
  afterEach(() => {
    cleanup();
  });

  it("thinking: streams provided sentences only, no process chrome", () => {
    render(
      <MissionThoughtFold
        thinking
        elapsedMs={1200}
        sentences={["原句拆成可核对判断。", "对照公开报道。"]}
      />
    );
    expect(screen.getByLabelText("思考中")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByLabelText("思考中"));
    expect(screen.getByLabelText("思考中")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByLabelText("思考中"));
    expect(screen.getByLabelText("思考中")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("原句拆成可核对判断。")).toBeInTheDocument();
    expect(screen.getByText("对照公开报道。")).toBeInTheDocument();
    expect(screen.queryByLabelText("核查卷宗工作区")).not.toBeInTheDocument();
    expect(screen.queryByText(/jwt\.verify/)).not.toBeInTheDocument();
  });

  it("done: folds to 思考已完成, then expands sentences on click", async () => {
    const { rerender } = render(
      <MissionThoughtFold thinking elapsedMs={3500} sentences={["对照公开报道。"]} />
    );
    rerender(
      <MissionThoughtFold thinking={false} elapsedMs={3500} sentences={["对照公开报道。"]} />
    );
    await waitFor(
      () => {
        expect(screen.getByLabelText("切换思考记录")).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByText(/思考已完成/)).toBeInTheDocument();
      },
      { timeout: 1500 }
    );
    fireEvent.click(screen.getByLabelText("切换思考记录"));
    expect(screen.getByLabelText("切换思考记录")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("对照公开报道。")).toBeInTheDocument();
  });
});
