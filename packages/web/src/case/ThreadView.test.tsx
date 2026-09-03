import type { Case, Message } from '@rhg/core/casefile';
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MEMO_FOLLOW, MEMO_PURSUE, MEMO_USER, pursueText } from "../lib/copy.js";
import { ThreadView } from "./ThreadView.js";

const AT = "2026-09-03T12:00:00.000Z";

function message(over: Partial<Message> & Pick<Message, "id" | "role" | "text">): Message {
  return { at: AT, ...over };
}

function current(messages: Message[]): Case {
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
    messages,
    errors: [],
    droppedClaims: [],
  };
}

afterEach(() => {
  cleanup();
});

describe("ThreadView 用户消息标签", () => {
  it("首条原句、追问、追查，追查正文去掉前缀", () => {
    const chip = "gov.cn/zhengce";
    render(
      <ThreadView
        current={current([
          message({ id: "m1", role: "user", text: "人社部发文", route: "new_claim" }),
          message({ id: "m2", role: "user", text: "那单位怎么领", route: "ask_case" }),
          message({ id: "m3", role: "user", text: pursueText(chip), route: "pursue_frontier" }),
        ])}
        running={false}
        status="live"
        error={null}
        onSend={async () => undefined}
        onAbort={async () => undefined}
      />,
    );
    const labels = [...document.querySelectorAll(".bubble-meta")].map((node) => node.textContent);
    expect(labels).toEqual([MEMO_USER, MEMO_FOLLOW, MEMO_PURSUE]);
    const bodies = [...document.querySelectorAll(".memo-user > p:not(.bubble-meta)")].map((node) => node.textContent);
    expect(bodies[2]).toBe(chip);
    expect(bodies[2]?.startsWith("追查 ·")).toBe(false);
  });
});
