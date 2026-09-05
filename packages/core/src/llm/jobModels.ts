export type JobProviderId = "minimax" | "stepfun" | "deepseek" | "mimo" | "360" | "anthropic";

export type JobCandidate = {
  provider: JobProviderId;
  model: string;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
};

const PROVIDERS = new Set<JobProviderId>([
  "minimax",
  "stepfun",
  "deepseek",
  "mimo",
  "360",
  "anthropic",
]);

const FAST: JobCandidate[] = [
  { provider: "minimax", model: "MiniMax-M3", effort: "low", timeoutMs: 30_000 },
  { provider: "stepfun", model: "step-3.7-flash", effort: "low", timeoutMs: 45_000 },
];

const COMPOSE: JobCandidate[] = [
  { provider: "minimax", model: "MiniMax-M3", effort: "medium", timeoutMs: 45_000 },
  { provider: "stepfun", model: "step-3.7-flash", effort: "low", timeoutMs: 60_000 },
];

const DEFAULTS: Record<string, JobCandidate[]> = {
  route: FAST,
  "self-proof": FAST,
  assess: FAST,
  investigate: FAST,
  cites: FAST,
  ask_case: FAST,
  decompose: FAST,
  qualify: FAST,
  qualify_review: FAST,
  compose: COMPOSE,
};

const ENV_FALLBACK: readonly {
  provider: JobProviderId;
  key: string;
  modelEnv: string;
  defaultModel: string;
}[] = [
  { provider: "minimax", key: "MINIMAX_API_KEY", modelEnv: "MINIMAX_MODEL", defaultModel: "MiniMax-M3" },
  { provider: "stepfun", key: "STEPFUN_API_KEY", modelEnv: "STEPFUN_MODEL", defaultModel: "step-3.7-flash" },
  { provider: "deepseek", key: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL", defaultModel: "deepseek-v4-pro" },
  { provider: "mimo", key: "MIMO_API_KEY", modelEnv: "MIMO_MODEL", defaultModel: "mimo-v2.5-pro" },
];

function envPresent(env: Readonly<Record<string, string | undefined>>, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

function candidatesFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  defaults: readonly JobCandidate[],
): JobCandidate[] {
  const last = defaults[defaults.length - 1] ?? defaults[0];
  const out: JobCandidate[] = [];
  for (const spec of ENV_FALLBACK) {
    if (!envPresent(env, spec.key)) continue;
    const template = defaults.find((row) => row.provider === spec.provider) ?? last;
    const named = env[spec.modelEnv];
    const model = typeof named === "string" && named.trim().length > 0 ? named.trim() : spec.defaultModel;
    out.push({
      provider: spec.provider,
      model,
      effort: template?.effort ?? "low",
      timeoutMs: template?.timeoutMs ?? 30_000,
    });
  }
  return out;
}

function jobEnvKey(job: string): string {
  return `RHG_MODEL_${job.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
}

function parseEffort(value: string | undefined): "low" | "medium" | "high" | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

function parseOne(raw: string, fallbackTimeoutMs: number): JobCandidate | undefined {
  const parts = raw.split(":").map((item) => item.trim());
  if (parts.length < 2) return undefined;
  const provider = parts[0] as JobProviderId;
  if (!PROVIDERS.has(provider)) return undefined;
  const effort = parts.length >= 3 ? parseEffort(parts[parts.length - 1]) : undefined;
  const model = (effort ? parts.slice(1, -1) : parts.slice(1)).join(":");
  if (!model) return undefined;
  if (parts.length >= 3 && effort === undefined) return undefined;
  return { provider, model, effort: effort ?? "low", timeoutMs: fallbackTimeoutMs };
}

function parseOverride(raw: string, fallbackTimeoutMs: number): JobCandidate[] {
  const out: JobCandidate[] = [];
  for (const item of raw.split(",")) {
    const parsed = parseOne(item.trim(), fallbackTimeoutMs);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function candidatesFor(
  job: string,
  env: Readonly<Record<string, string | undefined>>,
): JobCandidate[] {
  const defaults = DEFAULTS[job] ?? DEFAULTS.assess ?? FAST;
  const raw = env[jobEnvKey(job)];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = parseOverride(raw, defaults[0]?.timeoutMs ?? 30_000);
    if (parsed.length > 0) return parsed;
  }
  const discovered = candidatesFromEnv(env, defaults);
  if (discovered.length > 0) return discovered;
  return defaults.map((row) => ({ ...row }));
}
