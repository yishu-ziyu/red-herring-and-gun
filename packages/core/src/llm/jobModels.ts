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

const DECOMPOSE: JobCandidate[] = [
  { provider: "minimax", model: "MiniMax-M3", effort: "medium", timeoutMs: 40_000 },
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
  decompose: DECOMPOSE,
  compose: COMPOSE,
};

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
  return defaults.map((row) => ({ ...row }));
}
