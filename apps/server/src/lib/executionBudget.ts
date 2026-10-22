/** A deadline owns the whole operation, including response bodies and repair attempts. */
export type ExecutionBudget = {
  signal?: AbortSignal;
  deadlineMs?: number;
};

export class ExecutionTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} 超时 ${Math.max(0, Math.round(timeoutMs))}ms`);
    this.name = "TimeoutError";
  }
}

export async function withExecutionBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: ExecutionBudget & { timeoutMs: number; label: string },
): Promise<T> {
  options.signal?.throwIfAborted();
  const remaining = Math.min(options.timeoutMs, (options.deadlineMs ?? Infinity) - Date.now());
  if (remaining <= 0) throw new ExecutionTimeoutError(options.label, remaining);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new ExecutionTimeoutError(options.label, remaining)),
    remaining,
  );
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    controller.signal.throwIfAborted();
    const result = await Promise.race([work(controller.signal), aborted]);
    // An adapter that ignored cancellation must not publish a late result.
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

/** 环境变量里的毫秒数；没配或不是正数时用默认值。 */
export function getTimeoutMs(env: Record<string, string>, key: string, fallbackMs: number) {
  const raw = env[key] || process.env[key];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} 超时 ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
