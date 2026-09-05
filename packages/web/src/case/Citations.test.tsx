import type { Case } from '@rhg/core/casefile';
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CitedText } from "./Citation.js";

const AT = "2026-09-03T12:00:00.000Z";
const URL = "https://www.gov.cn/zhengce/allowance";

function current(): Case {
  return {
    id: "c",
    text: "原句",
    createdAt: AT,
    seq: 1,
    claims: [],
    evidence: [
      {
        id: "e1",
        url: URL,
        canonicalUrl: URL,
        host: "gov.cn",
        title: "通报",
        excerpt: "官方通报此事不实",
        retrievedAt: AT,
        tier: "A",
        provenance: { kind: "user" },
      },
    ],
    stances: [
      {
        id: "s1",
        claimId: "c1",
        evidenceId: "e1",
        stance: "refutes",
        quote: "官方通报此事不实",
        confidence: 1,
        quoteFidelity: true,
        by: "main",
      },
    ],
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
    report: {
      conclusion: "原句站不住。[1]",
      claimItems: [],
      citations: [{ n: 1, evidenceId: "e1" }],
      finalizedAt: AT,
    },
  };
}

afterEach(() => {
  cleanup();
});

describe("Citations", () => {
  it("[n] 渲染为链接且指向证据 url", () => {
    render(<CitedText text="见[1]。" current={current()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toBe("[1]");
  });

  it("hover 与 focus 出现含标题 host 层级与引文的 popover", () => {
    render(<CitedText text="见[1]。" current={current()} />);
    const link = screen.getByRole("link");
    fireEvent.mouseEnter(link);
    const pop = screen.getByRole("tooltip");
    expect(pop.textContent).toContain("通报");
    expect(pop.textContent).toContain("gov.cn");
    expect(pop.textContent).toContain("A");
    expect(pop.textContent).toContain("官方通报此事不实");
    expect(pop.textContent).toContain("G");
    fireEvent.mouseLeave(link);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(link);
    expect(screen.getByRole("tooltip").textContent).toContain("gov.cn");
  });
});
