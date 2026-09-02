# ADR-006: Agent loop is the execution engine; Case Pipeline stays default until quality matches

## 日期

2026-08-27

## 状态

已开始（feature-flag）。默认生产仍是 ADR-003 Case Pipeline。

## 背景

过程壳已按 Frontier / Apodex 的形状画：想 → 搜 → 打开页 → 任务板 → 判断。内核仍是 `runCasePipeline` 固定 phase，过程 UI 是映射出来的。

调研结论：他们强在 **ReAct 循环 + 真工具 + observer**，不是强在「永远给一个答案」。红鲱鱼的产品合同是审查：拆原子、自证、无 URL 不得真/假、无证据 ≠ 假。ADR-002 已拒绝迁 LangGraph / DeepAgents。不要 vendor FrontierAgent 的 Python 仓库。

## 决策

1. **执行层**新增 `mvp/server/src/lib/agentLoop`：`runAgentLoop` 是域无关 ReAct 内核（LLM ↔ 工具，直到 `submit_verdict` 或停）。工具：`todo_write` / `web_search` / `web_fetch` / `submit_verdict`。Observer 发现有 SSE 事件，脸仍是 `ApodexRunView`。
2. **判决层不动。** `submit_verdict` 之后走 `finalizeLoopReport`：自证、`forceCheckable`、URL 绑定、`deriveOverallVerdict`、`assembleFinalReport`、`publicCopy`、公式分、`reportReviewer`。模型不能跳闸。
3. **并列、默认关。** `wantsAgentLoop`：`AGENT_LOOP=1` 或请求体 `execution: "loop"` 或页面 `?loop=1`。未开时 HTTP 仍只调 `runCasePipeline`。
4. **HTTP 只做薄分发。** 循环实现不进 `handlers.ts`。不在 `vite.config.ts` 写编排。
5. **质量门。** 循环判断质量不低于现管线之前，不切默认。切默认另写 ADR。

## 不做

- 不 vendor FrontierAgent / AgentHarness Python
- 不迁 LangGraph / DeepAgents
- 不把 bash、沙箱、Agent Team 带进本产品
- 不删 `claimAtom` / `evidenceLoop` / `publicCopy`
- 不把 `casePipeline` 改成循环的包装器

## 后果

- 新执行逻辑改 `agentLoop`；只改 AgentRuntime 仍等于没进生产（ADR-003 继续有效）。
- 循环开着时过程板可以来自 `todo_write`；关着时仍从 pipeline 事件推断。
- 无 MiniMax key 时打开 flag 会走现有 SSE `error` 出口，不会静默回退到 pipeline。
