import {
  callJob,
  callStepFunVisionForIntake,
  defaultSearchProviders,
  listAvailableModels,
  makeSearch360ReverseImage,
  searchAll,
  toEvidence,
  webFetch,
  type AgentTextProviderId,
  type Evidence,
  type LlmEnv,
  type ModelChoice,
  type RunTurnDeps,
} from "@rhg/core";

const AGENT_PROVIDERS = new Set<string>([
  "deepseek",
  "mimo",
  "minimax",
  "stepfun",
  "360",
  "anthropic",
  "codex",
]);

function definedEnv(env: LlmEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function isAgentProvider(value: string): value is AgentTextProviderId {
  return AGENT_PROVIDERS.has(value);
}

function ocrTextsFrom(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const rec = output as { ocrTexts?: unknown; ocr?: unknown; text?: unknown };
  if (Array.isArray(rec.ocrTexts)) {
    return rec.ocrTexts.filter((item): item is string => typeof item === "string");
  }
  if (typeof rec.ocr === "string") return [rec.ocr];
  if (typeof rec.text === "string") return [rec.text];
  return [];
}

export function buildDeps(env: LlmEnv): RunTurnDeps {
  const searchProviders = defaultSearchProviders(env);
  const bound = definedEnv(env);
  const tools: RunTurnDeps["tools"] = {
    search: (q, signal) => searchAll({}, q, { providers: searchProviders, signal }),
    fetch: (url) => webFetch(url),
  };

  const reverse = makeSearch360ReverseImage(bound);
  if (reverse) {
    tools.reverseImage = async (imageUrl: string): Promise<Evidence[]> => {
      const hits = await reverse({
        images: [{ dataUrl: imageUrl }],
        ocrTexts: [],
        sourceHints: [],
      });
      const found: Evidence[] = [];
      for (const hit of hits) {
        const row = toEvidence(hit, { kind: "reverse-image", imageUrl });
        if (row) found.push({ ...row, id: "tmp" });
      }
      return found;
    };
  }

  if (env.STEPFUN_API_KEY) {
    tools.vision = async (images, text) => {
      const result = await callStepFunVisionForIntake({
        env: bound,
        claim: text,
        intake: {
          text,
          links: [],
          images: images.map((dataUrl) => ({ dataUrl })),
        },
      });
      return { ocrTexts: ocrTextsFrom(result.output) };
    };
  }

  const providers: ModelChoice[] = listAvailableModels(bound)
    .filter((item) => isAgentProvider(item.provider))
    .map((item) => ({ provider: item.provider, model: item.model }));

  return {
    llm: (p) => callJob({ ...p, env }),
    searchProviders,
    tools,
    ...(providers.length > 0 ? { providers } : {}),
  };
}
