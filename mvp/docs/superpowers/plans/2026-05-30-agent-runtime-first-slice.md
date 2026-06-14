# Agent Runtime First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current hard-coded Agent pipeline into the first slice of a reusable Agent Runtime without changing the visible product path.

**Architecture:** Add narrow runtime-facing modules for session state, events, tool metadata, and queue contracts. Keep existing HTTP/SSE handlers as the execution owner for this slice, but route their agent/tool event construction through shared helpers so Memory, Steering, Follow-up, and Tool Registry can attach later.

**Tech Stack:** React + TypeScript + Vite, Node-compatible TypeScript handlers, current StepFun/360/MiMo/DeepSeek provider adapters.

---

## File Structure

- Create `src/lib/agentRuntime/types.ts`: shared runtime data contracts for `AgentSession`, `AgentRuntimeEvent`, `AgentTool`, `SteeringMessage`, and `FollowUpTask`.
- Create `src/lib/agentRuntime/events.ts`: small event builders used by UI-facing code and backend stream handlers.
- Create `src/lib/agentRuntime/toolRegistry.ts`: declarative tool registry metadata for search, vision, link fetch, and memory tools.
- Modify `src/lib/agentConfigs.ts`: map existing `AgentContract.tools` onto registry ids where possible.
- Modify `server/src/handlers.ts` and `vite.config.ts`: use runtime event builders for StepFun Vision and search tool SSE events; preserve current execution order.
- Modify `docs/agent-system-architecture.md`: record this first runtime slice and remaining gaps.

## Task 1: Runtime Types

**Files:**
- Create: `src/lib/agentRuntime/types.ts`

- [ ] **Step 1: Add runtime contracts**

Create interfaces:

```ts
export type AgentRuntimePhase = "intake" | "memory_recall" | "agent" | "tool" | "handoff" | "report" | "memory_write" | "complete" | "error";

export type AgentToolRiskLevel = "read" | "write" | "publish";

export interface AgentSession {
  id: string;
  claim: string;
  createdAt: number;
  steeringQueue: SteeringMessage[];
  followUpQueue: FollowUpTask[];
}

export interface SteeringMessage {
  id: string;
  content: string;
  createdAt: number;
  consumedAt?: number;
}

export interface FollowUpTask {
  id: string;
  title: string;
  reason: string;
  status: "pending" | "running" | "completed" | "blocked";
  createdAt: number;
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  kind: "llm" | "search" | "vision" | "fetch" | "memory" | "report" | "canvas";
  riskLevel: AgentToolRiskLevel;
  requiresAuth: boolean;
  provider?: string;
}

export interface AgentRuntimeEvent {
  type: "agent_start" | "agent_complete" | "agent_error" | "tool_start" | "tool_result" | "tool_error" | "complete" | "error";
  timestamp: number;
  phase?: AgentRuntimePhase;
  agent?: string;
  agentName?: string;
  agentIcon?: string;
  toolId?: string;
  toolName?: string;
  query?: string;
  model?: string;
  output?: unknown;
  result?: unknown;
  error?: string;
  claim?: string;
  steps?: unknown[];
  finalReport?: unknown;
  totalLatencyMs?: number;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`

Expected: pass.

## Task 2: Event Builders

**Files:**
- Create: `src/lib/agentRuntime/events.ts`

- [ ] **Step 1: Add event builder functions**

Add `createToolStartEvent`, `createToolResultEvent`, `createToolErrorEvent`, `createAgentStartEvent`, `createAgentCompleteEvent`, `createAgentErrorEvent`.

Each function returns `AgentRuntimeEvent` and always fills `timestamp` and `phase`.

- [ ] **Step 2: Use only for new/refactored stream events**

Do not rewrite every event in the product yet. In this first slice, use the builders for:

- StepFun Vision `tool_start/tool_result/tool_error`
- search `tool_start/tool_result/tool_error`

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

Expected: pass.

## Task 3: Tool Registry Metadata

**Files:**
- Create: `src/lib/agentRuntime/toolRegistry.ts`
- Modify: `src/lib/agentConfigs.ts`

- [ ] **Step 1: Add registry**

Create exported `AGENT_TOOL_REGISTRY: Record<string, AgentTool>` with at least:

- `stepfun_vision`
- `link_fetch`
- `parallel_search`
- `search360`
- `anysearch`
- `metaso`
- `tavily`
- `exa`
- `memory_search`
- `memory_write`
- `fire_confidence`
- `closure_actions`

- [ ] **Step 2: Wire config ids**

Where `AgentContract.tools` already names these capabilities, align ids to registry ids. Do not remove existing descriptions.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

Expected: pass.

## Task 4: Handler Integration

**Files:**
- Modify: `server/src/handlers.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Import event builders**

Use relative imports that work in each file:

- `server/src/handlers.ts` should import from `../../src/lib/agentRuntime/events.js` if TypeScript allows it in the server build.
- `vite.config.ts` should import from `./src/lib/agentRuntime/events`.

If the server import creates build friction, keep handlers local and document the duplication; do not destabilize the build.

- [ ] **Step 2: Replace duplicated event object literals for tools**

Replace only tool SSE object literals in the orchestrate stream path with event builders. Keep execution logic unchanged.

- [ ] **Step 3: Verify**

Run:

```bash
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass.

## Task 5: Architecture Note

**Files:**
- Modify: `docs/agent-system-architecture.md`

- [ ] **Step 1: Add section**

Add “Agent Runtime First Slice” with:

- what is now explicit
- what is still not implemented
- why Steering Queue and Follow-up Queue are contracts only in this slice

- [ ] **Step 2: Verify docs are discoverable**

Run: `rg -n "Agent Runtime First Slice|steeringQueue|followUpQueue" docs src`

Expected: at least the plan, architecture doc, and runtime types show up.

## Final Verification

- [ ] Run `npx tsc --noEmit`
- [ ] Run `npm run build`
- [ ] Run `git diff --check`
- [ ] Confirm homepage/runtime behavior remains unchanged except for visible cleanup already requested by the user.
