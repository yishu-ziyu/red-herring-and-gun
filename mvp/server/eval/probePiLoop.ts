/**
 * Probe: pi 驱动 Agent Loop 端到端（P1）。真实模型：
 * claim → pi 会话（web_search/todo_write/submit_verdict）→ finalizeLoopReport 收束。
 * 验证：模型真的调度检索、提交草稿、判决纪律（URL 闸/自证）在循环里生效。
 * 用法：cd mvp/server && npx tsx eval/probePiLoop.ts
 */
import { runClaimLoopPi } from "../src/lib/agentLoop/runClaimLoopPi.js";
import { piProviderConfigs } from "../src/lib/piBridge/piModels.js";
import { loadLocalEnv } from "./localEnv.js";

loadLocalEnv();
const env = process.env as Record<string, string>;

if (piProviderConfigs(env).length === 0) {
  console.log("SKIP: 无可用模型 key");
  process.exit(0);
}

console.log("=== P1: pi 循环端到端 ===\n");
const started = Date.now();
const { finalReport, todos, stopReason, turns } = await runClaimLoopPi({
  claim: "常喝牛奶会致癌",
  env,
  maxToolCalls: 24,
  onEvent: (ev) => {
    const t = ev as { type: string; toolName?: string; content?: string };
    if (t.type === "tool_start") console.log(`[tool_start] ${t.toolName}`);
    if (t.type === "agent_thought" && t.content) {
      const c = t.content.trim();
      if (c) process.stdout.write(c);
    }
  },
});

console.log(`\n\n=== 结果 ===`);
console.log("耗时(ms):", Date.now() - started);
console.log("stopReason:", stopReason, "| turns:", turns);
console.log("todos:", todos.map((t) => t.label).join("; "));
console.log("verdictType:", finalReport.verdictType, "| score:", finalReport.credibilityScore);
console.log("conclusion:", (finalReport.conclusion || "").slice(0, 120));
console.log("_execution:", finalReport._execution);
const sources = finalReport.citationSources as Array<{ url: string }> | undefined;
console.log("citationSources:", (sources ?? []).length, "条");
const ok = stopReason === "submit_verdict" && (sources ?? []).length > 0;
console.log(ok ? "P1_PROBE_PASS" : "P1_PROBE_FAIL(可能模型没走 submit_verdict)");
process.exit(ok ? 0 : 1);