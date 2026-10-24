/**
 * An agent job is everything one model call of the pipeline needs: its identity, prompt, output schema,
 * how its input is built from the case so far, and how its raw output is read.
 */
import { formatSkillsForPrompt, selectAgentSkills } from "../agentSkills.js";
import { attachKnowledgeDrafts, type AtomSearchBundle } from "../atomSearch.js";
import { buildAgentStatusBar } from "../contextStatusBar.js";
import { callJson } from "../providerRouter.js";
import { compactSearchResultForAgent } from "../searchProviders.js";

export interface PriorStep {
  agent: string;
  output?: Record<string, unknown>;
  relationAuditCandidates?: unknown[];
}

/** What the case knows when a job runs. */
export interface JobInput {
  claim: string;
  steps: PriorStep[];
  intakeMetadata?: unknown;
  visualExtraction?: Record<string, unknown>;
  memoryRecall?: { hitCount?: number };
  priorRoundContext?: unknown;
  search360Result?: unknown;
  atomSearchBundle?: AtomSearchBundle | null;
}

export interface AgentJob {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  schema: object;
  maxTokens: number;
  buildInput(c: JobInput): Record<string, unknown>;
  readOutput(raw: Record<string, unknown>): Record<string, unknown>;
}

export interface JobCall {
  input: Record<string, unknown>;
  systemPrompt: string;
  userContent: string;
}

export interface JobBudget {
  env: Record<string, string>;
  signal?: AbortSignal;
  deadlineMs?: number;
}

/** Material the user supplied, shared by every job. */
export function contextInput(c: JobInput): Record<string, unknown> {
  return {
    ...(c.intakeMetadata ? { intake: c.intakeMetadata } : {}),
    ...(c.visualExtraction ? { visualExtraction: c.visualExtraction } : {}),
    ...(c.memoryRecall ? { memoryRecall: c.memoryRecall } : {}),
    ...(c.priorRoundContext
      ? {
          priorRoundContext: {
            policy: "仅用于理解此前对话，不是本轮已核实证据；本轮事实判断必须依据本轮检索并审核的材料。",
            previous: c.priorRoundContext,
          },
        }
      : {}),
  };
}

/** Retrieved material, for the jobs that judge evidence. */
export function searchInput(c: JobInput): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (c.search360Result) {
    input.search360 = compactSearchResultForAgent(c.search360Result as any);
    if (c.atomSearchBundle) input.atomSearches = c.atomSearchBundle.forAgent;
  }
  attachKnowledgeDrafts(input, c.atomSearchBundle);
  return input;
}

/** Prefer rumor_detector stanceClaimType; default mixed for skill routing. */
function claimTypeOf(steps: PriorStep[]): string {
  const stance = steps.find((s) => s.agent === "rumor_detector")?.output?.stanceClaimType as { type?: string } | undefined;
  return typeof stance?.type === "string" && stance.type.length > 0 ? stance.type : "mixed";
}

export function buildJobCall(job: AgentJob, c: JobInput): JobCall {
  const input = job.buildInput(c);
  const claimType = claimTypeOf(c.steps);
  const statusBar = buildAgentStatusBar({
    agentId: job.id,
    agentName: job.name,
    claim: c.claim,
    claimType,
    stepIndex: c.steps.length + 1,
    totalStepsHint: 4,
    tools: [],
    memoryHitCount: c.memoryRecall?.hitCount ?? 0,
    searchReady: Boolean(c.search360Result),
  });
  input.agentStatusBar = statusBar.text;
  input.agentStatusFields = statusBar.fields;
  const skills = selectAgentSkills({ agentId: job.id, claimType, maxSkills: 3 });
  input.loadedSkills = skills.map((s) => s.id);
  return {
    input,
    systemPrompt: `${job.prompt}${formatSkillsForPrompt(skills)}`,
    userContent: `${statusBar.text}\n\n${JSON.stringify(input, null, 2)}`,
  };
}

/** `raw` is the schema-checked model output; `output` is what the pipeline reads. */
export async function runJob(job: AgentJob, call: JobCall, budget: JobBudget) {
  const result = await callJson({
    agentId: job.id,
    system: call.systemPrompt,
    user: call.userContent,
    schema: job.schema,
    maxTokens: job.maxTokens,
    ...budget,
  });
  return { raw: result.output as Record<string, unknown>, output: job.readOutput(result.output), model: result.model, reasoning: result.reasoning };
}
