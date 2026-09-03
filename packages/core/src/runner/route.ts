import { Type, type Static } from "typebox";
import type { Case } from "../casefile/schema.js";
import type { LlmJob } from "../stages/context.js";
import { parseJobOutput } from "../stages/parseOutput.js";

export const ROUTE_JOB = "route";

const closed = { additionalProperties: false } as const;

export const RouteOutputSchema = Type.Object(
  {
    route: Type.Union([
      Type.Literal("new_claim"),
      Type.Literal("ask_case"),
      Type.Literal("off_topic"),
    ]),
  },
  closed,
);

export type RouteOutput = Static<typeof RouteOutputSchema>;

export type RouteKind = "new_claim" | "pursue_frontier" | "ask_case" | "challenge" | "off_topic";

export type RouteMessage = {
  text: string;
  pivotId?: string;
};

export const ROUTE_SYSTEM_PROMPT = `把用户这句话归类为三种之一：
- new_claim：提出了要核验的新说法
- ask_case：在问本案已有材料、判决或出处
- off_topic：与本案无关
只输出 JSON：{"route":"new_claim"|"ask_case"|"off_topic"}。不要判断真假。`;

export function urlsInText(text: string): string[] {
  return [...(text.match(/https?:\/\/[^\s<>"']+/gi) ?? [])].map((url) => url.replace(/[.,;:!?)]+$/, ""));
}

export function firstUrlInText(text: string): string | undefined {
  return urlsInText(text)[0];
}

export async function routeMessage(current: Case, message: RouteMessage, llm: LlmJob): Promise<RouteKind> {
  if (message.pivotId) return "pursue_frontier";
  if (current.claims.length === 0) return "new_claim";
  if (firstUrlInText(message.text)) return "challenge";
  try {
    const result = await llm({
      job: ROUTE_JOB,
      systemPrompt: ROUTE_SYSTEM_PROMPT,
      userContent: `用户：${message.text}\n本案命题数：${current.claims.length}`,
      responseSchema: RouteOutputSchema,
    });
    const parsed = parseJobOutput(RouteOutputSchema, result.output);
    if (!parsed.ok) return "new_claim";
    return parsed.value.route;
  } catch {
    return "new_claim";
  }
}
