/**
 * compareEngines.ts — 双引擎同案对比（P1 工具）。
 * 对同一 claim 跑 pi 循环引擎；再打现网 default 引擎（/api/agent/orchestrate，casePipeline）。
 * 输出两引擎的 verdict/score/conclusion/来源数对比卡。
 * 用法：起 server 后：cd mvp/server && npx tsx eval/compareEngines.ts "常喝牛奶会致癌"
 */
import { loadLocalEnv } from "./localEnv.js";

loadLocalEnv();
const claim = process.argv[2] || "常喝牛奶会致癌";
const api = `http://127.0.0.1:${process.env.PORT || 3000}`;

const piResult = await (async () => {
  const { runClaimLoopPi } = await import("../src/lib/agentLoop/runClaimLoopPi.js");
  const env = process.env as Record<string, string>;
  const { finalReport, stopReason, turns } = await runClaimLoopPi({ claim, env, maxToolCalls: 20 });
  return { engine: "pi-agent", stopReason, turns, verdictType: finalReport.verdictType, score: finalReport.credibilityScore, conclusion: finalReport.conclusion, sources: (finalReport.citationSources ?? []).length };
})();

const pipelineResult = await (async () => {
  try {
    const res = await fetch(`${api}/api/agent/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, modelChoice: {} }),
    });
    const data = await res.json();
    return { engine: "casePipeline", stopReason: "pipeline", turns: 0, verdictType: data.finalReport?.verdictType, score: data.finalReport?.credibilityScore, conclusion: data.finalReport?.conclusion, sources: (data.finalReport?.citationSources ?? []).length };
  } catch (e) {
    return { engine: "casePipeline", stopReason: String(e), turns: 0, verdictType: "?", score: undefined, conclusion: "HTTP 不可达（是否已起 server？ npm run dev:api）", sources: 0 };
  }
})();

const print = (r: typeof piResult | typeof pipelineResult) => {
  console.log(`\n== ${r.engine} ==`);
  console.log(`verdict: ${r.verdictType} | score: ${r.score} | sources: ${r.sources}`);
  console.log(`stopReason: ${r.stopReason} | turns: ${r.turns}`);
  console.log(`conclusion: ${String(r.conclusion).slice(0, 100)}`);
};
print(piResult);
print(pipelineResult);
console.log(`\n对比：pi=${piResult.verdictType}/${piResult.score} vs pipeline=${pipelineResult.verdictType}/${pipelineResult.score}`);