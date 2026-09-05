import { expect, it } from "vitest";
import { buildAgentInput } from "./agentConfigs";

it("报告消费最新主调查，主调查接收实际质询", () => {
  const steps = [
    { agent: "fact_checker", output: { factCheckResult: "true" } },
    { agent: "cross_examiner", output: { atoms: [{ atom: "命题", challenge: "原文适用范围？" }] } },
    { agent: "fact_checker", output: { factCheckResult: "false" } },
  ];
  expect(buildAgentInput("report_composer", "命题", steps).factCheck).toMatchObject({ result: "false" });
  expect(buildAgentInput("fact_checker", "命题", steps).crossExam).toEqual(steps[1].output);
});
