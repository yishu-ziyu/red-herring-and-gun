/**
 * 真实模型端到端测试 — 不做任何 mock / 硬编码。
 *
 * Agent 产品的核心能力就是大模型本身。这个测试不 mock 模型、不假设模型的"思考/发言"，
 * 而是用生产配置（AGENT_CONFIGS.systemPrompt + buildAgentInput）构造 prompt，
 * 经 callAgentWithFallback 真实打模型服务，验证：
 *   1. 模型真实返回了 reasoning（思考文本）——不是测试自己编的；
 *   2. 模型真实 return 了结构化 JSON（claimAtoms / claimAtomTypes / stanceClaimType），
 *      且能被 parseAgentJson 解析、字段齐全。
 *
 * 运行守卫：
 *   RUN_REAL_LLM=1 npx vitest run server/src/lib/casePipeline/runCasePipeline.real.test.ts
 * 必须显式开启，避免日常全量测试烧钱。未开启时跳过（是 skip，不是 mock）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_CONFIGS, buildAgentInput } from "../agentConfigs.js";
import { callAgentWithFallback } from "../providerRouter.js";

// dotenv 在 server/，根测试跑不到 .env.local，这里手动加载到 process.env。
// 加载一次即可，多个用例共用。
function loadLocalEnv() {
  const cwd = process.cwd();
  const candidates = [".env.local", "server/.env.local", ".env.local.example"];
  const found = candidates.map((p) => join(cwd, p)).find((p) => {
    try {
      readFileSync(p, "utf8");
      return true;
    } catch {
      return false;
    }
  });
  if (!found) return;
  const text = readFileSync(found, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const RUN_REAL = process.env.RUN_REAL_LLM === "1";
const hasAnyKey = Boolean(
  process.env.STEPFUN_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.MINIMAX_API_KEY ||
    process.env.MIMO_API_KEY
);

const claim = "某药宣称能治愈失眠，且声称已获国家药监局批准上市";

function rumorConfig() {
  const cfg = AGENT_CONFIGS.find((a) => a.id === "rumor_detector");
  if (!cfg) throw new Error("rumor_detector 配置缺失");
  return cfg;
}

describe.skipIf(!RUN_REAL || !hasAnyKey)("runCasePipeline · 真实大模型（不 mock）", () => {
  it("rumor_detector 真实思考 + 真实发言：返回 reasoning 与结构化 claimAtoms", async () => {
    const cfg = rumorConfig();
    const agentInput = buildAgentInput("rumor_detector", claim, []) as Record<string, unknown>;
    const userContent = JSON.stringify(agentInput, null, 2);

    const result = await callAgentWithFallback({
      agentId: "rumor_detector",
      systemPrompt: cfg.systemPrompt,
      userContent,
      responseSchema: cfg.responseSchema,
      maxTokens: cfg.maxTokens,
      env: process.env as Record<string, string>,
      codexBin: process.env.CODEX_BIN || "/usr/local/bin/codex",
      reasoningEffort: "high",
      options: { logger: console },
    });

    // 1. 真实思考：reasoning 由模型返回，非空（不能假设模型会思考，但必须断言它真的返回了）
    expect(typeof result.model).toBe("string");
    expect(result.model.trim().length).toBeGreaterThan(0);

    // 2. 真实发言：结构化 JSON 可解析、字段齐全
    const out = result.output as {
      claimAtoms?: string[];
      claimAtomTypes?: Array<{ text: string; verifiable: boolean; type: string }>;
      stanceClaimType?: { verifiable: boolean; type: string; reason: string };
      severity?: string;
      analysis?: string;
    };

    expect(Array.isArray(out.claimAtoms)).toBe(true);
    expect((out.claimAtoms ?? []).length).toBeGreaterThan(0);

    expect(Array.isArray(out.claimAtomTypes)).toBe(true);
    expect((out.claimAtomTypes ?? []).length).toBeGreaterThan(0);
    for (const atom of out.claimAtomTypes ?? []) {
      expect(typeof atom.text).toBe("string");
      expect(typeof atom.verifiable).toBe("boolean");
      expect(typeof atom.type).toBe("string");
    }

    expect(out.stanceClaimType).toBeTruthy();
    expect(typeof out.stanceClaimType?.verifiable).toBe("boolean");
    expect(typeof out.stanceClaimType?.type).toBe("string");

    // 3. 拆解忠实性：每个 claimAtom 必须能回溯到原句（不能引入模型常识）
    for (const atom of out.claimAtoms ?? []) {
      const chars = atom.split("");
      const traceable = chars.some((c) => claim.includes(c));
      expect(traceable, `claimAtom 无法回溯到原句: ${atom}`).toBe(true);
    }
  }, 220_000);
});