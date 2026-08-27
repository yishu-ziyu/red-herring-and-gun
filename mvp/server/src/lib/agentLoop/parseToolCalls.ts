import type { ToolCall } from "./types.js";

const XML_BLOCK =
  /<tool_call>\s*<name>\s*([^<]+?)\s*<\/name>\s*<arguments>\s*([\s\S]*?)\s*<\/arguments>\s*<\/tool_call>/gi;

function parseArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const value = JSON.parse(trimmed);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { value };
  } catch {
    return { raw: trimmed };
  }
}

function callId(name: string, index: number): string {
  return `${name}_${index + 1}`;
}

/** Parse XML tool blocks from model text. Native toolCalls on the turn win if present. */
export function parseToolCalls(text: string): ToolCall[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const out: ToolCall[] = [];
  XML_BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_BLOCK.exec(text)) !== null) {
    const name = match[1]?.trim();
    if (!name) continue;
    out.push({
      id: callId(name, out.length),
      name,
      arguments: parseArgs(match[2] ?? ""),
    });
  }
  return out;
}

export function mergeToolCalls(turn: { text?: string; toolCalls?: ToolCall[] }): ToolCall[] {
  if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
    return turn.toolCalls.map((call, index) => ({
      id: call.id || callId(call.name, index),
      name: call.name,
      arguments: call.arguments && typeof call.arguments === "object" ? call.arguments : {},
    }));
  }
  return parseToolCalls(turn.text ?? "");
}
