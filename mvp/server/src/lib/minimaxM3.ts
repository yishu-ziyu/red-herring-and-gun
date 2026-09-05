/**
 * MiniMax-M3：思考开着，输出预算用官方推荐值。
 *
 * thinking 计入 max_tokens。Agent 自己的 800/2400 会把思考写满、正文为空。
 * 开发阶段不额外设上限——用 MiniMax 文档推荐的 128K（硬顶 512K）。
 */

export const MINIMAX_M3_RECOMMENDED_MAX_TOKENS = 131072;
export const MINIMAX_M3_ABSOLUTE_MAX_TOKENS = 524288;
export const MINIMAX_M3_DEFAULT_TIMEOUT_MS = 600000;

export type MiniMaxThinkingType = "adaptive" | "disabled";

function envPick(env: Record<string, string> | undefined, key: string): string {
  const fromEnv = env?.[key];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  const fromProcess = typeof process !== "undefined" ? process.env[key] : undefined;
  return typeof fromProcess === "string" ? fromProcess.trim() : "";
}

export function isMiniMaxM3(model: string): boolean {
  return /^MiniMax-M3$/i.test(model);
}

export function miniMaxM3ThinkingType(
  env: Record<string, string> | undefined,
  model: string
): MiniMaxThinkingType | undefined {
  if (!isMiniMaxM3(model)) return undefined;
  const raw = envPick(env, "MINIMAX_M3_THINKING").toLowerCase();
  if (raw === "disabled" || raw === "off") return "disabled";
  return "adaptive";
}

export function miniMaxMaxTokensForModel(
  env: Record<string, string> | undefined,
  model: string,
  requested: number
): number {
  if (/^MiniMax-M2\.7(?:-highspeed)?$/i.test(model)) {
    const explicitFloor = Number(envPick(env, "MINIMAX_M27_MIN_MAX_TOKENS"));
    const floor = Number.isFinite(explicitFloor) && explicitFloor > 0 ? explicitFloor : 4096;
    return Math.max(requested, Math.floor(floor));
  }
  if (!isMiniMaxM3(model)) return requested;
  const explicit = Number(envPick(env, "MINIMAX_M3_MAX_TOKENS"));
  const floor = Number(envPick(env, "MINIMAX_M3_MIN_MAX_TOKENS"));
  let budget =
    Number.isFinite(explicit) && explicit > 0 ? explicit : MINIMAX_M3_RECOMMENDED_MAX_TOKENS;
  if (Number.isFinite(floor) && floor > 0) budget = Math.max(budget, floor);
  budget = Math.min(Math.floor(budget), MINIMAX_M3_ABSOLUTE_MAX_TOKENS);
  return Math.max(requested, budget);
}

export function miniMaxCallOptions(
  env: Record<string, string> | undefined,
  model: string,
  requestedMaxTokens: number
): { maxTokens: number; thinking: MiniMaxThinkingType | undefined } {
  return {
    maxTokens: miniMaxMaxTokensForModel(env, model, requestedMaxTokens),
    thinking: miniMaxM3ThinkingType(env, model),
  };
}

export function buildMiniMaxMessagesBody({
  model,
  systemPrompt,
  userContent,
  maxTokens,
  thinking,
  stream,
  temperature,
}: {
  model: string;
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
  thinking?: MiniMaxThinkingType;
  stream?: boolean;
  temperature?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  };
  if (temperature !== undefined && thinking === undefined) body.temperature = temperature;
  if (thinking === "adaptive" || thinking === "disabled") {
    body.thinking = { type: thinking };
  }
  if (stream) body.stream = true;
  return body;
}
