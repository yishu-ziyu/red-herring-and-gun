import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThinkingReasoning } from "./ThinkingReasoning";

describe("ThinkingReasoning", () => {
  afterEach(() => {
    cleanup();
  });

  it("thinking: shows 思考中 and only provided sentences (no invent)", () => {
    render(
      <ThinkingReasoning
        sentences={["真实句一。", "真实句二。"]}
        thinking
        elapsedMs={1000}
      />
    );
    expect(screen.getByLabelText("思考中")).toBeInTheDocument();
    expect(screen.getByText("思考中")).toBeInTheDocument();
    expect(screen.getByText("真实句一。")).toBeInTheDocument();
    expect(screen.getByText("真实句二。")).toBeInTheDocument();
    expect(screen.queryByText(/jwt\.verify/)).not.toBeInTheDocument();
  });

  it("thinking: live unfinished sentence is visible under 思考中", () => {
    render(
      <ThinkingReasoning
        layout="thread"
        sentences={["先看原句是否"]}
        thinking
        elapsedMs={800}
      />
    );
    expect(screen.getByText("思考中")).toBeInTheDocument();
    expect(screen.getByText("先看原句是否")).toBeInTheDocument();
  });

  it("thinking: header chevron folds the live reasoning", () => {
    render(
      <ThinkingReasoning
        layout="thread"
        sentences={["原句拆成可核对判断。"]}
        thinking
        elapsedMs={800}
      />
    );
    const btn = screen.getByLabelText("思考中");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.className).toMatch(/isClickable/);
  });

  it("done: folds to 思考已完成 using backend elapsedMs", async () => {
    const { rerender } = render(
      <ThinkingReasoning sentences={["句A。"]} thinking elapsedMs={3500} />
    );
    rerender(<ThinkingReasoning sentences={["句A。"]} thinking={false} elapsedMs={3500} />);
    await waitFor(
      () => {
        expect(screen.getByLabelText("切换思考记录")).toBeInTheDocument();
        expect(screen.getByText(/思考已完成/)).toBeInTheDocument();
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

  it("thread: empty done still shows 思考已完成", async () => {
    const { rerender } = render(
      <ThinkingReasoning layout="thread" sentences={[]} thinking elapsedMs={15000} />
    );
    expect(screen.getByLabelText("思考中")).toBeInTheDocument();
    rerender(
      <ThinkingReasoning layout="thread" sentences={[]} thinking={false} elapsedMs={15000} />
    );
    await waitFor(
      () => {
        expect(screen.getByLabelText("切换思考记录")).toBeInTheDocument();
        expect(screen.getByText(/思考已完成/)).toBeInTheDocument();
      },
      { timeout: 1500 }
    );
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
        expect(screen.getByLabelText("切换思考记录").getAttribute("aria-expanded")).toBe(
          "false"
        );
      },
      { timeout: 1500 }
    );
    const btn = screen.getByLabelText("切换思考记录");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("展开可见句。")).toBeInTheDocument();
  });
});
