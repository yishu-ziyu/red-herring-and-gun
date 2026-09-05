import { afterEach, expect, it, vi } from "vitest";
import { createKnowledgeBase } from "./knowledgeBase";
import type { KnowledgeBaseEntry } from "./schemas";

const entry: KnowledgeBaseEntry = { id: "one", claim: "原句", rumorType: "健康", diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" }, finalReport: { conclusion: "旧回答" }, handoffSteps: [], credibilityScore: 50, timestamp: 1, tags: [] };
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
it("isolates anonymous, accounts and unowned legacy history", async () => {
  await createKnowledgeBase().saveCase(entry);
  expect(await createKnowledgeBase("alice").listCases()).toEqual([]);
  expect(await createKnowledgeBase(null).listCases()).toEqual([]);
  await createKnowledgeBase("alice").saveCase(entry);
  expect(await createKnowledgeBase("bob").findSimilarCases("原句")).toEqual([]);
  expect(await createKnowledgeBase("alice").getCase("one")).toEqual(entry);
  expect(localStorage.getItem("red-herring-knowledge-cases")).not.toBeNull();
});
it("rejects failed persistence so the caller can notify the user", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(createKnowledgeBase(null).saveCase(entry)).rejects.toThrow();
});
it("handles a blocked localStorage getter without rejecting history reads", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  await expect(createKnowledgeBase(null).listCases()).resolves.toEqual([]);
  await expect(createKnowledgeBase(null).saveCase(entry)).rejects.toThrow();
});
