# ADR-002: DeepAgents.js Evaluation

## 日期

2026-07-10

## 状态

已评估 — 建议条件性采用

## 背景

红鲱鱼与枪的 AgentRuntime 有三个瓶颈：假 DAG、无 LLM 工具选择、lexical-only memory。

## 调研

### deepagents.js 架构

- 基于 LangGraph 的 React Agent 模式：LLM 获得工具列表，自主决定何时调用
- 核心入口：`createAgent()` — 返回 LangGraph CompiledStateGraph
- Middleware 系统：sub-agent、memory、summarization、filesystem、skills、HITL
- 工具定义：LangChain `tool()` decorator，standard StructuredTool
- 子 Agent：通过 `task` tool 委托，有独立 context window
- Streaming：`AgentRunStream`，subagents 通过 transformer 投射
- 对等依赖：`@langchain/core`, `@langchain/langgraph`, `langchain`, `langsmith`

### 关键发现

**模式不兼容**：
- deepagents.js = React Agent（LLM 驱动循环）
- 红鲱鱼与枪 = Pipeline（编排器驱动顺序）

我们的 4 个 Agent 是**纯推理器**：接收输入 → LLM 调用 → 输出结构化 JSON。它们不使用工具，不自主决策。把它们包装成 deepagents 的 React Agent 需要重写所有 system prompts 和输出格式。

**可以work但需要重写**：
- 每个 Agent 变成 React Agent 后，LLM 需要学会用工具（搜索、记忆读写）
- 当前的 pipeline 编排（RumorDetector → FactChecker → SourceValidator → ReportComposer）需要变成 LLM 决策的 sub-agent 调用
- 输出格式从结构化 JSON 变成 LangChain 的 message 流

## 评估结论

| 维度 | 评估结果 | 说明 |
|------|---------|------|
| DAG Runtime | GO | LangGraph 支持条件分支、并行、sub-agents |
| Tool Calling | GO | 但需重写 Agent prompts |
| Memory | GO | createMemoryMiddleware 可用，但需 JSONL adapter |
| Streaming | PARTIAL | LangChain 流格式不同，需 adapter |
| Sub-agents | GO | 适合 FactChecker + SourceValidator 并行 |
| 迁移成本 | HIGH | 需重写所有 Agent prompts + 输出格式 + 编排逻辑 |
| 依赖风险 | MEDIUM | langchain/langgraph 大依赖，版本耦合 |

## 决策

**条件性采用**：
- 短期（本周）：继续用当前 Pipeline，修假 DAG（低成本快速 wins）
- 中期（1-2 周）：在一个独立 PoC 目录中验证 React Agent 模式
- 长期（1-2 月）：如果 PoC 成功，逐步迁移 Agent prompts 到 React 模式

**不立即全量迁移的原因**：
1. 模式转换成本高 — 4 个 Agent 的 prompts 和输出格式需要重写
2. 当前 Pipeline 已经 work — 没有紧急故障
3. LangChain 大依赖引入版本耦合风险
4. 我们的搜索 providers 是自定义的，需要包装成 LangChain tools

## 面试叙事

"我们评估了 DeepAgents.js (LangChain) 作为 Agent 编排框架。调研发现它提供了完整的 DAG runtime、tool calling 和 memory 系统。但关键发现是模式不兼容：DeepAgents 是 React Agent 模式（LLM 自主决策），而我们当前是 Pipeline 模式（编排器驱动）。这意味着迁移需要重写所有 Agent 的设计。所以我们采取了条件性采用策略：先修当前架构的低成本问题，再通过 PoC 验证 React 模式的可行性，最后逐步迁移。"
