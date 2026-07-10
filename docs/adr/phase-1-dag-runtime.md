# Phase 1 Plan: DAG Runtime Core

## Goal

Build a DAG execution engine that replaces the hardcoded `runCase()` pipeline.
The existing 4-Agent flow must be expressible as a DAG and produce identical output.

## Files to Create

| File | Purpose |
|------|---------|
| `mvp/src/lib/dag/dag.ts` | Core DAG types + topological executor |
| `mvp/src/lib/dag/registry.ts` | Agent registry (declarative agent registration) |
| `mvp/src/lib/dag/executor.ts` | DagExecutor — bridges registry + DAG + runtime deps |

## Files to Modify

| File | Change |
|------|--------|
| `mvp/src/lib/agentRuntime/AgentRuntime.ts` | Replace hardcoded `runCase()` with DAG-based execution |
| `mvp/src/lib/agentConfigs.ts` | Register agents in the new registry |

## Design Decisions

### DAG Node
Each node represents one agent execution:
```typescript
interface DagNode {
  id: string;
  agentId: string;
  after: string[];        // dependency: must run after these nodes
  parallel: boolean;      // can run in parallel with siblings
}
```

### Execution Strategy
- Topological sort to determine execution order
- Nodes at the same depth with `parallel: true` run concurrently via `Promise.all()`
- Nodes with `parallel: false` run sequentially after their dependencies
- Agent failure: use existing `canContinueAfterAgentFailure` policy

### Agent Registry
- Simple Map<string, AgentConfig> — register once, lookup by id
- Runtime only needs `registry.get(agentId)` to find agent definition
- Adding a new agent = one `registry.register(newAgentConfig)` call

### Backward Compatibility
- `AgentRuntime.runCase()` keeps the same signature
- Internally builds a DAG from the existing pipeline and executes it
- Output format unchanged (same `AgentRuntimeRunResult`)

## Success Criteria

- The 4-Agent pipeline produces identical results when executed via DAG vs hardcoded
- Adding a new agent to the pipeline requires zero changes to the executor
- All existing tests pass
