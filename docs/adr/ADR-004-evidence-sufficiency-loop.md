# ADR-004: Evidence Sufficiency Loop — 动态加在证据维度，不加在拓扑维度

## 日期

2026-08-15

## 状态

已实施（2026-08-15）。实现记录见文末。

## 背景

PRODUCT_SPEC 第八节（2026-08-15 调研）定论：与业界产品的差异轴是**判决纪律**，不是编排动态性。ADR-002 已评估并拒绝 LangGraph/DeepAgents 全量迁移；ADR-003 确立 Case Pipeline 为生产运行时真相。

当前 Case Pipeline 对每个可核查原子命题**一轮检索定生死**：`retrieveForAtoms` 查一轮 → fact/source 对照 → unverified 就 unverified。问题：

- 一轮未命中 ≠ 无证据，常常只是 query 角度不对（缺时间锚点、缺官方来源词、缺原文语境）
- 证据冲突时没有第二次求证，直接进报告
- 「动态性」目前只在拓扑维度被讨论（DAG vs pipeline），而那不是产品差异

## 决策

在 Case Pipeline 内引入**证据充分性循环**（P0）：

1. **触发条件（确定性代码判）**：fact-check 后原子命题状态为 `unverified`，或绑定证据互相冲突。
2. **补查 query 生成**：LLM 只做语义改写——加时间锚点、换官方来源词、补原文语境；改写策略由代码约束。
3. **再检索一轮 → 重新绑定证据 → 重判**：复用 `atomSearch` 的 select / bundle / bind。
4. **预算与判停（确定性代码判）**：每原子命题最多 2 轮策略 × 每轮 2 条 query，目标原子上限 3 个（最多 12 次补查）；任一 query 拿到新增证据即停（边际增益已够重判）；策略轮耗尽仍零新增 → 边际增益判停；每轮停止必须给出显式原因（`evidence-found` / `no-new-evidence` / `rewrite-empty` / `search-failed`）。
5. **frontier 系统生成**：回收 `mvp/docs/RECURSIVE_EVIDENCE_SEARCH_PLAN.md` 的 frontier 思想，「用户选 frontier」换成「系统按证据缺口生成 frontier」。
6. **SSE 可见**：流上发「第 1 轮未命中 → 改写查询（可见 query）→ 第 2 轮命中/仍未命中」，停止原因对用户可见。
7. **条件重判**：补查拿到新证据 → 重跑一次 `fact_checker`；重判失败保留原判，补查证据仍进报告与溯源。

模块落位（遵循 ADR-003 域深度模块约定）：

- 循环控制、预算、判停、停止原因 = 确定性代码，域模块 `mvp/server/src/lib/evidenceLoop`，可单测
- query 语义改写 = LLM 单点调用，注入 pipeline（同 `callSelfProofModel` 模式）；缺省/失败回退确定性模板（round 1 官方来源词，round 2 原文语境）
- `runCasePipeline` 编排循环，HTTP/SSE adapter 透出事件

## 不做

- 不做 LLM 决定下一步（自治 Agent 与判决纪律冲突，见 PRODUCT_SPEC 第六节）
- 不做无界递归搜索：预算封顶，判停显式
- 不做用户手选 frontier 的 Canvas 交互（那是 v7 探索方向，不是生产路径）
- P1（冲突触发第二模型对抗）、P2（案件类型分支）、P3（来源独立性）不在本 ADR 范围，另立决策

## 后果

- 冲突/未证实命题的延迟上升，由预算封顶约束；干净命题零开销（不触发循环）
- SSE 新增事件类型（round start / query rewrite / round result / stopped-with-reason），前端需透出
- eval 集需要补「第 2 轮翻案」案例：第一轮查不到、第二轮命中的才算循环生效
- `unverified` 的语义变纯：留在该状态的原子命题是真的查过两三轮仍无证据

## 实现记录（2026-08-15）

- 域模块 `mvp/server/src/lib/evidenceLoop/`：`findLoopTargets`（触发）、`fallbackRewriteQueries`（模板兜底）、`mergeSourcesIntoBundle`（URL 去重合入 bundle）、`runEvidenceLoop`（预算/判停/停止原因），单测 13 例。
- `runCasePipeline` Phase 2a 接线：fact/source 之后、afterFactSource 之前；新证据 → 重跑一次 fact_checker；结果挂 `CasePipelineResult.evidenceLoop`。
- SSE：`onEvidenceLoopRoundStart/RoundResult/Stopped` 以 tool_start / tool_result 风格透出（toolName `Evidence Loop`），前端零改动可显示；停止原因带中文解释。
- 触发注意：fact 阶段 subclaimVerdicts 是模型原始输出，URL 绑定在报告组装时才发生，触发判定只看判词状态（unverified 类 / 双侧来源冲突），不看来源数量。
- 全量测试 906 passed / 1 skipped（real-API 用例），server `tsc --noEmit` 干净。

## 实现记录 · LLM 语义改写接入（2026-08-15）

- 域模块新增 `makeRewriteQueryCall(callRaw)`：prompt（换词汇空间 / 加时间锚点 / 按策略改写）与 `parseRewriteQueries`（剥引号、压空白、丢超长、去重、每轮截 2 条）都在域内可单测；handlers 只注入裸模型调用（`makeRewriteCaller`，镜像 selfProof 模式，`evidence_loop_rewriter`，reasoningEffort low，模型选择跟 fact_checker）。
- JSON / SSE 两个 adapter 均已传入 `callRewriteModel`；LLM 失败回退确定性模板，循环控制与判停不受影响。
- 模板改写保留为兜底而非删除：无 key、配额耗尽、模型超时时的下限保障。

检索政策（Query Portfolio / Evidence Gap / RRF / 增益判停）见 ADR-005，接到本循环，不另起 pipeline。
