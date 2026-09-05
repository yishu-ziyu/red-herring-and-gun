import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReasoningProvider, useReasoning } from "./reasoningStore";

let memory: ReturnType<typeof useReasoning>;
function Probe() { memory = useReasoning(); return null; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const comment = { id: "c", nodeId: "n", text: "私人评论", createdAt: 1 };
const followUp = { id: "f", nodeId: "n", text: "私人追加", timestamp: 1 };

it("isolates account and anonymous memory, suspends unresolved identity, and preserves same-scope reset", () => {
  localStorage.setItem("reasoning-v3-comments", JSON.stringify([comment]));
  localStorage.setItem("reasoning-v3-followups", JSON.stringify([followUp]));
  render(<ReasoningProvider><Probe /></ReasoningProvider>);
  expect(memory.state.comments).toEqual([]);
  act(() => memory.setMemoryScope("alice@example.com"));
  act(() => {
    memory.dispatch({ type: "ADD_COMMENT", payload: comment });
    memory.dispatch({ type: "ADD_FOLLOW_UP", payload: followUp });
  });
  act(() => memory.dispatch({ type: "RESET" }));
  expect(memory.state.comments).toEqual([comment]);
  act(() => memory.setMemoryScope(undefined));
  act(() => memory.dispatch({ type: "ADD_COMMENT", payload: comment }));
  expect(memory.state.comments).toEqual([]);
  expect(memory.state.followUps).toEqual([]);
  act(() => memory.setMemoryScope(null));
  expect(memory.state.comments).toEqual([]);
  act(() => memory.setMemoryScope("bob@example.com"));
  expect(memory.state.followUps).toEqual([]);
  act(() => memory.setMemoryScope("alice@example.com"));
  expect(memory.state.comments).toEqual([comment]);
  expect(memory.state.followUps).toEqual([followUp]);
  expect(localStorage.getItem("reasoning-v3-comments")).toBe(JSON.stringify([comment]));
  expect(localStorage.getItem("reasoning-v3-followups")).toBe(JSON.stringify([followUp]));
});

it("survives denied storage access without reading or writing while identity is unresolved", () => {
  const getStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
  render(<ReasoningProvider><Probe /></ReasoningProvider>);
  expect(getStorage).not.toHaveBeenCalled();
  act(() => memory.setMemoryScope(null));
  expect(memory.memoryNotice).toContain("读取失败");
  act(() => memory.dispatch({ type: "ADD_COMMENT", payload: comment }));
  expect(memory.state.comments).toEqual([comment]);
  expect(memory.memoryNotice).toContain("保存失败");
});

it("does not overwrite unreadable stored memory during hydration or reset", () => {
  localStorage.setItem("reasoning-v3-comments:v2:anonymous", "broken-json");
  const write = vi.spyOn(Storage.prototype, "setItem");
  render(<ReasoningProvider><Probe /></ReasoningProvider>);
  act(() => memory.setMemoryScope(null));
  act(() => memory.dispatch({ type: "RESET" }));
  expect(memory.memoryNotice).toContain("读取失败");
  expect(write).not.toHaveBeenCalled();
  expect(localStorage.getItem("reasoning-v3-comments:v2:anonymous")).toBe("broken-json");
});

it("keeps edits usable and warns when setItem fails", () => {
  render(<ReasoningProvider><Probe /></ReasoningProvider>);
  act(() => memory.setMemoryScope(null));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  act(() => memory.dispatch({ type: "ADD_FOLLOW_UP", payload: followUp }));
  expect(memory.state.followUps).toEqual([followUp]);
  expect(memory.memoryNotice).toContain("保存失败");
});
