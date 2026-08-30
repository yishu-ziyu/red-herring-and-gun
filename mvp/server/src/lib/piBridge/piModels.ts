/**
 * piModels.ts — pi-ai Provider 注册（P0a 试点）。
 *
 * 把现网 OpenAI 兼容模型链（MiniMax-M3 / DeepSeek / StepFun）注册进 pi 的
 * ModelRuntime，供 pi-agent 会话选用。鉴权/地址/env key 与现网 providerRouter 同源。
 * P0 只证明「pi 能调我们的模型」，不替换现网调用。
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface PiProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    input: Array<"text" | "image">;
    contextWindow: number;
    maxTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>;
}

/** 从 env 挑出现网可用的 OpenAI 兼容模型链。 */
export function piProviderConfigs(env: Record<string, string>): PiProviderConfig[] {
  const out: PiProviderConfig[] = [];
  const pick = (...names: string[]) => {
    for (const n of names) {
      const v = env[n] || process.env[n];
      if (v) return v;
    }
    return "";
  };
  const minimaxKey = pick("MINIMAX_API_KEY", "MINIMAX_TOKEN_PLAN_KEY");
  if (minimaxKey) {
    out.push({
      id: "minimax",
      label: "MiniMax",
      baseUrl: (pick("MINIMAX_BASE_URL") || "https://api.minimaxi.com/v1").replace(/\/$/, ""),
      apiKey: minimaxKey,
      models: [
        {
          id: "MiniMax-M3",
          name: "MiniMax M3",
          reasoning: false,
          input: ["text"],
          contextWindow: 1000000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  }
  const deepseekKey = pick("DEEPSEEK_API_KEY");
  if (deepseekKey) {
    out.push({
      id: "deepseek",
      label: "DeepSeek",
      baseUrl: (pick("DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1").replace(/\/$/, ""),
      apiKey: deepseekKey,
      models: [
        {
          id: pick("DEEPSEEK_MODEL") || "deepseek-v4-pro",
          name: "DeepSeek reasoning",
          reasoning: true,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  }
  const stepfunKey = pick("STEPFUN_API_KEY");
  if (stepfunKey) {
    out.push({
      id: "stepfun",
      label: "StepFun",
      baseUrl: (pick("STEPFUN_BASE_URL") || "https://api.stepfun.com/v1").replace(/\/$/, ""),
      apiKey: stepfunKey,
      models: [
        {
          id: pick("STEPFUN_MODEL") || "step-3.7-flash",
          name: "StepFun Flash",
          reasoning: true,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  }
  return out;
}

/** 把现网模型链注册进 pi ModelRuntime。返回注册成功的 provider id 列表。 */
export async function registerProviders(
  modelRuntime: ModelRuntime,
  env: Record<string, string>
): Promise<string[]> {
  const registered: string[] = [];
  for (const cfg of piProviderConfigs(env)) {
    try {
      modelRuntime.registerProvider(cfg.id, {
        name: cfg.label,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        models: cfg.models,
      });
      registered.push(cfg.id);
    } catch {
      /* 单 provider 注册失败不阻断其余 */
    }
  }
  return registered;
}

/** 从已注册 provider 里挑第一个可用模型（优先支持原生 function-calling 的模型链）。 */
export function pickFirstModel(cfgList: PiProviderConfig[], registered: string[]): string | undefined {
  const order = ["stepfun", "minimax", "deepseek", "mimo"];
  for (const id of order) {
    if (!registered.includes(id)) continue;
    const cfg = cfgList.find((c) => c.id === id);
    if (cfg) return `${id}/${cfg.models[0].id}`;
  }
  return undefined;
}