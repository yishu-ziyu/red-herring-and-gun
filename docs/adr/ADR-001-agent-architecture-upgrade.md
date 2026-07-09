# ADR-001: Agent 架构升级 — 从固定流水线到动态 DAG Runtime

## 日期

2026-07-10

## 状态

已批准

## 背景

红鲱鱼与枪当前使用固定 4-Agent 流水线：
RumorDetector → Search → FactChecker//SourceValidator → ReportComposer → MemoryWrite

虽然 `buildAdaptiveExecutionPlan()` 能按 claim 类型（concept/causal/event/mixed）生成 DAG，
但运行时**完全不读这个 DAG**，所有 claim 走同一路径。

这导致：
- 概念型 claim 浪费时间走完整事实核查流水线
- 无法根据中间结果动态调整路径（例如搜索没结果时自动降级）
- 加新 Agent 需改 4 个文件，无法热插拔
- Consensus debate 是静态 heuristic，不是真正的多轮对话

## 决策

升级到动态 DAG Runtime 架构，核心原则：

1. **DAG 是运行时真相** — `buildAdaptiveExecutionPlan()` 的输出真正控制执行路径
2. **Agent 可热插拔** — 注册新 Agent 只需在配置中声明，不修改编排核心
3. **工具由 LLM 自主选择** — 不再由编排层 pre-fetch，Agent 自己决定何时调用工具
4. **Memory 双层模型化** — episodic（完整案例）vs semantic（提取知识），加向量召回
5. **Event bus 统一通信** — 取代 `onEvent?.(...)` 回调，支持多消费者

## 架构对照

| 维度 | 当前 | 目标 |
|------|------|------|
| 编排 | 固定串行 + 假 DAG | 动态 DAG runtime |
| 工具 | 编排层 pre-fetch | LLM function calling |
| Memory | Jaccard bigram | Jaccard + embedding 向量召回 |
| Agent 注册 | 改 4 个文件 | 声明式注册 |
| Event | 单消费者回调 | Event bus（多消费者） |
| Consensus | 静态 heuristic | 条件触发多轮辩论 |

## Phase 计划

| Phase | 内容 | 预计 |
|-------|------|------|
| Phase 1 | DAG Runtime 核心 — 执行引擎 + Agent 注册表 | 3-4h |
| Phase 2 | 工具系统重构 — function calling 接入 | 3-4h |
| Phase 3 | Memory 向量层 — embedding 召回 | 2-3h |
| Phase 4 | Event Bus — 统一事件通信 | 1-2h |
| Phase 5 | 迁移 + QA — 4-Agent 流水线迁移到新架构 | 2-3h |

每 Phase 产出：实现 + 测试 + 架构决策记录 + 面试叙事文档

## 不做什么

- 不引入 LangChain/DeepAgent 框架 — 我们的需求比它们轻，比 PiAgent 重。自建 DAG runtime 更可控
- 不替换现有 LLM provider — 继续用 `callAgentWithFallback`
- 不改变前端 — 只改后端编排层
- 不做部署 — 部署走 `ops.sh`

## 风险

| 风险 | 缓解 |
|------|------|
| DAG runtime 复杂度超出预期 | Phase 1 先跑通最小可行 DAG（2 个 Agent），确认模式后再扩展 |
| Function calling 增加 token 消耗 | 按 Agent 粒度控制工具暴露，不比当前 pre-fetch 多 |
| Embedding 需要额外 API | 先用本地轻量模型（如 bge-small-zh），不依赖外部 API |
| 迁移风险 | 新旧架构并行运行，通过 feature flag 切换 |
