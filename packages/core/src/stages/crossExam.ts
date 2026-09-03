import type { AgentTextProviderId } from "../llm/providerRouter.js";
import type { StageContext } from "./context.js";
import { runInvestigator, type InvestigatorTools } from "./investigate.js";
import { runJudge } from "./judgeStage.js";

export type ModelChoice = { provider: AgentTextProviderId; model: string };

export type CrossExamInput = {
  tools: InvestigatorTools;
  budget?: number;
  deadline?: number;
  claimIds?: string[];
  providers?: ModelChoice[];
};

export type CrossExamResult = { examined: string[]; flipped: string[]; stillContested: string[] };

export const PROSECUTOR_MANDATE =
  "你是控方：只找能推翻命题的反证、和被引用的原始来源；不要找佐证";

export const DEFENDER_MANDATE =
  "你是辩方：只找能支撑命题的佐证、和原句被断章取义前的原语境；不要找反证";

const DEFAULT_BUDGET = 4;

export function withModelOverride(ctx: StageContext, choice: ModelChoice): StageContext {
  return {
    get current() {
      return ctx.current;
    },
    get emitted() {
      return ctx.emitted;
    },
    emit: (event) => ctx.emit(event),
    now: () => ctx.now(),
    clock: () => ctx.clock(),
    get signal() {
      return ctx.signal;
    },
    get deadline() {
      return ctx.deadline;
    },
    llm: async (params) =>
      ctx.llm(params.modelOverride === undefined ? { ...params, modelOverride: choice } : params),
  };
}

function contestedClaimIds(ctx: StageContext, claimIds: string[] | undefined): string[] {
  const allow = claimIds === undefined ? null : new Set(claimIds);
  return ctx.current.claims
    .filter((claim) => allow === null || allow.has(claim.id))
    .filter((claim) => ctx.current.verdicts.find((item) => item.claimId === claim.id)?.verdict === "contested")
    .map((claim) => claim.id);
}

function splitExamined(ctx: StageContext, examined: string[]): Pick<CrossExamResult, "flipped" | "stillContested"> {
  const flipped: string[] = [];
  const stillContested: string[] = [];
  for (const id of examined) {
    if (ctx.current.verdicts.find((item) => item.claimId === id)?.verdict === "contested") {
      stillContested.push(id);
    } else {
      flipped.push(id);
    }
  }
  return { flipped, stillContested };
}

export async function runCrossExam(ctx: StageContext, input: CrossExamInput): Promise<CrossExamResult> {
  const examined = contestedClaimIds(ctx, input.claimIds);
  if (examined.length === 0) {
    return { examined: [], flipped: [], stillContested: [] };
  }

  ctx.emit({ type: "stage.started", stage: "crossExam" });

  const providers = input.providers ?? [];
  const split = providers.length >= 2;
  if (!split) {
    ctx.emit({ type: "error", stage: "crossExam", message: "交叉复核两方使用同一模型来源" });
  }

  const budget = input.budget ?? DEFAULT_BUDGET;
  const prosecutorCtx = split ? withModelOverride(ctx, providers[0]!) : ctx;
  const defenderCtx = split ? withModelOverride(ctx, providers[1]!) : ctx;
  const shared = {
    budget,
    deadline: input.deadline,
    tools: input.tools,
    claimIds: examined,
    forceGaps: true as const,
  };

  await runInvestigator(prosecutorCtx, {
    ...shared,
    role: "prosecutor",
    systemPromptSuffix: PROSECUTOR_MANDATE,
  });
  await runInvestigator(defenderCtx, {
    ...shared,
    role: "defender",
    systemPromptSuffix: DEFENDER_MANDATE,
  });

  await runJudge(ctx, { claimIds: examined });
  ctx.emit({ type: "stage.finished", stage: "crossExam", outcome: "ok" });

  return { examined, ...splitExamined(ctx, examined) };
}
