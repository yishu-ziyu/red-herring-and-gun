# Agent 化考察（2026-08-30）

> 从固定管线 `casePipeline` 逐渐演进为 agent 项目的架构评估。sub agent 架构考察结论记录。

## 结论

三转 agent 不需要推倒重来：现有 `agentLoop`（ADR-006，ReAct 内核，flag 默认关）已有骨架，
`evidenceLoop`（ADR-004，按缺口补查 + 判停）和 `evidencePursuit`（ADR-005，纯函数搜索策略）
是现成的动态约束层。
目标形状（ADR-006）：claim → runAgentLoop（LLM ↔ 工具：web_search/web_fetch/todo_write/submit_verdict）
→ finalizeLoopReport（自证/URL 闸/公式分/publicCopy）→ ApodexRunView。

## 可复用（不是障碍）

- `claimAtom`：拆原子 + 自证，agent 收束时的闸，保留
- `evidenceLoop`：触发补查 / 重判 / 判停的确定性骨架，agent 检索的约束层
- `evidencePursuit`：Query Portfolio / RRF / 信息增益判停，纯函数，直接迁移
- `finalizeLoopReport`：URL 闸 / publicCopy / 公式分，agent 的判决闸门

## 会成为障碍的

1. **`casePipeline` 单路编排**：固定 phase 序列与 "LLM 决定下一步" 冲突。过渡期保持 flag 关，质量门达标再切
2. **HTTP 层过厚**（handlers/makeRunAgent 970 行编排）：编排不该长在 adapter 里。转 agent 前应把编排边界收进 lib
3. **判决纪律约束层**：agent 自由发挥会破坏 自证/无 URL 不得真假/无证据 ≠ 假。必须由 finalizeLoopReport 兜底，不允许模型直接产最终结论

## 演进路径（推荐）

1. P0：保住现状（flag 关），把 `makeRunAgent` 编排从 handlers 收进 lib
2. P1：eval 增加 agentLoop vs casePipeline 同案质量对比，达标（不低于现管线）才切默认
3. P2：切默认默认执行引擎为 agentLoop（另写 ADR），casePipeline 降级为备用轨

## 判决纪律怎么保住

不允许模型跳闸：任何路径的最终结论必须过 finalizeLoopReport——
自证丢未在原句的原子、URL 闸丢无出处的真假、publicCopy 剥工具名与内部词、公式分不让模型拍分数。
这正是 ADR-006 第 2 条「判决层不动」的含义。