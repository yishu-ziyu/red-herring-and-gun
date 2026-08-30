/**
 * collectFeedbackGolden.ts — 用户纠错反馈 → eval golden 草稿（半自动）。
 * 读取 RHG_DATA_DIR/rhg-feedback.jsonl，把「claim + 用户异议」输出为 golden case 草稿，
 * 供人工复核后合入 mvp/server/eval/golden.ts。
 * 用法：cd mvp/server && npx tsx eval/collectFeedbackGolden.ts [--json]
 */
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnv } from "./localEnv.js";

loadLocalEnv();
const path = join(process.env.RHG_DATA_DIR || tmpdir(), "rhg-feedback.jsonl");
if (!existsSync(path)) {
  console.log("暂无反馈文件:", path);
  process.exit(0);
}
const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
const out = lines.map((line, index) => {
  try {
    const rec = JSON.parse(line);
    return `// #${index + 1} claim: ${rec.claim}\n// 用户异议: ${rec.reason}\n// verdictType=${rec.verdictType ?? "?"} score=${rec.score ?? "?"} → 人工复核后：属于「误判翻案」还是「边界补强」？`;
  } catch {
    return `// 第 ${index + 1} 行非 JSON，跳过`;
  }
});
console.log(`反馈条目: ${lines.length}\n`);
console.log(out.join("\n\n"));