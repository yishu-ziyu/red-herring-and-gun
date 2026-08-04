# Phase 1 Plan: DAG Runtime Core

> 状态更新（2026-08-04）：已实现。实现路径与计划不同——未新建 `mvp/src/lib/dag/` 目录，而是把 DAG 执行逻辑直接并入 `AgentRuntime.ts` 的 `executeDag()`，声明式注册表并入 `agentConfigs.ts` 的 `AgentRegistry`。见下方"实现差异"。

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

## 实现差异（2026-08-04）

计划中的三个新文件未按原样创建，逻辑落在既有文件内：

| 计划 | 实际 |
|------|------|
| `mvp/src/lib/dag/dag.ts` | DAG 类型在 `agentOrchestrationTypes.ts`（`ExecutionDagPlan` / `ExecutionDagNode` / `ExecutionDagEdge`） |
| `mvp/src/lib/dag/registry.ts` | `AgentRegistry` 并入 `agentConfigs.ts`（`getAgentRegistry()` 单例） |
| `mvp/src/lib/dag/executor.ts` | `AgentRuntime.executeDag()` 内联执行，`topologicalLevels()` 做分层拓扑排序 |

补充设计决策：

- 节点增加 `type` 字段（`planner` / `agent` / `debate` / `report`），`ExecutionDagNode` 上的 `type` 为可选，避免前端 mock 节点报错。
- 搜索作为共享材料：`ensureSearch()` 在首个消费它的 agent 节点前准备一次，注入下游，不重复发起。
- 未注册 agent 节点（concept 三节点）标记 skipped 并 emit 可见事件，不中断执行。
- 失败策略：`CONTINUE_AFTER_FAILURE_AGENTS` 声明可选/并行 enrichment Agent 失败后可继续，其余失败阻断。
- 新增 `dag_exec` / `agent_registry` 两级日志，走既有 `deps.log` 通道。
