/** Fixed offline checks against the production pipeline and final verdict. No model calls. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apps = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = "server/src/lib/casePipeline/";
const cases = [
  [pipeline + "finalizeReport.verdict.test.ts", "立场型部分只作边界：主要主张有据成立时整句能信，正文写明立场句不计入"],
  [pipeline + "finalizeReport.verdict.test.ts", "辟谣走正常路径才算数：模型逐条判了站不住并给了反驳出处 → 不能信"],
  [pipeline + "finalizeReport.verdict.test.ts", "原子级守门：整句 false 漂移，但并列主张有据之真 + 有据之假 → 有真有假，不写整句 false"],
  [pipeline + "finalizeReport.verdict.test.ts", "有争议：verdictType、faceVerdict、结论首句、摘要、快照徽章一致"],
  [pipeline + "finalizeReport.verdict.test.ts", "来源明确反驳了原句里的数字，并逐字引出：仍是部分成立"],
  [pipeline + "finalizeReport.verdict.test.ts", "来源探活：唯一支撑的链接死了，硬 true 不能留下"],
  [pipeline + "archiveEvidence.test.ts", "does not let an old summary block a newer archive body or web search"],
  [pipeline + "archiveEvidence.test.ts", "does not skip search for a high-scoring name substitution"],
  [pipeline + "archiveEvidence.test.ts", "uses the real pipeline: a false model quote cannot publish a hard verdict, while a saved body survives a dead URL"],
  [pipeline + "runCasePipeline.test.ts", "evidence loop：两轮零新增 → 判停且不重跑 fact_checker"],
  ["server/src/lib/caseHandlers.investigation.test.ts", "旧报告（无 investigation 字段）确定性重建为 complete"],
  ["server/src/lib/shareHandlers.test.ts", "分享本轮不带出前轮私人调查，保留本轮范围说明"],
];

const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = cases.map(([, name]) => name);
const pattern = `(?:${names.map(escape).join("|")})$`;
const dir = mkdtempSync(join(tmpdir(), "rhg-contract-gate-"));
const report = join(dir, "results.json");

console.log("离线生产行为合同检查：12 个固定场景；不调用真实模型，不代表真实模型质量。");
try {
  const run = spawnSync(process.execPath, [
    join(apps, "node_modules/vitest/vitest.mjs"), "run",
    ...new Set(cases.map(([file]) => file)),
    "--testNamePattern", pattern, "--reporter=json", `--outputFile=${report}`,
  ], { cwd: apps, encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout || `Vitest 退出码 ${run.status}`);
    process.exitCode = run.status || 1;
  } else {
    const result = JSON.parse(readFileSync(report, "utf8"));
    const passed = result.testResults.flatMap((file) => file.assertionResults)
      .filter((test) => test.status === "passed").map((test) => test.fullName);
    const missing = names.filter((name) => !passed.some((fullName) => fullName.endsWith(name)));
    if (passed.length !== cases.length || missing.length) {
      console.error(`合同检查未跑齐：预期 ${cases.length}，通过 ${passed.length}；缺失 ${missing.join("、")}`);
      process.exitCode = 1;
    } else {
      console.log(`离线生产行为合同通过：${passed.length}/${cases.length}。真实模型质量仍需 npm run eval:live。`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
