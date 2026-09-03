import { assertInvariants, replay, validateEvent, type CaseEvent } from '@rhg/core/casefile';
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, FIXTURES } from "./catalog.js";

describe("fixtures", () => {
  it("5 份 fixture 每个事件过 validateEvent，replay 过 assertInvariants", () => {
    expect(FIXTURE_NAMES).toHaveLength(5);
    for (const name of FIXTURE_NAMES) {
      const fixture = FIXTURES[name];
      expect(fixture?.name).toBe(name);
      expect(fixture?.events.length).toBeGreaterThan(0);
      for (const event of fixture!.events) {
        expect(() => validateEvent(event)).not.toThrow();
      }
      const folded = replay(fixture!.events as CaseEvent[]);
      expect(() => assertInvariants(folded)).not.toThrow();
    }
  });

  it("contested 有 contested 判决且有 prosecutor 与 defender 的 investigator.step", () => {
    const fixture = FIXTURES.contested!;
    const folded = replay(fixture.events as CaseEvent[]);
    expect(folded.verdicts.some((row) => row.verdict === "contested") || folded.overall?.contested === true).toBe(
      true,
    );
    const roles = fixture.events
      .filter((event) => event.type === "investigator.step")
      .map((event) => (event.type === "investigator.step" ? event.role : ""));
    expect(roles).toContain("prosecutor");
    expect(roles).toContain("defender");
  });

  it("followup 有两条 turn.started 且第二条用户消息 route 是 pursue_frontier", () => {
    const fixture = FIXTURES.followup!;
    const started = fixture.events.filter((event) => event.type === "turn.started");
    expect(started.length).toBeGreaterThanOrEqual(2);
    const users = fixture.events.filter(
      (event) => event.type === "message.added" && event.message.role === "user",
    );
    expect(users.length).toBeGreaterThanOrEqual(2);
    const second = users[1];
    expect(second?.type === "message.added" && second.message.route).toBe("pursue_frontier");
  });
});
