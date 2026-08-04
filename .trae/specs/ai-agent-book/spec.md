# 兑现 Agent 架构：DAG 运行时落地 Spec

## Why

项目对 Agent 的理解已经成熟——Agent 是"有契约、有边界、可观察、可审计、可交接"的角色，DAG 应该决定执行路径，工具应由 Agent 自主选择。这些理解沉淀在 `agent-system-architecture.md`、`AGENT_CONTRACTS` 与已批准的 ADR-001 中。

但运行时并没有兑现这份理解：`AgentRuntime.runCase()` 用 `if (executionPlan.claimType === ...)` 走四个硬编码 pipeline 方法，`buildAdaptiveExecutionPlan()` 生成的 DAG 只被 emit 给 UI 展示，从不驱动执行。`runEventPipeline` 与 `runMixedPipeline` 甚至直接复用 `runStandardPipeline`，DAG 中声明的分支是摆设。本轮把 DAG 变成运行时真相，兑现架构的框架本体。

## What Changes

- 给 `ExecutionDagNode` 增加 `type` 字段（`planner | agent | debate | report`），`buildAdaptiveExecutionPlan()` 输出完整、类型化的节点。
- 新增声明式 Agent 注册表：从 `AGENT_CONFIGS` 构建 `AgentId -> AgentConfig + 失败策略`，支持按 id 取配置、判断 Agent 失败后是否可继续。
- 新增 DAG 执行引擎：按 DAG 的拓扑顺序执行节点，无依赖的 agent 节点并行，debate 节点汇总前序输出，report 节点收束；搜索作为共享材料在消费它的 agent 节点前准备。
- 把 `runCase()` 的四个 claimType 分支改写为一次 `executeDag()` 调用，保留 planner 阶段、memory recall、vision、report 收束、memory write 与全部事件契约。
- **不破坏**：前端事件契约（`planner_update` / `agent_*` / `tool_*` / `consensus_debate_*` / `speculative_update`）、现有行为语义、`runAgent()` 单 Agent 执行器。

## Impact

- Affected specs：Agent 契约、运行时编排、可审计轨迹（Agent Contract / DAG / trace）。
- Affected code（均在 `mvp/`）：
  - `src/lib/agentOrchestrationTypes.ts` —— 节点类型化
  - `src/lib/agentRuntime/AgentRuntime.ts` —— 执行引擎 + runCase 迁移（核心）
  - `src/lib/agentConfigs.ts` —— 注册表构建（消费现有 `AGENT_CONFIGS`）
  - 相关测试：`agentRuntime` 相关 `.test.ts`，新增 `executeDag` 测试
- 前端：不涉及（`MissionControlView.tsx` 依赖的 DAG 结构与事件契约保持不变）。

## ADDED Requirements

### Requirement: DAG 节点类型化

系统 SHALL 为每个 DAG 节点标注执行类型，使执行引擎能按类型分发节点。

- `ExecutionDagNode` 增加 `type: "planner" | "agent" | "debate" | "report"`。
- agent 节点通过现有 `agent` 字段绑定 `agentId`。
- `buildAdaptiveExecutionPlan()` 生成的每个节点都带 `type`；`planner` 类型对应 `planner` 节点，有 `agent` 字段的节点为 `agent` 类型，`consensus_debate` 节点为 `debate` 类型，`report_composer` 节点为 `report` 类型。

#### Scenario: 所有 claim 类型的 DAG 节点均带类型
- **WHEN** 对 concept / causal / event / mixed 任一输入调用 `buildAdaptiveExecutionPlan()`
- **THEN** 返回的每个 `nodes[i]` 都具有合法 `type`，且 `agent` 类型节点绑定了已注册的 `agentId`

### Requirement: 声明式 Agent 注册表

系统 SHALL 提供按 id 读取 Agent 配置与失败策略的注册表，取代散落的硬编码查找。

- 从 `AGENT_CONFIGS` 构建 `AgentRegistry`，键为 `agentId`。
- 提供：按 id 获取 `AgentConfig`；判断某 Agent 失败后是否可继续（迁移 `canContinueAfterAgentFailure` 的语义）。
- 对未注册的 agentId（如 concept 的 `concept_extractor` / `semantic_validator` / `context_mapper`），注册表返回"未注册"，执行引擎将其标记为 `skipped` 而非崩溃。

#### Scenario: 添加新 Agent 无需改编排核心
- **WHEN** 新增一个 Agent 时
- **THEN** 只需在 `AGENT_CONFIGS` 中声明，并在 DAG 中声明节点，执行引擎即可按 id 执行，无需修改 `runCase` 的 if-else 分支

### Requirement: DAG 执行引擎

系统 SHALL 依据 DAG 的节点与边驱动执行，而非 claimType 的 if-else。

- 对 DAG 做拓扑排序，按依赖顺序执行节点。
- 无相互依赖的 agent 节点并行执行（`Promise.all`）。
- `debate` 节点：读取其依赖的 agent 节点输出，生成共识调解（复用现有 `buildConsensusDebate` / `buildCausalConsensusDebate` 语义）。
- `report` 节点：执行 `report_composer` 收束。
- 搜索作为共享材料：在首个消费它的 agent 节点前准备一次 `searchResult`，注入下游 agent 节点（复用现有 `deps.getSearchForClaim` 与压缩逻辑）。
- 未注册的 agent 节点标记为 `skipped` 并 emit 可见事件，不中断执行。

#### Scenario: 事件型 claim 按 DAG 执行
- **WHEN** 输入 event 型 claim，引擎执行对应 DAG
- **THEN** 依次执行 `rumor_detector` → 并行 `fact_checker` + `source_validator` → `consensus_debate` → `report_composer`，与当前行为的 Agent 顺序一致

#### Scenario: 因果型 claim 追加分支
- **WHEN** 输入 causal 型 claim，引擎执行对应 DAG
- **THEN** 在 `fact_checker` 后并行追加 `alternative_explanation_searcher` + `counter_evidence_grader`，再由 `consensus_debate` 汇总，顺序与当前 `runCausalPipeline` 一致

#### Scenario: 概念型 claim 收束不搜证
- **WHEN** 输入 concept 型 claim，引擎执行对应 DAG
- **THEN** 不执行事实搜证，未注册的 concept 节点标记 `skipped`，`report_composer` 直接收束，行为与当前 `runConceptPipeline` 一致

## MODIFIED Requirements

### Requirement: runCase 由 DAG 驱动

`AgentRuntime.runCase()` 的四个 claimType 分支被替换为一次 `executeDag()` 调用，行为与事件契约保持不变。

- 保留：planner 阶段（`planner_update`）、memory recall、vision 图片解析、report 收束、`applyRuleBasedConfidence`、memory write、follow-ups。
- 保留：全部事件契约（`agent_start` / `agent_complete` / `agent_error` / `tool_*` / `consensus_debate_*` / `speculative_update`）。
- 保留：`runAgent()` 作为单 Agent 执行器，其 input 构造（memoryRecall 投影、search 压缩、steering）不变。

## 后续阶段（本轮不实现，仅记录）

- concept 三个未注册 agent（`concept_extractor` / `semantic_validator` / `context_mapper`）—— 本轮标记 `skipped`，实现属能力扩展，另立 spec。
- 工具由 LLM 自主选择（function calling，ADR-001 Phase 2）。
- Memory 双层向量召回（ADR-001 Phase 3）。
- Event Bus 统一通信（ADR-001 Phase 4）。