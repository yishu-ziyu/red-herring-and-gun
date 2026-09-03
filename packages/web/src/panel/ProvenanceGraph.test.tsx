import type { Case, Evidence } from '@rhg/core/casefile';
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GRAPH_SECTION } from "../lib/copy.js";
import { ProvenanceGraph } from "./ProvenanceGraph.js";

const AT = "2026-09-03T12:00:00.000Z";

function evidence(id: string): Evidence {
  return {
    id,
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    host: "example.com",
    excerpt: id,
    retrievedAt: AT,
    tier: "A",
    provenance: { kind: "user" },
  };
}

function blank(over: Partial<Case>): Case {
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

beforeAll(() => {
  class FakeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FakeObserver;
});

afterEach(() => {
  cleanup();
});

describe("ProvenanceGraph", () => {
  it("cites 为空时返回 null，DOM 没有区块标题", () => {
    const { container } = render(
      <ProvenanceGraph current={blank({ evidence: [evidence("e1")] })} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(GRAPH_SECTION)).toBeNull();
  });

  it("有边时节点数等于引用证据 ∪ 被引证据", () => {
    const current = blank({
      evidence: [evidence("e1"), evidence("e2"), evidence("e3")],
      cites: [
        { from: "e1", to: "e2" },
        { from: "e3", to: "e2" },
      ],
      report: {
        conclusion: "x",
        claimItems: [],
        citations: [{ n: 1, evidenceId: "e1" }],
        finalizedAt: AT,
      },
    });
    const { container } = render(<ProvenanceGraph current={current} />);
    expect(screen.getByText(GRAPH_SECTION)).toBeTruthy();
    expect(container.querySelector(".graph-host")?.getAttribute("data-node-count")).toBe("2");
  });
});
