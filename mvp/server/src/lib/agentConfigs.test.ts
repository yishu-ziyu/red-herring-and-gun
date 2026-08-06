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

import { describe, expect, it, vi } from "vitest";
import {
  AGENT_CONFIGS,
  getAgentConfig,
  buildAgentInput,
  mergeSubclaimVerdicts,
  splitVerifiableAtoms,
  prefilterClaimAtoms,
  parseSelfProofResults,
  applySelfProof,
  runClaimAtomSelfProof,
  SELF_PROOF_SYSTEM_PROMPT,
  selfProofSchema,
  buildSelfProofUserContent,
} from "./agentConfigs";

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

describe("排除层 · splitVerifiableAtoms 确定性拆分", () => {
  it("verifiable=false 原子进 nonVerifiable，其余进 verifiable，且不变量成立（不进 verifiable）", () => {
    const claimAtoms = ["价值判断A", "事实B", "预测C"];
    const claimAtomTypes = [
      { text: "价值判断A", verifiable: false, type: "value" },
      { text: "事实B", verifiable: true, type: "fact" },
      { text: "预测C", verifiable: false, type: "prediction" },
    ];
    const split = splitVerifiableAtoms(claimAtoms, claimAtomTypes);
    expect(split.verifiable).toEqual(["事实B"]);
    expect(split.nonVerifiable).toEqual([
      { text: "价值判断A", type: "value" },
      { text: "预测C", type: "prediction" },
    ]);
    // 不变量：任何 verifiable=false 的原子绝不进入 verifiable
    expect(split.verifiable).not.toContain("价值判断A");
    expect(split.verifiable).not.toContain("预测C");
  });

  it("claimAtomTypes 缺失时默认判为可核查（不误杀）", () => {
    const claimAtoms = ["原子A", "原子B"];
    const split = splitVerifiableAtoms(claimAtoms, undefined);
    expect(split.verifiable).toEqual(["原子A", "原子B"]);
    expect(split.nonVerifiable).toEqual([]);
  });

  it("某原子无对应类型条目时默认判为可核查（兜底）", () => {
    const claimAtoms = ["有类型", "无类型"];
    const claimAtomTypes = [{ text: "有类型", verifiable: false, type: "value" }];
    const split = splitVerifiableAtoms(claimAtoms, claimAtomTypes);
    expect(split.verifiable).toEqual(["无类型"]);
    expect(split.nonVerifiable).toEqual([{ text: "有类型", type: "value" }]);
  });

  it("claimAtoms 为空时返回空结果", () => {
    const split = splitVerifiableAtoms(undefined, [{ text: "X", verifiable: false, type: "value" }]);
    expect(split.verifiable).toEqual([]);
    expect(split.nonVerifiable).toEqual([]);
  });

  it("与 mergeSubclaimVerdicts 组合：subclaimVerdicts 只覆盖可核查原子（不变量端到端）", () => {
    const claimAtoms = ["事实A", "价值B"];
    const claimAtomTypes = [
      { text: "事实A", verifiable: true, type: "fact" },
      { text: "价值B", verifiable: false, type: "value" },
    ];
    const verdicts = [
      { claimAtom: "事实A", verdict: "true", evidence: "E", boundary: "B" },
      { claimAtom: "价值B", verdict: "false", evidence: "E", boundary: "B" },
    ];
    const split = splitVerifiableAtoms(claimAtoms, claimAtomTypes);
    const result = mergeSubclaimVerdicts(split.verifiable, verdicts);
    // 不变量：价值B（verifiable=false）绝不进入 subclaimVerdicts
    expect(result.map((r) => r.claimAtom)).toEqual(["事实A"]);
    expect(result.some((r) => r.claimAtom === "价值B")).toBe(false);
    expect(split.nonVerifiable).toEqual([{ text: "价值B", type: "value" }]);
  });

  it("rumor_detector schema 应含 claimAtomTypes（item={text,verifiable,type}）与 claimType（{verifiable,type,reason}）并在 required 中", () => {
    const schema = getAgentConfig("rumor_detector")!.responseSchema as any;
    expect(schema.required).toContain("claimAtomTypes");
    expect(schema.required).toContain("claimType");
    const item = schema.properties.claimAtomTypes.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["text", "verifiable", "type"]);
    expect(item.properties.verifiable).toEqual({ type: "boolean" });
    expect(item.properties.type.enum).toEqual([
      "fact", "causal", "comparison", "concept", "value", "prediction", "normative", "personal",
    ]);
    const claimType = schema.properties.claimType;
    expect(claimType.additionalProperties).toBe(false);
    expect(claimType.required).toEqual(["verifiable", "type", "reason"]);
    expect(claimType.properties.verifiable.type).toBe("boolean");
  });

  it("rumor_detector prompt 应含灰度区判定规则与整句判定引导", () => {
    const prompt = getAgentConfig("rumor_detector")!.systemPrompt;
    expect(prompt).toMatch(/claimAtomTypes/);
    expect(prompt).toMatch(/claimType/);
    expect(prompt).toMatch(/个人经验/);
    expect(prompt).toMatch(/大量患者报告服用 X 后出现失眠/); // 个人经验按断言形态判
    expect(prompt).toMatch(/这药对我失眠很有效/); // 第一人称主观 → 不可核查
    expect(prompt).toMatch(/概念定义/);
    expect(prompt).toMatch(/value 价值判断/);
    expect(prompt).toMatch(/不可核查/);
  });
});

describe("排除层 · nonVerifiableAtoms / claimType 契约", () => {
  it("claimAtomTypes 缺失时 splitVerifiableAtoms 不抛错且全部可核查（防御）", () => {
    const split = splitVerifiableAtoms(["A"], null as unknown as unknown[]);
    expect(split.verifiable).toEqual(["A"]);
    expect(split.nonVerifiable).toEqual([]);
  });

  it("claimAtomTypes 非法结构（非数组 item）被忽略，默认可核查", () => {
    const split = splitVerifiableAtoms(["A", "B"], [{ text: "A", verifiable: false, type: "value" }, "歪曲", null]);
    expect(split.verifiable).toEqual(["B"]);
    expect(split.nonVerifiable).toEqual([{ text: "A", type: "value" }]);
  });
});

describe("原句自证闸门 · prefilterClaimAtoms 确定性预过滤", () => {
  it("去空：空字符串与非字符串被过滤，保持输入顺序", () => {
    const { atoms, dropped } = prefilterClaimAtoms("claim", ["原子A", "", "   ", 123, null, "原子B"]);
    expect(atoms).toEqual(["原子A", "原子B"]);
    expect(dropped).toEqual([]);
  });

  it("截断：超过 6 条只保留前 6 条；单条超过 180 字截断并加省略号", () => {
    const many = Array.from({ length: 8 }, (_, i) => `原子${i}`);
    const { atoms: limited } = prefilterClaimAtoms("claim", many);
    expect(limited).toHaveLength(6);
    expect(limited[0]).toBe("原子0");

    const long = "长".repeat(200);
    const { atoms: truncated } = prefilterClaimAtoms("claim", [long]);
    expect(truncated[0].length).toBe(181); // 180 内容字符 + 省略号
    expect(truncated[0].endsWith("…")).toBe(true);
  });

  it("去重：规范化后完全相同的原子只保留第一条，重复项 reason=duplicate", () => {
    const { atoms, dropped } = prefilterClaimAtoms("claim", ["原子A", "  原子A  ", "原子B", "原子B"]);
    expect(atoms).toEqual(["原子A", "原子B"]);
    expect(dropped).toEqual([
      { text: "  原子A  ", reason: "duplicate" },
      { text: "原子B", reason: "duplicate" },
    ]);
  });

  it("规范化：全角空格 U+3000 视为与普通空格相同，用于去重键，且输出规范化文本作 canonical 键", () => {
    const { atoms, dropped } = prefilterClaimAtoms("claim", ["A\u3000B", "A B"]);
    expect(atoms).toEqual(["A B"]);
    expect(dropped).toEqual([{ text: "A B", reason: "duplicate" }]);
  });

  it("非数组输入返回空结果", () => {
    expect(prefilterClaimAtoms("claim", undefined)).toEqual({ atoms: [], dropped: [] });
  });
});

describe("原句自证闸门 · 常量与 userContent", () => {
  it("SELF_PROOF_SYSTEM_PROMPT 应含原句自证判定标准", () => {
    expect(SELF_PROOF_SYSTEM_PROMPT).toMatch(/原句直接支持/);
    expect(SELF_PROOF_SYSTEM_PROMPT).toMatch(/独立含义|独立可核查/);
    expect(SELF_PROOF_SYSTEM_PROMPT).toMatch(/results/);
    // 忠实 vs 可核查边界：本闸门只判忠实，不判可核查性；立场/价值/预测型若原句声称应判 supported
    expect(SELF_PROOF_SYSTEM_PROMPT).toMatch(/不判「可核查性」|不判"可核查性"/);
    expect(SELF_PROOF_SYSTEM_PROMPT).toMatch(/排除层/);
  });

  it("selfProofSchema 结构符合要求（results 数组，item 含 atom/supported/reason）", () => {
    expect(selfProofSchema.required).toEqual(["results"]);
    const item = (selfProofSchema as any).properties.results.items;
    expect(item.additionalProperties).toBe(false);
    expect(Object.keys(item.properties)).toEqual(["atom", "supported", "reason"]);
    expect(item.required).toEqual(["atom", "supported", "reason"]);
  });

  it("buildSelfProofUserContent 应包含原句与待校验原子清单", () => {
    const content = buildSelfProofUserContent("原句内容", ["原子A", "原子B"]);
    expect(content).toContain("原句内容");
    expect(content).toContain("1. 原子A");
    expect(content).toContain("2. 原子B");
  });
});

describe("原句自证闸门 · parseSelfProofResults fail-open", () => {
  it("某原子在结果中缺失 → 视为 supported=true", () => {
    const map = parseSelfProofResults(["A", "B", "C"], {
      results: [{ atom: "A", supported: true, reason: "r" }],
    });
    expect(map.get("A")).toBe(true);
    expect(map.get("B")).toBe(true); // 缺失 → 保留
    expect(map.get("C")).toBe(true); // 缺失 → 保留
  });

  it("supported=false 的原子映射为 false", () => {
    const map = parseSelfProofResults(["A", "B"], {
      results: [
        { atom: "A", supported: true, reason: "r" },
        { atom: "B", supported: false, reason: "原句未声称" },
      ],
    });
    expect(map.get("A")).toBe(true);
    expect(map.get("B")).toBe(false);
  });

  it("结果不可解析 / 非数组 / 非对象 → 全部原子 supported=true", () => {
    for (const bad of ["garbage", 123, null, undefined, [], { notResults: true }]) {
      const map = parseSelfProofResults(["A", "B"], bad);
      expect(map.get("A")).toBe(true);
      expect(map.get("B")).toBe(true);
    }
  });
});

describe("原句自证闸门 · applySelfProof 过滤", () => {
  it("supported=false 进 dropped 且带 LLM reason；supported=true 进 kept 且按输入顺序", () => {
    const input = ["原子A", "原子B", "原子C"];
    const llmResults = {
      results: [
        { atom: "原子A", supported: true, reason: "原句直接支持" },
        { atom: "原子B", supported: false, reason: "原句未声称的信息" },
        { atom: "原子C", supported: true, reason: "原句直接支持" },
      ],
    };
    const { kept, dropped } = applySelfProof("claim", input, llmResults);
    expect(kept).toEqual(["原子A", "原子C"]);
    expect(dropped).toEqual([{ text: "原子B", reason: "原句未声称的信息" }]);
  });

  it("reason 缺失时回退为 unsupported", () => {
    const { dropped } = applySelfProof("claim", ["原子A"], {
      results: [{ atom: "原子A", supported: false }],
    });
    expect(dropped).toEqual([{ text: "原子A", reason: "unsupported" }]);
  });
});

describe("原句自证闸门 · runClaimAtomSelfProof 网关", () => {
  it("空 atoms 时不调 callModel，直接返回空结果", async () => {
    const callModel = vi.fn();
    const result = await runClaimAtomSelfProof("claim", [], callModel);
    expect(callModel).not.toHaveBeenCalled();
    expect(result).toEqual({ kept: [], dropped: [], model: "" });
  });

  it("callModel 抛错 → fail-open 全部保留，不抛错，model 为空", async () => {
    const callModel = vi.fn().mockRejectedValue(new Error("provider down"));
    const atoms = ["原子A", "原子B"];
    const result = await runClaimAtomSelfProof("claim", atoms, callModel);
    expect(result.kept).toEqual(["原子A", "原子B"]);
    expect(result.dropped).toEqual([]);
    expect(result.model).toBe("");
  });

  it("callModel 正常 → 按 supported 过滤，返回 model", async () => {
    const callModel = vi.fn().mockResolvedValue({
      output: {
        results: [
          { atom: "原子A", supported: true, reason: "直接支持" },
          { atom: "原子B", supported: false, reason: "丢限定条件" },
          { atom: "原子C", supported: true, reason: "直接支持" },
        ],
      },
      model: "deepseek-v4-pro",
    });
    const result = await runClaimAtomSelfProof("claim", ["原子A", "原子B", "原子C"], callModel);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: SELF_PROOF_SYSTEM_PROMPT, maxTokens: 600, responseSchema: selfProofSchema })
    );
    expect(result.kept).toEqual(["原子A", "原子C"]);
    expect(result.dropped).toEqual([{ text: "原子B", reason: "丢限定条件" }]);
    expect(result.model).toBe("deepseek-v4-pro");
  });

  it("callModel 返回异常结构（无 results）→ fail-open 全部保留", async () => {
    const callModel = vi.fn().mockResolvedValue({ output: "broken", model: "m" });
    const result = await runClaimAtomSelfProof("claim", ["原子A"], callModel);
    expect(result.kept).toEqual(["原子A"]);
  });
});

describe("原句自证闸门 · rumor_detector prompt 硬约束", () => {
  it("rumor_detector prompt 应含原句自证硬约束关键词", () => {
    const prompt = getAgentConfig("rumor_detector")!.systemPrompt;
    expect(prompt).toMatch(/直接支持/);
    expect(prompt).toMatch(/限定条件/);
    expect(prompt).toMatch(/无独立含义的碎片/);
    expect(prompt).toMatch(/回读/);
  });
});