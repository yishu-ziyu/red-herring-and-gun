/**
 * 契约 docs/evals/2026-09-13-thinking-wait-status.md
 * 阶段文案随服务端快照变；无事件时只有秒数变。不得用时间假装解锁。
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { decomposedOnly, receivedOnly } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SPLIT = "正在把这句话拆成可以单独核对的问题";
const CHECK = "正在核对刚拆出的说法站不站得住";

function titleText(): string {
  return document.querySelector(".gp-thinking-title")!.textContent ?? "";
}

function timerText(): string {
  return document.querySelector(".gp-thinking-timer")!.textContent ?? "";
}

function waitSeconds(): number {
  const match = timerText().match(/已等 (\d+) 秒/);
  expect(match).toBeTruthy();
  return Number(match![1]);
}

describe("思考区等待句跟真实阶段对齐", () => {
  it("received：拆题句在标题、秒数在旁边；推进时间只改秒数，不换成核对句", () => {
    vi.useFakeTimers();
    render(<ThinkingDisclosure snapshot={receivedOnly()} live />);
    expect(titleText()).toBe(SPLIT);
    expect(titleText()).not.toContain("已等");
    expect(document.querySelector("[data-gp-thinking-wait]")!.getAttribute("data-gp-thinking-wait")).toBe("splitting");
    const first = waitSeconds();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(titleText()).toBe(SPLIT);
    expect(titleText()).not.toContain(CHECK);
    expect(waitSeconds()).toBeGreaterThanOrEqual(first + 2);
    expect(document.querySelector("[data-gp-thinking-wait]")!.getAttribute("data-gp-thinking-wait")).toBe("splitting");
  });

  it("只有快照带上 checking 才换成核对句；秒数继续累加", () => {
    vi.useFakeTimers();
    const received = receivedOnly();
    const { rerender } = render(<ThinkingDisclosure snapshot={received} live />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(titleText()).toBe(SPLIT);
    const before = waitSeconds();

    rerender(<ThinkingDisclosure snapshot={{ ...received, preClaimWork: "checking" }} live />);
    expect(titleText()).toBe(CHECK);
    expect(titleText()).not.toContain(SPLIT);
    expect(titleText()).not.toContain("已等");
    expect(waitSeconds()).toBeGreaterThanOrEqual(before);
    expect(document.querySelector("[data-gp-thinking-wait]")!.getAttribute("data-gp-thinking-wait")).toBe("checking");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(titleText()).toBe(CHECK);
    expect(waitSeconds()).toBeGreaterThanOrEqual(before + 2);
  });

  it("命题出现后换成已拆出 N 个待查问题，不再写已等", () => {
    render(<ThinkingDisclosure snapshot={decomposedOnly()} live={false} />);
    expect(titleText()).toContain("已拆出 3 个待查问题");
    expect(titleText()).not.toContain("已等");
    expect(titleText()).not.toContain(SPLIT);
    expect(titleText()).not.toContain(CHECK);
    expect(document.querySelector("[data-gp-thinking-mode]")!.getAttribute("data-gp-thinking-mode")).toBe("split");
  });
});
