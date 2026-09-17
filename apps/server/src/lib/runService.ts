/**
 * runService — 一次调查的身份、幂等与取消（IMPLEMENTATION_PLAN §5.2、§5.5）。
 *
 * 解决的三个具体问题：
 *   1. 双击提交会开两条管线、扣两次额度 —— 同一身份 + 同一 clientRequestId 只认一条 run。
 *   2. 用户点「停止」原本只是前端不管结果，服务端照跑照烧 —— 现在有真 AbortSignal。
 *   3. 同一份请求重放成两份 run —— payload 不同就明确冲突，不静默复用。
 *
 * signal 由编排适配层传到模型、检索及响应流，阶段边界同时检查以阻止迟到写入。
 * 请求中止不代表供应商停止计算或退款；这里仅维护本地运行状态与取消身份。
 *
 * 持久化是可选的：没有可用 SQLite 时退化成进程内注册表（重启即丢状态），
 * 但取消与幂等在本次进程内仍然成立。
 */
import { createHash, randomUUID } from "node:crypto";
import { isTerminalStatus, type RunRecord, type RunStatus, type RunStore } from "./runStore.js";
import type { PublicActivity } from "./investigation/index.js";

type PublicActivityLike = PublicActivity;

export type StartRunInput = {
  caseId: string;
  ownerHash?: string | null;
  clientRequestId?: string | null;
  /** 归一化后的输入指纹；用来判断同一 clientRequestId 是不是同一份请求。 */
  inputHash?: string | null;
  now?: number;
};

export type StartRunResult =
  | { kind: "created"; run: RunRecord }
  | { kind: "existing"; run: RunRecord }
  | { kind: "conflict"; existing: RunRecord };

export type CancelResult =
  | { kind: "cancelling"; run: RunRecord }
  | { kind: "already-terminal"; run: RunRecord }
  | { kind: "not-found" };

export function hashRunInput(claim: string, extras: Record<string, unknown> = {}): string {
  return createHash("sha256").update(`${claim}\u0000${JSON.stringify(extras)}`).digest("hex").slice(0, 32);
}

type ActiveRun = {
  controller: AbortController;
  status: RunStatus;
};

/** 流上已经发出去的一帧；重连时用来补发。 */
export type RunEvent = Record<string, unknown>;

export type RunService = ReturnType<typeof createRunService>;

export function createRunService(options: { store?: RunStore | null; now?: () => Date | number } = {}) {
  const store = options.store ?? null;
  const nowRaw = options.now ?? (() => Date.now());
  const now = () => (typeof nowRaw() === "number" ? (nowRaw() as number) : (nowRaw() as Date).getTime());
  // 进程内活体注册表：signal 与「当前是不是真在跑」只有活着的进程知道。
  const active = new Map<string, ActiveRun>();
  // 没有 SQLite 时的记录表，键是 runId。
  const memory = new Map<string, RunRecord>();
  const memoryByIdempotency = new Map<string, string>();
  // 直播订阅：重连时接上同一只 run 后续的帧，不再开第二条管线。
  const subscribers = new Map<string, Set<(event: RunEvent) => void>>();

  function idempotencyKey(ownerHash: string | null, clientRequestId: string): string {
    return `${ownerHash ?? "\u0000anonymous"}\u0000${clientRequestId}`;
  }

  function lookup(ownerHash: string | null, clientRequestId: string): RunRecord | null {
    if (store) return store.findByIdempotencyKey(ownerHash, clientRequestId);
    const runId = memoryByIdempotency.get(idempotencyKey(ownerHash, clientRequestId));
    return runId ? memory.get(runId) ?? null : null;
  }

  function read(runId: string): RunRecord | null {
    if (store) return store.get(runId);
    return memory.get(runId) ?? null;
  }

  function write(run: RunRecord): void {
    if (store) return;
    memory.set(run.runId, run);
    if (run.clientRequestId) memoryByIdempotency.set(idempotencyKey(run.ownerHash, run.clientRequestId), run.runId);
  }

  return {
    /** 供测试与运维查看：当前进程里有几条在跑。 */
    activeCount: () => active.size,
    signalFor: (runId: string): AbortSignal | undefined => active.get(runId)?.controller.signal,

    /**
     * 建 run。同一身份 + 同一 clientRequestId：
     *   - 输入指纹相同 → 返回既有 run（不新建、不再扣额）；
     *   - 输入指纹不同 → 返回 conflict，由 HTTP 层翻成 409。
     */
    start(input: StartRunInput): StartRunResult {
      const ownerHash = input.ownerHash ?? null;
      const clientRequestId = input.clientRequestId ?? null;
      const at = input.now ?? now();

      if (clientRequestId) {
        const existing = lookup(ownerHash, clientRequestId);
        if (existing) {
          const sameInput =
            !input.inputHash || !existing.inputHash || input.inputHash === existing.inputHash;
          return sameInput ? { kind: "existing", run: existing } : { kind: "conflict", existing };
        }
      }

      const runId = randomUUID();
      const run: RunRecord = {
        runId,
        caseId: input.caseId,
        ownerHash,
        clientRequestId,
        inputHash: input.inputHash ?? null,
        status: "accepted",
        revision: 0,
        snapshot: null,
        lastSeq: 0,
        createdAt: at,
        updatedAt: at,
      };
      if (store) {
        try {
          store.create({
            runId,
            caseId: input.caseId,
            ownerHash,
            clientRequestId,
            inputHash: input.inputHash ?? null,
            now: at,
          });
        } catch (error) {
          // UNIQUE(ownerHash, clientRequestId) 撞了：说明并发下另一个请求刚建好同一条。
          const raced = clientRequestId ? lookup(ownerHash, clientRequestId) : null;
          if (raced) {
            const sameInput =
              !input.inputHash || !raced.inputHash || input.inputHash === raced.inputHash;
            return sameInput ? { kind: "existing", run: raced } : { kind: "conflict", existing: raced };
          }
          throw error;
        }
      } else {
        write(run);
      }
      active.set(runId, { controller: new AbortController(), status: "accepted" });
      return { kind: "created", run: read(runId) ?? run };
    },

    /** 推进运行状态；终态不可逆。 */
    advance(runId: string, status: RunStatus): boolean {
      const current = read(runId);
      if (!current || isTerminalStatus(current.status)) return false;
      if (store) {
        const changed = store.setStatus(runId, status, now());
        if (changed) {
          const live = active.get(runId);
          if (live) live.status = status;
        }
        return changed;
      }
      const next: RunRecord = { ...current, status, updatedAt: now() };
      write(next);
      const live = active.get(runId);
      if (live) live.status = status;
      return true;
    },

    /**
     * 取消：abort signal，状态进 cancelling，等待执行层清理后落 cancelled。
     * 终态再调无副作用；底层响应与重试共享取消信号。
     */
    cancel(runId: string): CancelResult {
      const current = read(runId);
      if (!current) return { kind: "not-found" };
      if (isTerminalStatus(current.status)) return { kind: "already-terminal", run: current };
      const live = active.get(runId);
      if (live && !live.controller.signal.aborted) {
        live.controller.abort(new Error("cancelled-by-user"));
      }
      this.advance(runId, "cancelling");
      return { kind: "cancelling", run: read(runId) ?? current };
    },

    /**
     * 管线收尾：清掉活体注册表，落终态。
     *
     * 一条硬规矩：用户已经点了停止（cancelling），就不把这次调查报成 completed——
     * 管线可能刚好在写最后一份报告，但“已完成”是用户没要求的结论。
     * 供应商未必能硬断在途请求，这条守卫只管state 不撒谎。
     */
    finish(runId: string, status: RunStatus): void {
      active.delete(runId);
      const current = read(runId);
      if (!current || isTerminalStatus(current.status)) return;
      const resolved: RunStatus = current.status === "cancelling" && status === "completed" ? "cancelled" : status;
      this.advance(runId, resolved);
    },

    get: read,

    /** 把一帧广播给所有订阅者；没有人听也不报错。 */
    publish(runId: string, event: RunEvent): void {
      const listeners = subscribers.get(runId);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          listeners.delete(listener);
        }
      }
    },

    /** 订阅后续帧；返回退订函数。 */
    subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
      const listeners = subscribers.get(runId) ?? new Set();
      listeners.add(listener);
      subscribers.set(runId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && !active.has(runId)) subscribers.delete(runId);
      };
    },

    /** 重连用：先补 afterSeq 之后的活动，再返回退订函数。 */
    replayActivities(runId: string, afterSeq: number): PublicActivityLike[] {
      if (!store) return [];
      return store.listActivities(runId, afterSeq);
    },

    /** 进程重启：未完成的 run 标 interrupted，中间快照保留。 */
    markInterruptedOnBoot(): number {
      return store ? store.markInterruptedOnBoot(now()) : 0;
    },
  };
}
