/**
 * agentConfigs.test.ts — 验证 Plan P0-1 的 Grounding 硬约束已注入 prompt
 *
 * 目的：保证 FactChecker / SourceValidator 的 systemPrompt 必须包含关键措辞，
 * 否则 AI Agent 会退回到「猜测 + 编造」模式，破坏产品可信度护城河。
 *
 * 锁定关键词：
 *   - FactChecker：必须含「同行评审」「至少 1 条反对意见」「暂无可靠证据」
 *   - SourceValidator：必须含「同行评审」「暂无可靠证据支持这一说法」「verifiedSources」
 */

import { describe, expect, it } from "vitest";
import { AGENT_CONFIGS, getAgentConfig } from "./agentConfigs";

const REQUIRED_PATTERNS_FACT_CHECKER = [
  /同行评审/,
  /至少 1 条反对意见|至少 1 条反证/,
  /暂无可靠证据/,
  /counterEvidence/,
];

const REQUIRED_PATTERNS_SOURCE_VALIDATOR = [
  /同行评审/,
  /暂无可靠证据支持这一说法/,
  /verifiedSources/,
  /questionableSources/,
];

describe("AGENT_CONFIGS · P0-1 Grounding 硬约束", () => {
  it("应暴露 4 个 Agent 配置（rumor_detector/fact_checker/source_validator/report_composer）", () => {
    expect(AGENT_CONFIGS.map((a) => a.id)).toEqual([
      "rumor_detector",
      "fact_checker",
      "source_validator",
      "report_composer",
    ]);
  });

  it("FactChecker prompt 应包含 grounding 硬约束关键词", () => {
    const cfg = getAgentConfig("fact_checker");
    expect(cfg).toBeDefined();
    for (const pattern of REQUIRED_PATTERNS_FACT_CHECKER) {
      expect(cfg!.systemPrompt).toMatch(pattern);
    }
  });

  it("SourceValidator prompt 应包含 grounding 硬约束关键词", () => {
    const cfg = getAgentConfig("source_validator");
    expect(cfg).toBeDefined();
    for (const pattern of REQUIRED_PATTERNS_SOURCE_VALIDATOR) {
      expect(cfg!.systemPrompt).toMatch(pattern);
    }
  });

  it("两个 Agent prompt 都应包含禁止编造的硬约束（来源/日期/专家名）", () => {
    const fc = getAgentConfig("fact_checker")!.systemPrompt;
    const sv = getAgentConfig("source_validator")!.systemPrompt;
    expect(fc).toMatch(/禁止.*编造|不得编造/);
    expect(sv).toMatch(/禁止.*编造|不得编造/);
  });

  it("Grounding 块应在 factCheckResult / sourceReliability 判定标准之后", () => {
    const fc = getAgentConfig("fact_checker")!.systemPrompt;
    const sv = getAgentConfig("source_validator")!.systemPrompt;
    const fcGroundIdx = fc.indexOf("Grounding 硬约束");
    const fcFactIdx = fc.indexOf("factCheckResult 判定标准");
    const svGroundIdx = sv.indexOf("Grounding 硬约束");
    const svSourceIdx = sv.indexOf("sourceReliability 判定标准");
    expect(fcGroundIdx).toBeGreaterThan(fcFactIdx);
    expect(svGroundIdx).toBeGreaterThan(svSourceIdx);
  });
});