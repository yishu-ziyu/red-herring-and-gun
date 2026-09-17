import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { refutedComplete, REFUTED_CLAIM } from "./goldenPath/fixtures";
import { createKnowledgeBase } from "./lib/knowledgeBase";
import { readInvestigationThread } from "./lib/investigationThread";

const FIRST_DATE = "2026-09-17T10:00:00.000Z";
const SECOND_DATE = "2026-09-17T11:00:00.000Z";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const frame = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);

function installNetwork() {
  const posts: Record<string, unknown>[] = [];
  let second: ReadableStreamDefaultController<Uint8Array> | undefined;
  const first = { ...refutedComplete(), checkedAt: FIRST_DATE };
  const next = { ...refutedComplete(), checkedAt: SECOND_DATE };
  const finish = () => {
    second!.enqueue(frame({ type: "investigation_snapshot", investigation: next }));
    second!.enqueue(frame({ type: "complete", finalReport: { conclusion: next.conclusion?.directAnswer, investigation: next, checkedAt: SECOND_DATE } }));
    second!.enqueue(frame({ type: "run_state", status: "completed", terminal: true }));
    second!.close();
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/api/agent/orchestrate-stream")) {
      posts.push(JSON.parse(String(init?.body)));
      if (posts.length === 1) {
        const frames = [
          { type: "run_started", runId: "run-first" },
          { type: "investigation_snapshot", investigation: first },
          { type: "complete", finalReport: { conclusion: first.conclusion?.directAnswer, investigation: first, checkedAt: FIRST_DATE } },
          { type: "run_state", status: "completed", terminal: true },
        ];
        return new Response(frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
      }
      return new Response(new ReadableStream({ start(controller) {
        second = controller;
        controller.enqueue(frame({ type: "run_started", runId: "run-second" }));
        controller.enqueue(frame({ type: "investigation_snapshot", investigation: { ...next, phase: "investigating", conclusion: undefined, checkedAt: undefined } }));
      } }));
    }
    if (url.includes("/cancel")) {
      second!.enqueue(frame({ type: "investigation_snapshot", investigation: { ...next, phase: "interrupted", conclusion: undefined, checkedAt: undefined } }));
      second!.enqueue(frame({ type: "run_state", status: "cancelled", terminal: true }));
      second!.close();
      return json({ status: "cancelling", accepted: true });
    }
    if (url.includes("/api/models/health")) return json({ status: "available" });
    if (url.includes("/api/models/list")) return json({ models: [{ provider: "test", model: "test" }] });
    if (url.includes("/api/checks/quota")) return json({ remaining: 10, total: 10, used: 0, kind: "guest" });
    if (url.endsWith("/api/cases")) return json({ cases: [] });
    return json({ authenticated: false }, 401);
  });
  return { posts, finish, first };
}

async function start() {
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "要调查的说法" });
  input.textContent = REFUTED_CLAIM; fireEvent.input(input);
  const submit = screen.getByRole("button", { name: /开始调查/ });
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy());
  await waitFor(async () => expect((await createKnowledgeBase(null).listCases()).length).toBe(1));
}

async function followUp() {
  fireEvent.change(screen.getByPlaceholderText(/针对此结论追问/), { target: { value: "请进一步核查适用条件" } });
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
  await waitFor(() => expect(document.querySelector('[data-gp-phase="investigating"]')).toBeTruthy());
}

beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("方案二的默认使用路径", () => {
  it("reading makes no request; follow-up retains the first round; history restores both dates", async () => {
    const network = installNetwork(); await start();
    fireEvent.click(screen.getByRole("button", { name: "查看已有依据" }));
    expect(network.posts).toHaveLength(1);
    await followUp();
    expect(network.posts).toHaveLength(2);
    const navigation = screen.getByRole("navigation", { name: "调查轮次" });
    fireEvent.click(within(navigation).getByRole("button", { name: /首次核查/ }));
    expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "发送追问" })).toBeNull();
    expect(network.posts).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "返回当前轮次" }));
    network.finish();
    await waitFor(async () => {
      const entries = await createKnowledgeBase(null).listCases();
      expect(entries.some((entry) => readInvestigationThread(entry.finalReport)?.rounds.length === 2)).toBe(true);
    });
    cleanup(); render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /历史/ }));
    await waitFor(() => expect(document.querySelectorAll(".gp-history-item")).toHaveLength(1));
    fireEvent.click(document.querySelector(".gp-history-item")!);
    await screen.findByRole("navigation", { name: "调查轮次" });
    expect(network.posts).toHaveLength(2);
    const saved = (await createKnowledgeBase(null).listCases()).map((entry) => readInvestigationThread(entry.finalReport)).find((thread) => thread?.rounds.length === 2)!;
    expect(saved.rounds.map((round) => round.snapshot.checkedAt)).toEqual([FIRST_DATE, SECOND_DATE]);
  });

  it("stopping a follow-up preserves the first round and persists the interrupted round", async () => {
    const network = installNetwork(); await start(); await followUp();
    fireEvent.click(document.querySelector('[data-gp-stop]')!);
    await waitFor(() => expect(document.querySelector('[data-gp-stop-state="stopped"]')).toBeTruthy());
    fireEvent.click(within(screen.getByRole("navigation", { name: "调查轮次" })).getByRole("button", { name: /首次核查/ }));
    expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy();
    await waitFor(async () => {
      const threads = (await createKnowledgeBase(null).listCases()).map((entry) => readInvestigationThread(entry.finalReport));
      expect(threads.some((thread) => thread?.rounds[1]?.snapshot.phase === "interrupted")).toBe(true);
    });
    expect(network.posts).toHaveLength(2);
  });

  it("adjusting the focus stops the active round before starting the replacement question", async () => {
    const network = installNetwork(); await start(); await followUp();
    fireEvent.click(screen.getByRole("button", { name: "调整核查重点" }));
    fireEvent.change(screen.getByRole("textbox", { name: "你更想确认什么？" }), { target: { value: "请重点核对政策适用日期" } });
    expect(network.posts).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "停止本轮并调整" }));
    await waitFor(() => expect(network.posts).toHaveLength(3));
    expect(String(network.posts[2].claim)).toContain("请重点核对政策适用日期");
    expect(within(screen.getByRole("navigation", { name: "调查轮次" })).getAllByRole("button")).toHaveLength(3);
    network.finish();
    await waitFor(() => expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy());
  });

  it("refresh during a follow-up retains the thread and saves a snapshot-only completed replay", async () => {
    const network = installNetwork(); await start(); await followUp();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("rhg:active-run")!).thread.rounds).toHaveLength(1));
    cleanup(); network.finish();
    const originalFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/investigations/run-second/events")) {
        const events = [
          { type: "run_started", runId: "run-second" },
          { type: "investigation_snapshot", investigation: { ...refutedComplete(), checkedAt: SECOND_DATE } },
          { type: "run_state", status: "completed", terminal: true },
        ];
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
      }
      return originalFetch(input, init);
    });
    render(<App />);
    await screen.findByRole("navigation", { name: "调查轮次" });
    await waitFor(async () => {
      const entries = await createKnowledgeBase(null).listCases();
      expect(entries.some((entry) => readInvestigationThread(entry.finalReport)?.rounds.length === 2)).toBe(true);
    });
    expect(network.posts).toHaveLength(2);
  });
});
