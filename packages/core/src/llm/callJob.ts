import {
  dispatchSingleProvider,
  parseAgentJson,
  type AgentTextProviderId,
} from "./providerRouter.js";
import { candidatesFor, type JobCandidate } from "./jobModels.js";

export type LlmEnv = Readonly<Record<string, string | undefined>>;

export type JobAttempt = {
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type JobDispatch = (args: {
  candidate: JobCandidate;
  systemPrompt: string;
  userContent: string;
  responseSchema?: object;
  maxTokens: number;
  env: Record<string, string>;
  signal: AbortSignal;
  timeoutMs: number;
}) => Promise<{ text: string; model: string; reasoning?: string }>;

export type CallJobParams = {
  job: string;
  systemPrompt: string;
  userContent: string;
  responseSchema?: object;
  maxTokens?: number;
  env: LlmEnv;
  modelOverride?: { provider: AgentTextProviderId; model: string };
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  deadlineMs?: number;
  hedgeAfterMs?: number;
  dispatch?: JobDispatch;
};

export type CallJobResult = {
  /** 已 JSON.parse 的模型输出；调用方用 typebox 按工单 schema 校验后再用 */
  output: unknown;
  model: string;
  latencyMs: number;
  reasoning?: string;
  attempts: JobAttempt[];
};

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_HEDGE_MS = 8_000;
const COMPOSE_HEDGE_MS = 15_000;
const DEADLINE_ABORT_SLACK_MS = 500;
const DEADLINE_TOO_CLOSE_MS = 3_000;
const RETRY_BACKOFF_MS = 400;
const NETWORK_ERROR_RE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|UND_ERR_/i;

function toRouterEnv(env: LlmEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function appendSchema(systemPrompt: string, responseSchema: object | undefined): string {
  if (responseSchema === undefined) return systemPrompt;
  return `${systemPrompt}\n\n# RESPONSE SCHEMA\n${JSON.stringify(responseSchema)}`;
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export async function defaultDispatch(args: Parameters<JobDispatch>[0]): ReturnType<JobDispatch> {
  return dispatchSingleProvider({
    provider: args.candidate.provider,
    model: args.candidate.model,
    env: args.env,
    agentId: undefined,
    systemPrompt: args.systemPrompt,
    userContent: args.userContent,
    responseSchema: args.responseSchema ?? {},
    maxTokens: args.maxTokens,
    codexBin: args.env.CODEX_BIN || "",
    reasoningEffort: args.candidate.effort,
    signal: args.signal,
  });
}

function resolveCandidates(job: string, env: LlmEnv, modelOverride?: CallJobParams["modelOverride"]): JobCandidate[] {
  const table = candidatesFor(job, env);
  if (!modelOverride) return table;
  const extra: JobCandidate = {
    provider: modelOverride.provider as JobCandidate["provider"],
    model: modelOverride.model,
    effort: "low",
    timeoutMs: table[0]?.timeoutMs ?? 30_000,
  };
  return [extra, ...table.filter((row) => row.provider !== extra.provider || row.model !== extra.model)];
}

export async function callJob({
  job,
  systemPrompt,
  userContent,
  responseSchema,
  maxTokens = DEFAULT_MAX_TOKENS,
  env,
  modelOverride,
  signal,
  deadlineMs,
  hedgeAfterMs,
  dispatch = defaultDispatch,
}: CallJobParams): Promise<CallJobResult> {
  const started = Date.now();
  const routerEnv = toRouterEnv(env);
  const prompt = appendSchema(systemPrompt, responseSchema);
  const candidates = resolveCandidates(job, env, modelOverride);
  const hedgeMs = hedgeAfterMs ?? (job === "compose" ? COMPOSE_HEDGE_MS : DEFAULT_HEDGE_MS);
  const attempts: JobAttempt[] = [];

  if (signal?.aborted) throw abortError();
  if (deadlineMs !== undefined && deadlineMs - Date.now() < DEADLINE_TOO_CLOSE_MS) {
    throw new Error("deadline exceeded");
  }

  type Slot = {
    controller: AbortController;
    done: Promise<void>;
    settled: boolean;
  };

  const flying: Slot[] = [];
  const retried = new Set<number>();
  let nextIndex = 0;
  let winner: CallJobResult | undefined;
  let externalAbort = false;

  const abortFlying = (): void => {
    for (const slot of flying) slot.controller.abort();
  };

  const onExternalAbort = (): void => {
    externalAbort = true;
    abortFlying();
  };
  signal?.addEventListener("abort", onExternalAbort);

  const inFlight = (): number => flying.filter((slot) => !slot.settled).length;

  const launch = (index: number): void => {
    const candidate = candidates[index];
    if (!candidate || winner || externalAbort) return;
    if (deadlineMs !== undefined && deadlineMs - Date.now() < DEADLINE_TOO_CLOSE_MS) return;

    const timeoutMs =
      deadlineMs !== undefined
        ? Math.min(candidate.timeoutMs, deadlineMs - Date.now() - DEADLINE_ABORT_SLACK_MS)
        : candidate.timeoutMs;
    if (timeoutMs <= 0) return;

    const controller = new AbortController();
    if (signal?.aborted) {
      controller.abort();
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const attemptStarted = Date.now();
    const slot: Slot = { controller, done: Promise.resolve(), settled: false };

    slot.done = (async () => {
      try {
        const raw = await dispatch({
          candidate,
          systemPrompt: prompt,
          userContent,
          responseSchema,
          maxTokens,
          env: routerEnv,
          signal: controller.signal,
          timeoutMs,
        });
        const output = parseAgentJson(raw.text, raw.model);
        const latencyMs = Date.now() - attemptStarted;
        attempts.push({ provider: candidate.provider, model: candidate.model, ok: true, latencyMs });
        if (!winner && !externalAbort) {
          winner = {
            output,
            model: raw.model,
            latencyMs: Date.now() - started,
            attempts,
            ...(raw.reasoning ? { reasoning: raw.reasoning } : {}),
          };
          abortFlying();
        }
      } catch (error) {
        const latencyMs = Date.now() - attemptStarted;
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          ok: false,
          latencyMs,
          error: message.slice(0, 300),
        });
        if (externalAbort || signal?.aborted) return;
        const roomForRetry =
          deadlineMs === undefined || deadlineMs - Date.now() >= DEADLINE_TOO_CLOSE_MS + RETRY_BACKOFF_MS;
        if (NETWORK_ERROR_RE.test(message) && !retried.has(index) && roomForRetry) {
          retried.add(index);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, RETRY_BACKOFF_MS);
          });
          if (externalAbort || signal?.aborted || winner) return;
          launch(index);
          return;
        }
        if (!winner && nextIndex < candidates.length) {
          const follow = nextIndex;
          nextIndex += 1;
          launch(follow);
        }
      } finally {
        clearTimeout(timeout);
        slot.settled = true;
      }
    })();

    flying.push(slot);
  };

  if (candidates.length === 0) {
    signal?.removeEventListener("abort", onExternalAbort);
    throw new Error("no model candidates");
  }

  launch(0);
  nextIndex = 1;

  const hedgeTimer = setTimeout(() => {
    if (winner || externalAbort) return;
    if (nextIndex < candidates.length && inFlight() < 2) {
      const follow = nextIndex;
      nextIndex += 1;
      launch(follow);
    }
  }, hedgeMs);

  try {
    while (!winner && !externalAbort) {
      const open = flying.filter((slot) => !slot.settled);
      if (open.length === 0) break;
      await Promise.race(open.map((slot) => slot.done));
    }
  } finally {
    clearTimeout(hedgeTimer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  if (externalAbort || signal?.aborted) {
    throw Object.assign(abortError(), { attempts });
  }
  if (winner) return winner;

  const detail = attempts
    .map((row) => `${row.provider}:${row.model} → ${row.error ?? "failed"}`)
    .join("; ");
  throw Object.assign(new Error((detail || "all candidates failed").slice(0, 300)), { attempts });
}
