import { describe, expect, it } from "vitest";
import { appendInvestigationRound, readInvestigationThread, type InvestigationThread } from "./investigationThread";

const snapshot = {
  schemaVersion: 1 as const, originalClaim: "公交免费", phase: "complete" as const,
  claims: [], sources: [], conflicts: [], checkedAt: "2026-09-17T10:00:00Z",
};
const empty: InvestigationThread = { version: 1, id: "thread-1", originalClaim: "原文章", rounds: [] };

describe("investigation thread archives", () => {
  it("preserves prior snapshots and their dates across persistence and follow-ups", () => {
    const first = appendInvestigationRound(empty, { id: "r1", kind: "initial", question: "公交免费", snapshot });
    const second = appendInvestigationRound(first, { id: "r2", kind: "follow-up", question: "所有线路吗", snapshot: { ...snapshot, checkedAt: "2026-09-17T11:00:00Z" } });
    expect(first.rounds).toHaveLength(1);
    expect(second.rounds[0].snapshot.checkedAt).toBe("2026-09-17T10:00:00Z");
    expect(readInvestigationThread(JSON.parse(JSON.stringify({ investigationThread: second })))).toEqual(second);
    expect(appendInvestigationRound(second, { ...second.rounds[0], snapshot: { ...snapshot, checkedAt: "new date" } })).toBe(second);
  });
  it("rejects malformed or running history without fabricating a replacement", () => {
    expect(readInvestigationThread({})).toBeUndefined();
    expect(readInvestigationThread({ investigationThread: { ...empty, rounds: [{}] } })).toBeUndefined();
    expect(() => appendInvestigationRound(empty, { id: "r1", kind: "initial", question: "q", snapshot: { ...snapshot, phase: "investigating" } })).toThrow();
  });
  it("does not carry arbitrary report fields or recursive history into a round", () => {
    const round = { id: "r1", kind: "initial", question: "q", snapshot, report: { privatePrompt: "secret", investigationThread: empty } };
    const parsed = readInvestigationThread({ investigationThread: { ...empty, rounds: [round] } });
    expect(parsed?.rounds[0]).not.toHaveProperty("report");
  });
});
