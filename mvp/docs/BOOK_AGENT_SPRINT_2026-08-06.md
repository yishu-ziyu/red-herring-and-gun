# AI Agent Book 对齐冲刺（原 30min → 延长 1h · 2026-08-06）

对照源：`/Users/mahaoxuan/Desktop/AI产品经理/ai-agent-book`  
公式：**Agent = LLM + 上下文 + 工具**

## 本轮落地（可试用）

| 书中能力 | 落点 | 路径 |
|---------|------|------|
| Ch.2 状态栏 | 每步 Agent 观察空间注入 time/step/tools/memory | `src/lib/agentRuntime/contextStatusBar.ts` → `AgentRuntime.runAgent` |
| Ch.2 Skills 按需加载 | 按 agentId/claimType 注入短 skill，抗注入始终带上 | `src/lib/agentRuntime/agentSkills.ts` |
| Ch.1/6 提议者～审核者 | 报告后确定性审稿 + 最小修复 + SSE `report_reviewer` | `src/lib/agentRuntime/reportReviewer.ts`；生产副本 `server/src/lib/reportReviewer.ts` → `casePipeline` |
| Ch.1 ReAct 观察切片 | fact_checker / source_validator 注入 `reactTrace` | `src/lib/agentRuntime/reactObserve.ts` |
| Ch.10 显式 handoff | 上游→下游精简 packet，非整段 trajectory | `src/lib/agentRuntime/handoffPacket.ts` |
| Ch.3 Memory 闭环 | Express 补 `/api/agent/memory-candidates` | `server/src/lib/memoryCandidateHandlers.ts` + `index.ts` |
| Ch.6 Eval | `reportContractPass` / `reportReviewScore` | `src/lib/agentRuntime/evaluation/*` |
| 流式 UI | 「报告审稿 · 通过/需补证」+ 分数与最多 3 条 issue | `MissionControlView.tsx` |
| SSE complete | 透出 `reportReview` | `vite.config.ts` + `agentExpansion.ts` |

## 试用时你会看到

1. 本地：**http://127.0.0.1:5180/**（Vite + AgentRuntime 路径）
2. 跑完一案后流里多一步工具事件：**报告审稿**
3. 空壳/过强结论会被审稿降级或补 canSay/cannotSay/evidenceChain
4. 历史案件记忆确认 API 在 Express 生产侧已挂路由（本地 Vite 原本就有）

## 额外

- `toolRegistry` 登记 `report_reviewer`
- UI `isReportReviewerTool` 识别审稿 SSE
- `reactObserve` 二次反证注记注入 report_composer

## 同日过程壳（A · 1h 延长段）

- `missionShell` 适配器 + token/antdx UI + `/shell-preview`
- 真跑：`/?shell=1` 或 `/?shell=antdx`

## 仍未做满（诚实边界）

- 生产路径 **模型仍不自主选工具**（编排 pre-fetch）；ReAct 是观察切片，不是多轮 FC
- 无向量 RAG；memory 仍是 JSONL 词匹配
- 后训练 / 持续进化写回 harness 未做
- 多 Agent 动态委托未做（仍是 DAG/流水线）

## 建议试用 claim

- `隔夜菜加热会致癌吗`（因果 → causal skills + 替代解释路径）
- `某地昨晚发生重大事故`（事件核查）

刷新页面（硬刷新）后再开案，避免旧 bundle。
