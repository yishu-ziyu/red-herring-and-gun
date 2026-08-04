# Tasks

- [x] Task 1: 扩展 DAG 类型定义 —— 给 ExecutionDagNode 增加 type 字段
  - [x] 修改 `ExecutionDagNode` 接口在 `agentOrchestrationTypes.ts`
  - [x] 更新 `buildAdaptiveExecutionPlan()` 生成所有节点都带正确 type
  - [x] 确认 TS 类型检查通过

- [x] Task 2: 在 agentConfigs.ts 新增声明式 Agent 注册表
  - [x] 定义 `AgentRegistry` 接口，`registerAgent` / `getAgent` / `canContinueAfterFailure` 方法
  - [x] 从 `AGENT_CONFIGS` 构建全局注册表
  - [x] 暴露 `getAgentRegistry()` 供 AgentRuntime 使用
  - [x] 写单测：正确获取已注册 agent，未注册返回 undefined

- [x] Task 3: 在 AgentRuntime.ts 实现 DAG 执行引擎 `executeDag`
  - [x] 实现拓扑排序：计算入度，按边生成顺序
  - [x] 实现并行执行：同一层级无依赖的 agent 节点用 Promise.all
  - [x] 实现节点执行分发：planner / agent / debate / report 各类型处理
  - [x] debate 节点：复用现有 `buildConsensusDebate` / `buildCausalConsensusDebate` 语义
  - [x] 搜索准备：在首个消耗 searchResult 的 agent 层前执行一次搜索，注入下游
  - [x] 未注册 agent：标记 skipped，emit 可见事件，不中断执行
  - [x] 失败策略：用注册表判断是否可继续，遵循现有 `buildAgentFailureOutput` 逻辑
  - [x] 写单测：拓扑排序正确、并行执行正确、未注册 agent 处理正确

- [x] Task 4: 重构 `runCase` 由 DAG 驱动执行
  - [x] 删除四个私有 pipeline 方法（`runStandardPipeline` / `runConceptPipeline` / `runCausalPipeline` / `runEventPipeline` / `runMixedPipeline`）
  - [x] 把现有逻辑中的 planner、memory recall、vision、executeDag、report 收束、applyRuleBasedConfidence、memory write、follow-ups 串联
  - [x] 保留全部事件契约不变，确保前端可见事件与之前完全一致
  - [x] 确认所有 `emit` 调用位置、参数名称与原有一致

- [x] Task 5: 验证与 QA
  - [x] 运行所有现有单元测试，确保全绿（DAG 迁移 4 用例全绿；1 个无关失败 `claimReviewStream` 为既有问题，不在本 spec 范围）
  - [x] 新增 DAG 执行引擎单元测试覆盖：concept / causal / event / mixed 四种 claimType
  - [x] TS 类型检查通过（`npx tsc --noEmit`；本 spec 改动文件无错误，其余报错均为未改动文件既有问题）
  - [x] 端到端测试：走通一个完整 case，检查各 Agent 执行顺序符合 DAG、事件输出正常

# Task Dependencies

- [Task 2] depends on [Task 1] — 注册表依赖类型定义
- [Task 3] depends on [Task 1] [Task 2] — 执行引擎依赖类型化节点和注册表
- [Task 4] depends on [Task 3] — runCase 重构依赖执行引擎
- [Task 5] depends on [Task 4] — 验证依赖重构完成
