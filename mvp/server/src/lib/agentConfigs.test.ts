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
import { AGENT_CONFIGS, getAgentConfig, buildAgentInput, mergeSubclaimVerdicts } from "./agentConfigs";

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

describe("subclaimVerdicts / claimAtoms 数据契约", () => {
  it("rumor_detector schema 应含 claimAtoms（string[]）并在 required 中", () => {
    const schema = getAgentConfig("rumor_detector")!.responseSchema as any;
    expect(schema.properties.claimAtoms).toEqual({ type: "array", items: { type: "string" } });
    expect(schema.required).toContain("claimAtoms");
  });

  it("fact_checker schema 应含 subclaimVerdicts（五值 verdict + 四字段 required）", () => {
    const schema = getAgentConfig("fact_checker")!.responseSchema as any;
    expect(schema.required).toContain("subclaimVerdicts");
    const item = schema.properties.subclaimVerdicts.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.verdict.enum).toEqual(["true", "false", "partial", "unverified", "exaggerated"]);
    expect(item.required).toEqual(["claimAtom", "verdict", "evidence", "boundary"]);
  });

  it("report_composer schema 应含 subclaimVerdicts 并在 required 中", () => {
    const schema = getAgentConfig("report_composer")!.responseSchema as any;
    expect(schema.properties.subclaimVerdicts).toBeDefined();
    expect(schema.required).toContain("subclaimVerdicts");
  });

  it("mergeSubclaimVerdicts：覆盖不全补 unverified + 幻觉拦截 + 非法 verdict 回退", () => {
    const claimAtoms = ["原子A", "原子B", "原子C"];
    const verdicts = [
      { claimAtom: "原子A", verdict: "true", evidence: "证据A", boundary: "边界A" },
      { claimAtom: "编造原子", verdict: "false", evidence: "幻觉", boundary: "幻觉" }, // 幻觉拦截
      { claimAtom: "原子B", verdict: "非法值", evidence: "证据B", boundary: "边界B" }, // 非法回退
    ];
    const result = mergeSubclaimVerdicts(claimAtoms, verdicts);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.claimAtom)).toEqual(["原子A", "原子B", "原子C"]);
    expect(result.find((r) => r.claimAtom === "原子A")?.verdict).toBe("true");
    expect(result.find((r) => r.claimAtom === "原子B")?.verdict).toBe("unverified");
    expect(result.find((r) => r.claimAtom === "原子C")).toEqual({
      claimAtom: "原子C",
      verdict: "unverified",
      evidence: "",
      boundary: "模型未覆盖，待补证",
    });
    expect(result.some((r) => r.claimAtom === "编造原子")).toBe(false);
  });

  it("mergeSubclaimVerdicts：claimAtoms 为空时返回空数组", () => {
    expect(mergeSubclaimVerdicts(undefined, [{ claimAtom: "X", verdict: "true" }])).toEqual([]);
  });

  it("buildAgentInput：fact_checker 透传 claimAtoms，report_composer 透传 merge 后的 subclaimVerdicts", () => {
    const previousSteps = [
      {
        agent: "rumor_detector",
        output: { claimAtoms: ["原子A", "原子B"] },
      },
      {
        agent: "fact_checker",
        output: {
          subclaimVerdicts: [{ claimAtom: "原子A", verdict: "false", evidence: "E", boundary: "B" }],
        },
      },
    ] as any;

    const fcInput = buildAgentInput("fact_checker", "claim", previousSteps);
    expect(fcInput.claimAtoms).toEqual(["原子A", "原子B"]);

    const rcInput = buildAgentInput("report_composer", "claim", previousSteps);
    const factCheck = rcInput.factCheck as any;
    expect(factCheck.subclaimVerdicts).toHaveLength(2);
    expect(factCheck.subclaimVerdicts.find((r: any) => r.claimAtom === "原子A").verdict).toBe("false");
    expect(factCheck.subclaimVerdicts.find((r: any) => r.claimAtom === "原子B").verdict).toBe("unverified");
  });
});