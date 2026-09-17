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
