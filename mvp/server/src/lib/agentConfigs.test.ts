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
      supportingSources: [],
      contradictingSources: [],
      evidenceGaps: [],
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

describe("判定可追溯 · per-verdict 结构化来源", () => {
  it("fact_checker schema 的 subclaimVerdicts item 应含三个新字段的 properties，且不在 required 中", () => {
    const schema = getAgentConfig("fact_checker")!.responseSchema as any;
    const item = schema.properties.subclaimVerdicts.items;
    expect(item.properties.supportingSources).toBeDefined();
    expect(item.properties.contradictingSources).toBeDefined();
    expect(item.properties.evidenceGaps).toBeDefined();
    expect(item.properties.supportingSources.items).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { url: { type: "string" }, title: { type: "string" }, snippet: { type: "string" } },
      required: ["url", "title", "snippet"],
    });
    expect(item.required).not.toContain("supportingSources");
    expect(item.required).not.toContain("contradictingSources");
    expect(item.required).not.toContain("evidenceGaps");
  });

  it("report_composer schema 的 subclaimVerdicts item 同样含三个新字段 structures", () => {
    const schema = getAgentConfig("report_composer")!.responseSchema as any;
    const item = schema.properties.subclaimVerdicts.items;
    expect(item.properties.supportingSources).toBeDefined();
    expect(item.properties.contradictingSources).toBeDefined();
    expect(item.properties.evidenceGaps).toBeDefined();
  });

  it("mergeSubclaimVerdicts：URL 幻觉拦截——编造 URL 丢弃、真实 URL 保留", () => {
    const claimAtoms = ["原子A"];
    const realUrl = "https://real.example.com/a";
    const searchSources = [
      { url: realUrl, title: "真实来源", snippet: "真实摘要" },
      { url: "https://real.example.com/b", title: "另一个真实来源", snippet: "摘要" },
    ];
    const verdicts = [
      {
        claimAtom: "原子A",
        verdict: "true",
        evidence: "证据",
        boundary: "边界",
        supportingSources: [
          { url: realUrl, title: "真实来源", snippet: "真实摘要" },
          { url: "https://fabricated.example.com/x", title: "编造来源", snippet: "编造" }, // 编造，应丢弃
        ],
        contradictingSources: [
          { url: "https://real.example.com/b", title: "另一个真实来源", snippet: "摘要" },
          { url: "https://ghost.example.com/y", title: "幽灵来源", snippet: "幽灵" }, // 编造，应丢弃
        ],
        evidenceGaps: ["缺官方公告"],
      },
    ];
    const result = mergeSubclaimVerdicts(claimAtoms, verdicts, searchSources);
    const item = result.find((r) => r.claimAtom === "原子A")!;
    expect(item.supportingSources).toEqual([
      { url: realUrl, title: "真实来源", snippet: "真实摘要" },
    ]);
    expect(item.contradictingSources).toEqual([
      { url: "https://real.example.com/b", title: "另一个真实来源", snippet: "摘要" },
    ]);
    expect(item.evidenceGaps).toEqual(["缺官方公告"]);
  });

  it("mergeSubclaimVerdicts：未提供 searchSources 时透传结构化来源（供 report_composer 渲染）", () => {
    const claimAtoms = ["原子A"];
    const verdicts = [
      {
        claimAtom: "原子A",
        verdict: "partial",
        evidence: "证据",
        boundary: "边界",
        supportingSources: [{ url: "https://x.example.com", title: "X", snippet: "S" }],
        contradictingSources: [],
        evidenceGaps: [],
      },
    ];
    const result = mergeSubclaimVerdicts(claimAtoms, verdicts);
    expect(result[0].supportingSources).toEqual([{ url: "https://x.example.com", title: "X", snippet: "S" }]);
  });

  it("mergeSubclaimVerdicts：searchSources 为空数组时所有来源被丢弃（无可交叉校验的真实来源）", () => {
    const claimAtoms = ["原子A"];
    const verdicts = [
      {
        claimAtom: "原子A",
        verdict: "true",
        evidence: "证据",
        boundary: "边界",
        supportingSources: [{ url: "https://x.example.com", title: "X", snippet: "S" }],
        contradictingSources: [{ url: "https://y.example.com", title: "Y", snippet: "T" }],
        evidenceGaps: [],
      },
    ];
    const result = mergeSubclaimVerdicts(claimAtoms, verdicts, []);
    expect(result[0].supportingSources).toEqual([]);
    expect(result[0].contradictingSources).toEqual([]);
  });

  it("mergeSubclaimVerdicts：evidenceGaps 截断长度与条数", () => {
    const claimAtoms = ["原子A"];
    const longGap = "缺".repeat(300);
    const verdicts = [
      {
        claimAtom: "原子A",
        verdict: "unverified",
        evidence: "",
        boundary: "",
        evidenceGaps: [longGap, "缺口2", "缺口3", "缺口4", "缺口5"],
      },
    ];
    const result = mergeSubclaimVerdicts(claimAtoms, verdicts);
    const gaps = result[0].evidenceGaps;
    expect(gaps).toHaveLength(3); // 截断到 3 条
    expect(gaps[0].length).toBe(121); // 120 内容字符 + 省略号
    expect(gaps[0].endsWith("…")).toBe(true);
  });
});