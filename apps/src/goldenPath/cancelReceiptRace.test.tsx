import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useInvestigationRun } from "./useInvestigationRun";
import { cancelInvestigation } from "../lib/investigationResume";
import { requestOrchestrateStream } from "../lib/agentExpansion";

vi.mock("../lib/agentExpansion", async (original) => ({
  ...await original<typeof import("../lib/agentExpansion")>(), requestOrchestrateStream: vi.fn(),
}));
vi.mock("../lib/investigationResume", async (original) => ({
  ...await original<typeof import("../lib/investigationResume")>(), cancelInvestigation: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); localStorage.clear(); });

it("SSE 已确认 cancelled，迟到的 cancelling HTTP 回执不能倒退状态", async () => {
  let releaseStream!: () => void;
  let releaseReceipt!: (result: Awaited<ReturnType<typeof cancelInvestigation>>) => void;
  const streamGate = new Promise<void>((resolve) => { releaseStream = resolve; });
  const receiptGate = new Promise<Awaited<ReturnType<typeof cancelInvestigation>>>((resolve) => { releaseReceipt = resolve; });
  vi.mocked(requestOrchestrateStream).mockImplementation(async function* () {
    yield { type: "run_started", runId: "race-run", caseId: "race-case" };
    await streamGate;
    yield { type: "run_state", status: "cancelled", terminal: true };
  });
  vi.mocked(cancelInvestigation).mockReturnValue(receiptGate);
  const { result } = renderHook(() => useInvestigationRun());
  act(() => { result.current.start({ text: "测试说法", links: [], images: [], createdAt: Date.now() }); });
  await waitFor(() => expect(result.current.state.runId).toBe("race-run"));
  let cancelling!: ReturnType<typeof result.current.cancel>;
  act(() => { cancelling = result.current.cancel(); });
  await act(async () => { releaseStream(); });
  await waitFor(() => expect(result.current.state.stop).toBe("stopped"));
  await act(async () => { releaseReceipt({ ok: true, status: "cancelling" }); await cancelling; });
  expect(result.current.state.stop).toBe("stopped");
  expect(result.current.state.serverStatus).toBe("cancelled");
  expect(result.current.state.connection).toBe("ended");
});
