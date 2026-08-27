export { runAgentLoop, DEFAULT_MAX_TURNS, TERMINAL_TOOL } from "./runAgentLoop.js";
export { parseToolCalls, mergeToolCalls } from "./parseToolCalls.js";
export { createLoopTools, compactSearchResult, fetchPublicPage, parseTodos } from "./tools.js";
export { finalizeLoopReport } from "./gates.js";
export { runClaimLoop, INVESTIGATOR_AGENT, INVESTIGATOR_NAME } from "./runClaimLoop.js";
export { createLoopLlm, modelFromChoice } from "./loopLlm.js";
export { INVESTIGATOR_SYSTEM_PROMPT } from "./prompt.js";
export type {
  AgentLoopResult,
  LoopLlm,
  LoopMessage,
  LoopObserver,
  LoopTodo,
  LoopTool,
  LlmTurn,
  ToolCall,
} from "./types.js";

/** Feature flag: env AGENT_LOOP=1 or payload.execution="loop". Default off. */
export function wantsAgentLoop(payload: unknown, env: Record<string, string> = process.env as Record<string, string>): boolean {
  const raw = (env.AGENT_LOOP ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (!payload || typeof payload !== "object") return false;
  const rec = payload as Record<string, unknown>;
  if (rec.execution === "loop" || rec.agentLoop === true) return true;
  if (typeof rec.execution === "string" && rec.execution.trim().toLowerCase() === "loop") return true;
  return false;
}
