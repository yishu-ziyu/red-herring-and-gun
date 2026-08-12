import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThinkingReasoning } from "./ThinkingReasoning";

describe("ThinkingReasoning", () => {
  afterEach(() => {
    cleanup();
  });

  it("thinking: shows 整理推理… and only provided sentences (no invent)", () => {
    render(
      <ThinkingReasoning
        sentences={["真实句一。", "真实句二。"]}
        thinking
        elapsedMs={1000}
      />
    );
    expect(screen.getByLabelText("模型推理进行中")).toBeInTheDocument();
    expect(screen.getByText("整理推理…")).toBeInTheDocument();
    expect(screen.getByText("真实句一。")).toBeInTheDocument();
    expect(screen.getByText("真实句二。")).toBeInTheDocument();
    expect(screen.queryByText(/jwt\.verify/)).not.toBeInTheDocument();
  });

  it("done: folds to 推理用时 Ns using backend elapsedMs", async () => {
    const { rerender } = render(
      <ThinkingReasoning sentences={["句A。"]} thinking elapsedMs={3500} />
    );
    rerender(<ThinkingReasoning sentences={["句A。"]} thinking={false} elapsedMs={3500} />);
    await waitFor(
      () => {
        expect(screen.getByLabelText("切换推理记录")).toBeInTheDocument();
        expect(screen.getByText(/推理用时/)).toBeInTheDocument();
        expect(screen.getByText(/3\.5s/)).toBeInTheDocument();
      },
      { timeout: 1500 }
    );
  });

  it("done: empty sentences → render nothing", () => {
    const { container } = render(
      <ThinkingReasoning sentences={[]} thinking={false} elapsedMs={1000} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("done: toggle expands reasoning again", async () => {
    const { rerender } = render(
      <ThinkingReasoning sentences={["展开可见句。"]} thinking elapsedMs={2000} />
    );
    rerender(
      <ThinkingReasoning sentences={["展开可见句。"]} thinking={false} elapsedMs={2000} />
    );
    await waitFor(
      () => {
        expect(screen.getByLabelText("切换推理记录").getAttribute("aria-expanded")).toBe(
          "false"
        );
      },
      { timeout: 1500 }
    );
    const btn = screen.getByLabelText("切换推理记录");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("展开可见句。")).toBeInTheDocument();
  });
});
