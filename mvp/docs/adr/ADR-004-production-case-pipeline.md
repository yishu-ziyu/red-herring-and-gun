# ADR-004: Production Case Pipeline is the runtime truth for claim-atom domain

## 日期

2026-08-06

## 状态

已批准

## 背景

ADR-001 要求「DAG 是运行时真相」，Phase 1 把 `executeDag` 落在 `mvp/src/lib/agentRuntime/AgentRuntime.ts`。  
2026-08 的产品能力（原句自证、排除层、按原子检索、claimItems 预交错）却全部落在 Express 生产路径 `handlers` 的固定 phase 编排上。

结果是**双运行时**：

| 路径 | 入口 | 自证 / 排除 / 按原子检索 |
|------|------|--------------------------|
| 生产 | `/api/agent/orchestrate(-stream)` → Case Pipeline | 有 |
| Dev / eval | Vite middleware / `AgentRuntime.runCase` | 无（整句 search） |

继续假装 DAG 已是生产真相会误导后续改动。

## 决策

1. **生产运行时真相** = `mvp/server/src/lib/casePipeline`（`runCasePipeline`），由 HTTP JSON / SSE 薄 adapter 调用。
2. **域深度模块**（可单测、双端共享）：
   - `claimAtom` — key / split / merge / self-proof
   - `atomSearch` — select / bundle / bind / `retrieveForAtoms(searchOne)`
   - `reportAssembly` — `assembleFinalReport`（排除层 + claimItems）
3. **`AgentRuntime` / client DAG**：保留为 **eval / 本地 dev 实验床**，在未迁移前**不得**再实现第二份 claim-atom 闸门。需要域规则时 **import 上述模块**，不要复制。
4. 与 ADR-001 的关系：ADR-001 的 DAG 目标**未取消**，但 **2026-08 起生产交付以 Case Pipeline 为准**；将来若 DAG 接管生产，必须把 Case Pipeline 的 phase 语义（自证先于检索、排除只在落库闸门 enforce、按原子检索）迁入同一 module，而不是并行两套。

## 不做

- 本 ADR 不要求立刻删除 `AgentRuntime`。
- 不要求本迭代把工具改成 LLM function-calling（ADR-001 Phase 2 仍可选）。

## 后果

- 新功能默认改 Case Pipeline + 域模块；PR 若只改 AgentRuntime，视为未达生产。
- 架构审查若再建议「把原子域只做在 AgentRuntime」，应引用本 ADR 拒绝。
