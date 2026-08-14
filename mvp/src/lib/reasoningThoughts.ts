/**
 * Shared reasoning-sentence helpers for agent_thought SSE and ThinkingReasoning UI.
 * Source of truth: model reasoning text only — never invent sentences on the client.
 */

/** Split model reasoning into display sentences (CN/EN punctuation + newlines). */
export function splitReasoningSentences(reasoning: string): string[] {
  const trimmed = (reasoning ?? "").trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

/** Closed sentences plus the unfinished tail — used while thinking is still streaming. */
export function splitReasoningLive(reasoning: string): { closed: string[]; tail: string } {
  const trimmed = (reasoning ?? "").trim();
  if (!trimmed) return { closed: [], tail: "" };
  const pieces = trimmed.split(/(?<=[。！？!?；;\n])/);
  const closed: string[] = [];
  let tail = "";
  for (let i = 0; i < pieces.length; i++) {
    const part = pieces[i].trim();
    if (!part) continue;
    const isLast = i === pieces.length - 1;
    const closedEnd = /[。！？!?；;\n]$/.test(pieces[i]);
    if (isLast && !closedEnd) tail = part;
    else closed.push(part);
  }
  return { closed, tail };
}

export function createLiveThoughtPump(
  emit: (content: string, seq: number, partial: boolean) => void
) {
  let closedCount = 0;
  let lastTail = "";
  let didEmit = false;
  const push = (accumulated: string) => {
    const { closed, tail } = splitReasoningLive(accumulated);
    while (closedCount < closed.length) {
      emit(closed[closedCount], closedCount, true);
      closedCount += 1;
      didEmit = true;
    }
    if (tail && tail !== lastTail) {
      emit(tail, closedCount, true);
      lastTail = tail;
      didEmit = true;
    }
  };
  return {
    get didEmit() {
      return didEmit;
    },
    push,
    finish(accumulated?: string) {
      if (accumulated) push(accumulated);
    },
  };
}

/**
 * Inter-sentence delay when replaying a finished reasoning block over SSE.
 * Keeps total reveal roughly 1.5–4s so UI can animate without inventing text.
 */
export function thoughtInterSentenceDelayMs(sentenceCount: number): number {
  const n = Math.max(1, sentenceCount);
  if (n <= 1) return 0;
  // ~2.4s budget for the whole replay, clamped per gap
  return Math.min(900, Math.max(180, Math.round(2400 / (n - 1))));
}

/** Format wall-clock reasoning duration for "推理用时 Ns". */
export function formatThoughtElapsedLabel(elapsedMs?: number): string {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return "…";
  const s = elapsedMs / 1000;
  if (s < 1) return "1s";
  return `${s >= 10 ? Math.round(s) : s.toFixed(1)}s`;
}

/** Flatten real agent_thought sentences in stream order. Never invents copy. */
export function collectReasoningSentences(
  items: Array<{ reasoning?: string[] }> | null | undefined
): string[] {
  if (!items || items.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const line of item.reasoning ?? []) {
      const text = line.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}
