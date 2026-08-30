/**
 * reasoningThoughts.ts — agent_thought SSE 流式思考句工具（server 侧自持，不再跨层引前端 lib）。
 * Source of truth: model reasoning text only — never invent sentences.
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
