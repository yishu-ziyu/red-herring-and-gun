# 追问管道观测（阶段 3：先观测，再决定是否建快路径）

契约依据：用户裁决 2026-09-12 采纳「3→2」路线（先观测一轮「追问里需要新证据的比例」，数据支持再建快路径）；`docs/NOTES.md` 头部挂起条目。

## Change

1. **payload 扩展**：`POST /api/agent/orchestrate-stream` 增加两个可选字段：`caseId?: string`、`followUp?: boolean`。仅当 `followUp: true` 时 `caseId` 必填；首轮与 legacy 路径不传，行为与现状完全一致。
2. **服务端校验（在额度扣除之前）**：`followUp=true` 且（无 caseId / caseId 不存在 / ownerHash 不匹配）→ 400，错误文案唯一且恒定：「追问关联的案件不存在或无权访问」。校验失败不扣额度、不建 run 记录。
3. **前端接线**：`App.tsx handleFollowUp` 把刚完成案件的 caseId 经 `useInvestigationRun.start({ priorCaseId })` → `agentExpansion.ts` 的 payload 带上 `caseId` + `followUp: true`。
4. **run 记录**：runs 表新增 `priorCaseId TEXT NULL`、`isFollowUp INTEGER NOT NULL DEFAULT 0`，迁移幂等（老行保持 NULL/0）。
5. **观测记录**：追问 run 在报告 finalize 后写一行 JSONL 到 `$DATA_DIR/followup-observations.jsonl`。**只写计数与判词标签，绝不写 claim 文本、URL、用户名**。
6. **分析脚本**：`scripts/qa/followup_observation_report.py` 读 JSONL 汇总：样本数、newSourceCount 分布、verdictDelta 分布、fastPathCandidate 占比。

## 钉死的接口（各分身共用，逐字实现）

### 观测记录字段（JSONL 每行一个对象）

```json
{
  "ts": "ISO8601",
  "runId": "string",
  "caseId": "string",
  "priorCaseId": "string",
  "atomsTotal": 0, "atomsSearched": 0, "atomsUnverified": 0, "searchesTotal": 0,
  "priorSourceCount": 0, "overlapSourceCount": 0, "newSourceCount": 0,
  "priorVerdict": "string", "verdict": "string",
  "verdictDelta": "same | strengthened | weakened | changed",
  "fastPathCandidate": false
}
```

- 来源集合 = 该轮最终报告引用条目的规范化 hostname（小写、去 www、去重计数）。
- `overlapSourceCount` = 两轮来源集合交集大小；`newSourceCount` = 本轮减交集。
- `verdictDelta` 的确定性映射写在分类器模块里（取不到判词记 `"unknown"`，此时 `fastPathCandidate` 恒为 false）。
- `fastPathCandidate = (newSourceCount === 0 && verdictDelta === "same")`。
- 上一轮报告读取失败 → 不写记录，**不阻断 run**。

### 分类器模块

新文件 `apps/server/src/lib/followupObservation.ts`，导出：

```ts
export interface FollowUpObservation { /* 上述字段，ts 为写入时生成 */ }
export function buildFollowUpObservation(input: {
  priorReport: unknown;
  report: unknown;
  stats: { atomsTotal: number; atomsSearched: number; atomsUnverified: number; searchesTotal: number };
}): FollowUpObservation | null   // 判词/来源均取不到时返回 null
export function appendFollowUpObservation(rec: Omit<FollowUpObservation, "ts"> & { ts?: string }): void
// append 写 $DATA_DIR/followup-observations.jsonl，一行一个 JSON；DATA_DIR 沿用现有约定（测试隔离见 apps/src/test/setup.ts 或 apps/server 对应处）
```

## Not this

- **不改管道任何阶段**：不省检索、不加「要不要新证据」的模型判定——本轮只观测。追问确认后仍走完整管道，用户无感知。
- 不动 `composeFollowUpClaim` 文本、不动 memory candidates、不动 legacy 路径（`MissionControlView.tsx` 那条追问链路不接线）。
- 不写任何前端 UI。
- 阶段 2（快路径）不在本契约；数据出来后另开契约裁决。

## Evaluator

1. `cd apps && npx vitest run server/src` 全绿（2026-09-12 实施时修正：server 测试实际路径是 `apps/server/src`，契约原写的 `src/server` 不匹配），新增测试覆盖：校验 400 三情形（缺 caseId / caseId 不存在 / ownerHash 不匹配）均不扣额度不建 run；分类器四情形（same+无新源→candidate、有新源→非 candidate、判词 changed→非 candidate、上一轮缺失→null）；runs 表迁移幂等（重复启动不炸）。【命令】
2. `cd apps && npm test` 全绿、`cd apps && npm run build` 零错误；仓库根 `npm run build` 零错误。【命令】
3. `npm run eval:gate` 全绿。【命令】
4. 端到端干跑（mock 管道，不烧模型）：模拟一次 `followUp: true` 请求走完 handler，断言 JSONL 恰增一行、字段齐全、不含 claim 文本。【命令】
5. 隐私：JSONL 样例行 grep 不到原句子串。【命令】

## 文件归属（swarm 分工，互不越界）

- 前端通道：`apps/src/lib/agentExpansion.ts`、`apps/src/goldenPath/useInvestigationRun.ts`、`apps/src/App.tsx` 及对应 apps 前端测试。
- 服务端：`apps/server/src/handlers.ts`、`apps/server/src/lib/runStore.ts`、`apps/server/src/lib/sqliteStore.ts`、`apps/server/src/lib/followupObservation.ts`（新建）及 server 测试。
- 分析脚本：`scripts/qa/followup_observation_report.py`（新建）。
