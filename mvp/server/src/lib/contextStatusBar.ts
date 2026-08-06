/**
 * contextStatusBar.ts — AI Agent Book Ch.2 上下文工程：Agent 状态栏（server copy）
 *
 * Keep in sync with src/lib/agentRuntime/contextStatusBar.ts (client/AgentRuntime).
 * Server cannot import client src (tsconfig rootDir); copy is intentional (ADR-004).
 */

export interface AgentStatusBarInput {
  agentId: string;
  agentName: string;
  claim: string;
  claimType?: string;
  stepIndex: number;
  totalStepsHint?: number;
  tools: Array<{ id: string; name: string; kind?: string }>;
  memoryHitCount?: number;
  acceptedCandidateCount?: number;
  searchReady?: boolean;
  steeringCount?: number;
  failurePolicy?: string;
  now?: Date;
}

export interface AgentStatusBar {
  /** 稳定前缀（时区/角色），利于 KV-cache 命中 */
  prefix: string;
  /** 本步变化的动态行 */
  dynamic: string;
  /** 合并后的短文本，直接塞进 user content */
  text: string;
  /** 结构化字段，便于评测与 SSE 透出 */
  fields: Record<string, string | number | boolean>;
}

function formatClock(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function buildAgentStatusBar(input: AgentStatusBarInput): AgentStatusBar {
  const now = input.now ?? new Date();
  const toolNames = input.tools
    .map((t) => t.name || t.id)
    .filter(Boolean)
    .slice(0, 8);
  const claimPreview =
    input.claim.length > 80 ? `${input.claim.slice(0, 80)}…` : input.claim;

  const prefix = [
    `[Agent Status]`,
    `role=${input.agentName}(${input.agentId})`,
    `tz=Asia/Shanghai`,
  ].join(" ");

  const dynamicParts = [
    `time=${formatClock(now)}`,
    `step=${input.stepIndex}${input.totalStepsHint ? `/${input.totalStepsHint}` : ""}`,
    input.claimType ? `claimType=${input.claimType}` : null,
    `claim="${claimPreview}"`,
    `tools=[${toolNames.join(", ") || "none"}]`,
    `memoryHits=${input.memoryHitCount ?? 0}`,
    `acceptedSkills=${input.acceptedCandidateCount ?? 0}`,
    `searchReady=${input.searchReady ? "yes" : "no"}`,
    `steering=${input.steeringCount ?? 0}`,
  ].filter(Boolean);

  if (input.failurePolicy) {
    dynamicParts.push(`failPolicy=${input.failurePolicy.slice(0, 60)}`);
  }

  const dynamic = dynamicParts.join(" | ");
  const text = `${prefix}\n${dynamic}`;

  return {
    prefix,
    dynamic,
    text,
    fields: {
      agentId: input.agentId,
      agentName: input.agentName,
      time: formatClock(now),
      stepIndex: input.stepIndex,
      claimType: input.claimType ?? "unknown",
      memoryHitCount: input.memoryHitCount ?? 0,
      acceptedCandidateCount: input.acceptedCandidateCount ?? 0,
      searchReady: Boolean(input.searchReady),
      steeringCount: input.steeringCount ?? 0,
      toolCount: toolNames.length,
    },
  };
}
