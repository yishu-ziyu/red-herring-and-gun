// ───────────────────────────────────────────────────────────────
// Server-side model catalog + env-based filtering
// 给 4-Agent pipeline 的"用户选 model"功能做候选清单。
// 静态 model 目录 + 按 env 过滤掉没配 key 的 provider。
// ───────────────────────────────────────────────────────────────

import { envValue, getMiniMaxApiKey } from "./providerRouter.js";

export type ProviderId =
  | "deepseek"
  | "mimo"
  | "stepfun"
  | "360"
  | "kimi"
  | "minimax"
  | "anthropic"
  | "codex";

export type ModelTier = "high" | "mid" | "low";

export interface AvailableModel {
  provider: ProviderId;
  model: string;
  label: string;
  tier: ModelTier;
  hint: string;
}

interface ModelSpec {
  provider: ProviderId;
  model: string;
  label: string;
  tier: ModelTier;
  hint: string;
}

// 静态 model 目录。tier 用来快速分档(强/中/弱);hint 是展示给用户看的短标签。
// 不在目录里的 model 用户即便知道名字也无法选(防止拼写错)。
// 顺序约定：tier 升序，同 tier 内 catalog 顺序；preset 用 first-of-tier 取值。
//   high tier 只表示能力分档；默认路由由 ORCHESTRATE_*_PROVIDER_ORDER 控制。
// 2026-Q2 模型目录（agent-1..5 research 校准）。
const MODEL_CATALOG: ModelSpec[] = [
  // MiniMax（Anthropic 兼容 + OpenAI 兼容双协议）
  { provider: "minimax", model: "MiniMax-M3",             label: "MiniMax M3",             tier: "high", hint: "已配置 · 1M ctx" },
  { provider: "minimax", model: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed", tier: "mid",  hint: "速度" },

  // DeepSeek（V4 系列；旧 deepseek-chat / deepseek-reasoner 别名已弃用）
  { provider: "deepseek", model: "deepseek-v4-pro",   label: "DeepSeek V4 Pro",   tier: "high", hint: "强推理" },
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "mid",  hint: "推荐" },

  // StepFun（阶跃星辰；2026-Q2 当前在售：step-3.7-flash 是 2026-05-12 最新 reasoning-flash）
  { provider: "stepfun", model: "step-3.7-flash", label: "StepFun 3.7 Flash", tier: "high", hint: "推理·需大 max_tokens" },

  // 360 / 360GPT
  { provider: "360", model: "360gpt2-pro",  label: "360GPT 2 Pro",  tier: "high", hint: "国产" },
  { provider: "360", model: "360gpt-pro",   label: "360GPT Pro",    tier: "mid",  hint: "推荐" },
  { provider: "360", model: "360gpt-turbo", label: "360GPT Turbo",  tier: "low",  hint: "便宜" },

  // Moonshot / Kimi（项目无 API key，UI 占位；拿到 key 后会自动出现在 picker）
  { provider: "kimi", model: "kimi-latest",          label: "Kimi Latest",          tier: "high", hint: "可选" },
  { provider: "kimi", model: "kimi-k2-thinking",     label: "Kimi K2 Thinking",     tier: "mid",  hint: "可选" },
  { provider: "kimi", model: "kimi-k2-0905-preview", label: "Kimi K2 0905 Preview", tier: "low",  hint: "可选" },

  // MiMo
  { provider: "mimo", model: "mimo-v2.5-pro",         label: "MiMo v2.5 Pro",     tier: "mid",  hint: "国产" },

  // Anthropic 原生（保留为 fallback；不在新目录主推）
  { provider: "anthropic", model: "MiniMax-M3",       label: "Anthropic → MiniMax M3", tier: "high", hint: "Anthropic 兼容" },

  // Codex (subprocess)
  { provider: "codex", model: "gpt-5.5",              label: "Codex GPT-5.5",     tier: "high", hint: "本地" },
];

/** 单个 provider 是否"已就绪"（env 里能找到至少一把 key 或必要配置） */
export function isProviderConfigured(
  env: Record<string, string>,
  provider: ProviderId
): boolean {
  if (provider === "deepseek") return Boolean(env.DEEPSEEK_API_KEY);
  if (provider === "mimo") return Boolean(env.MIMO_API_KEY);
  if (provider === "stepfun") return Boolean(env.STEPFUN_API_KEY);
  if (provider === "360") {
    return Boolean(env.QIHOO_360_API_KEY || env.ZHINAO_API_KEY || env.AI360_API_KEY);
  }
  if (provider === "kimi") {
    // Moonshot / Kimi：项目目前没配 key，留作 UI 占位
    return Boolean(env.KIMI_API_KEY || env.MOONSHOT_API_KEY);
  }
  if (provider === "minimax") {
    return Boolean(getMiniMaxApiKey(env));
  }
  if (provider === "anthropic") {
    // Anthropic 走 proxy：baseUrl+model+token 至少各一；token 可省（router 会从 ~/.claude/settings.json 兜底）
    return Boolean(
      (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_MODEL) ||
        env.ANTHROPIC_AUTH_TOKEN ||
        env.ANTHROPIC_API_KEY
    );
  }
  if (provider === "codex") {
    return Boolean(env.CODEX_BIN || process.env.CODEX_BIN);
  }
  return false;
}

/**
 * 返回 env 里**已配 key** 的所有 model 候选。
 * 顺序：tier 升序(high→low)，同 tier 内按 catalog 顺序。
 * 调用方（前端 picker）用这个列表渲染下拉。
 */
export function listAvailableModels(env: Record<string, string>): AvailableModel[] {
  const tierRank: Record<ModelTier, number> = { high: 0, mid: 1, low: 2 };
  return MODEL_CATALOG
    .filter((m) => isProviderConfigured(env, m.provider))
    .map((m) => ({ ...m }))
    .sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);
}

/**
 * 给定 (provider, model)，判断是否在当前可用列表里。
 * 用途：orchestrate handler 收到 modelChoice 时校验。
 */
export function isModelAvailable(
  env: Record<string, string>,
  provider: string,
  model: string
): boolean {
  return listAvailableModels(env).some(
    (m) => m.provider === provider && m.model === model
  );
}

/** (本文件被 use 一下避免 unused import 报错) */
void envValue;

// ───────────────────────────────────────────────────────────────
// validateModelChoice — orchestrate handler 收到 modelChoice 时校验
// ───────────────────────────────────────────────────────────────

/** 4-Agent pipeline 的合法 agent id（与 AGENT_CONFIGS 对齐） */
const VALID_AGENT_IDS = new Set([
  "rumor_detector",
  "fact_checker",
  "source_validator",
  "report_composer",
]);

export interface ModelChoiceEntry {
  provider: string;
  model: string;
}

export type ModelChoiceMap = Record<string, ModelChoiceEntry | undefined>;

export interface ValidationResult {
  ok: boolean;
  /** 当 ok=false 时给出人类可读的错误信息 */
  error?: string;
}

/**
 * 校验 modelChoice：
 * - undefined / 空对象 → OK（所有 agent 走 fallback chain）
 * - 每条 entry 必须是 { provider, model }，且在 listAvailableModels(env) 里能找到
 * - agent id 必须是已知的 4 个之一（防止 typo）
 * - 单条失败 → 整体 400
 */
export function validateModelChoice(
  env: Record<string, string>,
  modelChoice: unknown
): ValidationResult {
  if (modelChoice === undefined || modelChoice === null) {
    return { ok: true };
  }
  if (typeof modelChoice !== "object" || Array.isArray(modelChoice)) {
    return { ok: false, error: "modelChoice 必须是对象 { agentId: { provider, model } }" };
  }
  const entries = Object.entries(modelChoice as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: true };
  }
  const available = listAvailableModels(env);
  for (const [agentId, choice] of entries) {
    if (!VALID_AGENT_IDS.has(agentId)) {
      return {
        ok: false,
        error: `modelChoice.${agentId}: 未知 agent id（合法值: rumor_detector / fact_checker / source_validator / report_composer）`,
      };
    }
    if (!choice || typeof choice !== "object") {
      return { ok: false, error: `modelChoice.${agentId} 必须是 { provider, model } 对象` };
    }
    const { provider, model } = choice as Record<string, unknown>;
    if (typeof provider !== "string" || typeof model !== "string") {
      return { ok: false, error: `modelChoice.${agentId}: provider 和 model 必须是字符串` };
    }
    const exists = available.some(
      (m) => m.provider === provider && m.model === model
    );
    if (!exists) {
      return {
        ok: false,
        error: `modelChoice.${agentId}: ${provider}:${model} 不在可用列表中（可能服务端没配 ${_keyNameForProvider(provider)}，或 model 名拼错）`,
      };
    }
  }
  return { ok: true };
}

function _keyNameForProvider(provider: string): string {
  if (provider === "deepseek") return "DEEPSEEK_API_KEY";
  if (provider === "mimo") return "MIMO_API_KEY";
  if (provider === "stepfun") return "STEPFUN_API_KEY";
  if (provider === "360") return "QIHOO_360_API_KEY / ZHINAO_API_KEY / AI360_API_KEY";
  if (provider === "kimi") return "KIMI_API_KEY / MOONSHOT_API_KEY";
  if (provider === "minimax") return "MINIMAX_API_KEY / MINIMAX_TOKEN_PLAN_KEY";
  if (provider === "anthropic") return "ANTHROPIC_BASE_URL + ANTHROPIC_MODEL (+ token)";
  if (provider === "codex") return "CODEX_BIN";
  return "对应 API key";
}
