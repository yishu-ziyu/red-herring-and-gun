/**
 * deepagents-poc/run.ts
 *
 * Entry point: runs the RumorDetector React Agent with a sample claim
 * and prints the full trace to demonstrate the React Agent loop.
 *
 * Usage:
 *   npx tsx run.ts
 */

import { runRumorDetector } from "./rumorDetectorAgent";

const SAMPLE_CLAIM = "震惊！科学家发现某常见食物中的成分会直接导致癌症，仅需一次食用即可诱发细胞突变";

async function main() {
  console.log("=".repeat(60));
  console.log("红鲱鱼与枪 — React Agent PoC");
  console.log("Agent: RumorDetector (谣言特征检测)");
  console.log("=".repeat(60));
  console.log();

  const result = await runRumorDetector({
    claim: SAMPLE_CLAIM,
    onStepComplete(step) {
      console.log(`\n[step ${step}] React Agent loop iteration complete`);
    },
  });

  // Print the trace
  console.log("\n" + "-".repeat(60));
  console.log("REACT AGENT TRACE");
  console.log("-".repeat(60));
  for (const entry of result.trace) {
    switch (entry.type) {
      case "llm":
        console.log(`\n  Step ${entry.step}: LLM response`);
        console.log(`    Content: ${(entry.detail.content as string)?.slice(0, 120)}...`);
        break;
      case "tool_call":
        console.log(`\n  Step ${entry.step}: Tool calls`);
        const calls = entry.detail.toolCalls as { name: string; arguments: Record<string, string> }[];
        for (const call of calls) {
          console.log(`    -> ${call.name}(${JSON.stringify(call.arguments)})`);
        }
        break;
      case "tool_result":
        console.log(`\n  Step ${entry.step}: Tool results`);
        console.log(`    <- ${(entry.detail.result as { answerPreview?: string })?.answerPreview ?? JSON.stringify(entry.detail.result)?.slice(0, 100)}`);
        break;
      case "final":
        console.log(`\n  Step ${entry.step}: FINAL OUTPUT`);
        console.log(JSON.stringify(entry.detail.output, null, 2));
        break;
    }
  }

  // Print structured output
  console.log("\n" + "-".repeat(60));
  console.log("STRUCTURED OUTPUT");
  console.log("-".repeat(60));
  const output = result.output;
  console.log(`  Severity:        ${output.severity}`);
  console.log(`  Claim Atoms:     ${output.claimAtoms.join(", ")}`);
  console.log(`  Rumor Types:     ${output.rumorTypes.join(", ")}`);
  console.log(`  Indicators:      ${output.rumorIndicators.join(", ")}`);
  console.log(`  Patterns:        ${output.detectedPatterns.join(", ")}`);
  console.log(`  Needed Evidence: ${output.neededEvidence.join(", ")}`);
  console.log(`  Handoff Targets: ${output.handoffTargets.join(", ")}`);
  console.log(`  Analysis:        ${output.analysis}`);
  console.log();

  console.log("=".repeat(60));
  console.log("PoC complete. The React Agent loop ran successfully.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("PoC failed:", err);
  process.exit(1);
});
