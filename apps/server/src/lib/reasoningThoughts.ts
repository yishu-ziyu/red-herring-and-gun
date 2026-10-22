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

