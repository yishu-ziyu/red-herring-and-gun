/**
 * Probe pi-agent 试点（P0a）：真实模型上跑一次溯源会话，验证
 * 1) 现网模型链注册进 pi ✅ 2) 业务工具 web_search 可被调用 ✅ 3) 事件流归一化 ✅
 * 用法：cd mvp/server && npx tsx eval/probePi.ts
 * 无 model key 时打印 SKIP 并以 0 退出（不假装成功）。
 */
import { createPiCheckSession } from "../src/lib/piBridge/piSession.js";
import { piProviderConfigs } from "../src/lib/piBridge/piModels.js";
import { loadLocalEnv } from "./localEnv.js";

loadLocalEnv();
const env = process.env as Record<string, string>;

const cfgs = piProviderConfigs(env);
if (cfgs.length === 0) {
  console.log("SKIP: 无可用模型 key（minimax/deepseek/stepfun）");
  process.exit(0);
}
console.log("已注册 provider:", cfgs.map((c) => c.id).join(", "));

const { session, model, events, dispose } = await createPiCheckSession({ env });
console.log("模型路径:", model);
session.subscribe((event: { type: string; [k: string]: unknown }) => {
  if (event.type === "message_update") {
    const inner = (event.assistantMessageEvent ?? {}) as { type?: string; toolCall?: { name?: string } };
    console.log(`[raw] message_update/${inner.type ?? "?"}${inner.toolCall?.name ? ` name=${inner.toolCall.name}` : ""}`);
  } else if (/tool_execution/.test(event.type)) {
    console.log(`[raw] ${event.type} name=${(event.toolName ?? event.name) ?? "?"}`);
  }
});

try {
  await session.prompt("用 web_search 检索这句话有没有官方出处：常吃黑木耳能降血脂。检索前先用 todo_write 记下证据缺口。");
  console.log("\n=== 事件流（前 24 条）===");
  const kinds = events.slice(0, 24);
  for (const ev of kinds) {
    if (ev.kind === "delta") process.stdout.write(ev.text);
    if (ev.kind === "tool_call") console.log(`\n[工具调用] ${ev.toolName}`);
    if (ev.kind === "tool_result") console.log(`[工具返回] ${ev.toolName}`);
    if (ev.kind === "done") console.log("\n[done] agent_settled / agent_end");
  }
  const toolCalls = events.filter((e) => e.kind === "tool_call").length;
  const toolResults = events.filter((e) => e.kind === "tool_result").length;
  const hasDone = events.some((e) => e.kind === "done");
  console.log(`\n=== 统计: tool_call=${toolCalls} tool_result=${toolResults} agent_settled=${hasDone} ===`);
  const ok = toolCalls >= 1 && toolResults >= 1 && hasDone;
  console.log(ok ? "P0A_PROBE_PASS" : "P0A_PROBE_FAIL");
  process.exit(ok ? 0 : 1);
} finally {
  dispose();
}