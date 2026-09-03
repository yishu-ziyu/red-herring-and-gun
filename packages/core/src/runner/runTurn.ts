import { assertInvariants } from "../casefile/invariants.js";
import type { Case, CaseEvent } from "../casefile/schema.js";
import type { SearchProviderFn } from "../search/searchAll.js";
import { runAssess } from "../stages/assess.js";
import { runCompose } from "../stages/compose.js";
import type { ComposeDraft } from "../stages/compose.schema.js";
import { createStageContext, type LlmJob } from "../stages/context.js";
import { runCrossExam, type ModelChoice } from "../stages/crossExam.js";
import { runDecompose } from "../stages/decompose.js";
import { runFinalize } from "../stages/finalize.js";
import { runIntake, type IntakeAttachment, type IntakeTools } from "../stages/intake.js";
import { runInvestigator, type InvestigatorTools } from "../stages/investigate.js";
import { runJudge } from "../stages/judgeStage.js";
import { runRetrieve } from "../stages/retrieve.js";

export type RunTurnDeps = {
  llm: LlmJob;
  searchProviders: SearchProviderFn[];
  tools: InvestigatorTools & { vision?: IntakeTools["vision"] };
  providers?: ModelChoice[];
  clock?: () => number;
  now?: () => string;
};

export type RunTurnInput = {
  case: Case;
  message: { text: string; attachments?: IntakeAttachment[] };
  route: "new_claim" | "pursue_frontier" | "ask_case" | "challenge" | "off_topic";
  deps: RunTurnDeps;
  budget?: { totalMs?: number; composeReserveMs?: number };
  signal?: AbortSignal;
};

const DEFAULT_TOTAL_MS = 120_000;
const DEFAULT_COMPOSE_RESERVE_MS = 30_000;

type StageName =
  | "intake"
  | "decompose"
  | "retrieve"
  | "assess"
  | "judge"
  | "investigate"
  | "crossExam"
  | "compose"
  | "finalize";

type TurnReason = "done" | "timeout" | "aborted" | "error";

type Gate = "run" | "skip" | "jump" | "abort";

// ponytail: 单进程内互斥；多实例由 T15 存储层处理
const runningCases = new Set<string>();

export function runTurn(input: RunTurnInput): AsyncIterable<CaseEvent> {
  const stream = new EventStream();
  const caseId = input.case.id;

  if (runningCases.has(caseId)) {
    const ctx = createStageContext({
      case: input.case,
      llm: input.deps.llm,
      now: input.deps.now,
      signal: input.signal,
      onEvent: (event) => stream.push(event),
    });
    ctx.emit({ type: "error", stage: "runner", message: "该案件已有一轮在运行" });
    stream.close();
    return stream;
  }

  runningCases.add(caseId);
  void runPipeline(input, stream)
    .catch(() => undefined)
    .finally(() => {
      runningCases.delete(caseId);
      stream.close();
    });
  return stream;
}

async function runPipeline(input: RunTurnInput, stream: EventStream): Promise<void> {
  const { deps, signal } = input;
  const clock = deps.clock ?? Date.now;
  const totalMs = input.budget?.totalMs ?? DEFAULT_TOTAL_MS;
  const composeReserveMs = input.budget?.composeReserveMs ?? DEFAULT_COMPOSE_RESERVE_MS;
  const start = clock();
  const deadline = start + totalMs - composeReserveMs;

  const ctx = createStageContext({
    case: input.case,
    llm: deps.llm,
    now: deps.now,
    signal,
    onEvent: (event) => stream.push(event),
  });

  const turnId = `t${ctx.current.turns.length + 1}`;
  let reason: TurnReason = "done";
  let finished = false;
  let draft: ComposeDraft | null = null;

  const finish = (next: TurnReason): void => {
    if (finished) return;
    finished = true;
    ctx.emit({ type: "turn.finished", turnId, reason: next });
  };

  const remaining = (): number => start + totalMs - clock();
  const aborted = (): boolean => signal?.aborted === true;

  const gate = (stage: StageName): Gate => {
    if (aborted()) return "abort";
    const left = remaining();
    if ((stage === "investigate" || stage === "crossExam") && left < composeReserveMs) return "skip";
    if ((stage === "retrieve" || stage === "assess" || stage === "judge") && left <= 0) return "jump";
    return "run";
  };

  const skip = (stage: StageName): void => {
    ctx.emit({ type: "stage.started", stage });
    ctx.emit({ type: "stage.finished", stage, outcome: "skipped" });
    if (reason === "done") reason = "timeout";
  };

  const markError = (): void => {
    if (reason !== "aborted") reason = "error";
  };

  ctx.emit({ type: "turn.started", turnId });
  ctx.emit({
    type: "message.added",
    message: {
      id: `m${ctx.current.messages.length + 1}`,
      role: "user",
      text: input.message.text,
      at: ctx.now(),
      route: input.route,
      ...(input.message.attachments && input.message.attachments.length > 0
        ? { attachments: input.message.attachments }
        : {}),
    },
  });

  if (input.route !== "new_claim") {
    ctx.emit({ type: "error", stage: "route", message: "该路由尚未实现" });
    finish("error");
    return;
  }

  const goCompose = async (): Promise<void> => {
    if (aborted()) {
      finish("aborted");
      return;
    }
    try {
      draft = (await runCompose(ctx, {})).draft;
      assertInvariants(ctx.current);
    } catch (error) {
      if (aborted()) {
        finish("aborted");
        return;
      }
      ctx.emit({ type: "error", stage: "compose", message: errorMessage(error) });
      markError();
      draft = null;
    }
    if (aborted()) {
      finish("aborted");
      return;
    }
    try {
      const { report } = await runFinalize(ctx, { draft });
      assertInvariants(ctx.current);
      ctx.emit({
        type: "message.added",
        message: {
          id: `m${ctx.current.messages.length + 1}`,
          role: "assistant",
          text: report.conclusion,
          at: ctx.now(),
        },
      });
    } catch (error) {
      ctx.emit({ type: "error", stage: "finalize", message: errorMessage(error) });
      finish("error");
      return;
    }
    finish(reason);
  };

  const investigatorTools: InvestigatorTools = {
    search: deps.tools.search,
    fetch: deps.tools.fetch,
    ...(deps.tools.reverseImage ? { reverseImage: deps.tools.reverseImage } : {}),
    ...(deps.tools.recall ? { recall: deps.tools.recall } : {}),
  };

  let claimSource = input.message.text;
  const steps: { stage: StageName; wrap: boolean; run: () => Promise<void> }[] = [
    {
      stage: "intake",
      wrap: false,
      run: async () => {
        const result = await runIntake(ctx, {
          text: input.message.text,
          ...(input.message.attachments ? { attachments: input.message.attachments } : {}),
          tools: { fetch: deps.tools.fetch, vision: deps.tools.vision },
        });
        claimSource = result.claimSource;
      },
    },
    {
      stage: "decompose",
      wrap: false,
      run: async () => {
        await runDecompose(ctx, { claimSource });
      },
    },
    {
      stage: "retrieve",
      wrap: false,
      run: async () => {
        await runRetrieve(ctx, { providers: deps.searchProviders });
      },
    },
    {
      stage: "assess",
      wrap: false,
      run: async () => {
        await runAssess(ctx, {});
      },
    },
    {
      stage: "judge",
      wrap: true,
      run: async () => {
        await runJudge(ctx, {});
      },
    },
    {
      stage: "investigate",
      wrap: true,
      run: async () => {
        await runInvestigator(ctx, {
          role: "main",
          deadline,
          tools: investigatorTools,
        });
      },
    },
    {
      stage: "crossExam",
      wrap: false,
      run: async () => {
        await runCrossExam(ctx, {
          tools: investigatorTools,
          deadline,
          ...(deps.providers ? { providers: deps.providers } : {}),
        });
      },
    },
  ];

  try {
    for (const step of steps) {
      const decision = gate(step.stage);
      if (decision === "abort") {
        finish("aborted");
        return;
      }
      if (decision === "skip") {
        skip(step.stage);
        continue;
      }
      if (decision === "jump") {
        skip(step.stage);
        await goCompose();
        return;
      }
      try {
        if (step.wrap) ctx.emit({ type: "stage.started", stage: step.stage });
        await step.run();
        assertInvariants(ctx.current);
        if (step.wrap) ctx.emit({ type: "stage.finished", stage: step.stage, outcome: "ok" });
      } catch (error) {
        if (aborted()) {
          finish("aborted");
          return;
        }
        if (step.wrap) ctx.emit({ type: "stage.finished", stage: step.stage, outcome: "failed-open" });
        ctx.emit({ type: "error", stage: step.stage, message: errorMessage(error) });
        markError();
        await goCompose();
        return;
      }
    }
    await goCompose();
  } catch (error) {
    if (finished) return;
    if (aborted()) {
      finish("aborted");
      return;
    }
    ctx.emit({ type: "error", stage: "runner", message: errorMessage(error) });
    finish("error");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class EventStream implements AsyncIterable<CaseEvent> {
  private readonly queue: CaseEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  push(event: CaseEvent): void {
    this.queue.push(event);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  [Symbol.asyncIterator](): AsyncIterator<CaseEvent> {
    const self = this;
    let cancelled = false;
    return {
      async next() {
        if (cancelled) return { done: true, value: undefined };
        while (self.queue.length === 0 && !self.closed) {
          await new Promise<void>((resolve) => {
            self.waiters.push(resolve);
          });
          if (cancelled) return { done: true, value: undefined };
        }
        const value = self.queue.shift();
        if (value !== undefined) return { value, done: false };
        return { done: true, value: undefined };
      },
      async return() {
        cancelled = true;
        self.wake();
        return { done: true, value: undefined };
      },
    };
  }

  private wake(): void {
    const pending = this.waiters.splice(0);
    for (const resolve of pending) resolve();
  }
}
