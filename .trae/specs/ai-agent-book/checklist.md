# Checklist

- [x] DAG 节点类型化：`ExecutionDagNode` 有 `type` 字段，`buildAdaptiveExecutionPlan()` 对 concept/causal/event/mixed 均生成带正确 type 的节点
- [x] Agent 注册表：能从 `AGENT_CONFIGS` 构建，按 id 获取配置，未注册返回 undefined，可判断失败后是否可继续
- [x] DAG 执行引擎：拓扑排序正确，无依赖 agent 节点并行，各类型节点执行正确
- [x] 事件型 claim：执行顺序 rumor_detector → fact_checker + source_validator（并行）→ consensus_debate → report_composer，与现状一致
- [x] 因果型 claim：在 fact_checker 后追加 alternative_explanation_searcher + counter_evidence_grader（并行），顺序与现状一致
- [x] 概念型 claim：不搜证，未注册 concept 节点标记 skipped，report 直接收束，行为与现状一致
- [x] 事件契约：`planner_update` / `agent_*` / `tool_*` / `consensus_debate_*` / `speculative_update` 全部保留，前端兼容
- [x] 失败处理：未注册 agent 不崩溃，Agent 失败按现有失败策略处理（error-boundary / 是否可继续）
- [x] 测试：新增 DAG 执行引擎测试覆盖四种 claimType，DAG 迁移 4 用例全绿
- [x] 构建：`npx tsc --noEmit` 通过（本 spec 改动文件无错误；其余报错均为未改动文件既有问题）