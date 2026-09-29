import { expect, it } from "vitest";
import { buildAgentInput } from "./agentConfigs.js";

it("报告只读正式判断，旧调查步骤与搜索摘要不进入写作输入", () => {
  const judgment = { verdictType: "false", subclaimVerdicts: [{ claimAtom: "命题", verdict: "false" }], verifiedQuotes: [{ quote: "原文反驳" }] };
  const input = buildAgentInput("report_composer", "命题", [
    { agent: "fact_checker", output: { factCheckResult: "true", keyFindings: ["旧的错误判断"] } },
    { agent: "formal_judgment", output: judgment },
  ]);
  expect(input.judgment).toEqual(judgment);
  expect(JSON.stringify(input)).not.toContain("旧的错误判断");
  expect(input).not.toHaveProperty("factCheck");
});
