import type { Case } from "@rhg/core/casefile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROCESS_FOLD } from "../lib/copy.js";
import { InstrumentStrip } from "./InstrumentStrip.js";

const AT = "2026-09-03T12:00:00.000Z";

function blank(over: Partial<Case> = {}): Case {
  return {
    id: "c",
    text: "原句",
    createdAt: AT,
    seq: 1,
    claims: [],
    evidence: [],
    stances: [],
    verdicts: [],
    cites: [],
    frontier: [],
    consumedPivotIds: [],
    investigatorSteps: [],
    investigatorStops: [],
    llmCalls: [],
    stages: [],
    turns: [],
    messages: [],
    errors: [],
    droppedClaims: [],
    ...over,
  };
}

function mockMatchMedia() {
  window.matchMedia = (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  });
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockMatchMedia();
});

describe("InstrumentStrip", () => {
  it("无步骤无检索时不渲染", () => {
    const { container } = render(<InstrumentStrip current={blank()} running={false} />);
    expect(container.querySelector(".instrument")).toBeNull();
  });

  it("检索中默认展开雷达", () => {
    render(
      <InstrumentStrip
        current={blank({
          stages: [{ stage: "retrieve", startedAt: AT, seq: 1 }],
        })}
        running
      />,
    );
    expect(screen.getByRole("button", { name: PROCESS_FOLD }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("search-radar")).toBeTruthy();
  });

  it("查完有步骤时默认收起", () => {
    render(
      <InstrumentStrip
        current={blank({
          investigatorSteps: [
            {
              n: 1,
              role: "main",
              goal: "找通报",
              gap: "",
              action: { kind: "search", target: "津贴" },
              why: "",
              result: "找到一条",
              gain: 1,
              seq: 1,
              at: AT,
            },
          ],
        })}
        running={false}
      />,
    );
    const fold = screen.getByRole("button");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/找通报/)).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/找通报/)).toBeTruthy();
  });

  it("步骤结果不出现证据 id", () => {
    render(
      <InstrumentStrip
        current={blank({
          investigatorSteps: [
            {
              n: 1,
              role: "main",
              goal: "核对时间锚点",
              gap: "",
              action: { kind: "search", target: "津贴" },
              why: "",
              result: "added e4",
              gain: 1,
              seq: 1,
              at: AT,
            },
          ],
        })}
        running={false}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/记下一条材料/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\be4\b/);
  });
});
