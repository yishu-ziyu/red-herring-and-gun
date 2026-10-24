/**
 * 调查流（POST /api/agent/orchestrate-stream）的 SSE 适配：开流 → 补发已有事件 → 订阅运行事件 → 执行结束后收流。
 *
 * 断开连接不是取消：run 属于它的 runId，用户离开页面后照常跑完，结论经刷新接回取回。
 */
import { runInvestigation, type InvestigationRequest, type InvestigationRunDeps } from "../lib/run/investigation.js";
import { toPublicStreamEvent } from "./publicStream.js";
import { createSseWriter } from "./sseChannel.js";

export async function streamInvestigation(deps: InvestigationRunDeps, request: InvestigationRequest, res: any): Promise<void> {
  const { runs } = deps;
  const { runId } = request.run;
  let writer: ReturnType<typeof createSseWriter> | undefined;
  if (!res.writableEnded && !res.destroyed) {
    try { writer = createSseWriter(res); }
    catch (error) { console.warn("[sse] initial connection unavailable", error); }
  }
  const unsubscribe = writer ? runs.subscribe(runId, event => { void writer?.send(toPublicStreamEvent(event)); }) : () => {};
  writer?.onClose(unsubscribe);
  try {
    // A just-created run has only its acceptance events.
    if (writer) for (const event of runs.replayEvents(runId, 0, 128)) void writer.send(toPublicStreamEvent(event));
  } catch (error) {
    console.error(`[sse] could not replay acceptance events runId=${runId}`, error);
    writer?.close();
  }
  try {
    await runInvestigation(deps, request);
  } finally {
    unsubscribe();
    writer?.finish();
  }
}
