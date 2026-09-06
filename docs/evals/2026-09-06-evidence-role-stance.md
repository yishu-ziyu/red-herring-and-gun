# 验收标准：[Correctness] Evidence role 与 finding 语义冲突（Issue #74）

日期：2026-09-06。独立于 #72 / #66 产品验收。不手改真实 Snapshot。不改 EvidenceBoard / Drawer 展示规则。

## Change

用户看见 Claim「每次感冒都应当输液」时，明确反驳该命题的材料不得被标成「支持」。

真实 case 的最小化 producer 输入（模型把证伪 URL 写进 `supportingSources`、`contradictingSources` 为空、`verdict=false`）经过 merge / bind / Snapshot 之后：

- 这些来源的 Evidence `role` 不是 `support`
- Claim 判断不再因为反证桶被掏空而掉成 `unresolved`

正常 `support` / `contradict` / `context-only` 路径保持原语义。

## Not this

- 不在前端用 `finding.includes("不")`、否定词正则或 UI 重猜 stance
- 不让 `buildInvestigationSnapshot` 用 NLP 读 finding 正负
- 不手改 `docs/design/2026-09-06-mode3-production/final/` 里的真实 Snapshot
- 不为这个 bug 改 EvidenceBoard / Source Drawer 的展示规则
- 不 merge，不关 #66 / #53，不启动 #54，不碰 #72 artifact

## Evaluator

机器：

- [x] E1 `mergeSubclaimVerdicts`：上述最小化输入把来源从 `supportingSources` 改到 `contradictingSources`，`verdict` 仍为 `false`
- [x] E2 `bindAtomEvidenceToVerdicts`：同样输入不得把证伪 URL 留在 `supportingSources`；`sourcesRelatedOnly` 检索垫不改桶
- [x] E3 `buildInvestigationSnapshot`：同一 producer 输入输出 `role !== "support"`；已正确分桶的 `contradict` / 正常 `support` / `context-only` 不回归
- [x] E4 `npm test`：core 584 / eval 85 / server 21 / web 83 = 773 通过
- [x] E5 `cd mvp && npm test`：983 通过 / 1 跳过
- [x] E6 `npm run build` 与 `cd mvp && npm run build` 通过

人评：独立 #74 PR，root cause 写进描述，等人工 Review。

## Dual-bucket citation（PR #75 Review）

Change：本条 evidence 的 `[n]` 按 `[...supportingSources, ...contradictingSources]` 的原始合并顺序绑定。两桶都有时 `[1]` 与 `[2]` 都保留并指向正确来源。

Not this：继续 `support.length ? support : contradict`；用 finding 文本或否定词猜 stance。

Evaluator：

- [x] D1 Case A：support=[A] contradict=[B]，evidence `[1]`+`[2]` 都保留
- [x] D2 Case B：原 support=[bad,A] contradict=[B]，whitelist 删 bad 后原 `[2]`→`[1]`、原 `[3]`→`[2]`
- [x] D3 only-support / only-contradict / #74 false misbucket / related-only 不回归
- [x] D4 `mergeSubclaimVerdicts`、`bindAtomEvidenceToVerdicts`、`normalizeReportCitations` 共用 `bindDualBucketCitations`
- [x] D5 根 tests：core 589 / eval 85 / server 21 / web 83 = 778 通过；mvp 992 通过 / 1 跳过；`npm run build` 与 `cd mvp && npm run build` 通过

## 根因（实现前判定）

`buildInvestigationSnapshot` 对 `supportingSources → support`、`contradictingSources → contradict` 的映射是确定性的，没有猜错。

错误发生在 producer 结构化输出合同：

1. FactChecker 规定 `contradictingSources 不参与本条 evidence 的 [n] 编号`
2. `[n]` 只能绑 `supportingSources`
3. Report composer 侧把 `supportingSources` 写成「本条来源的引用顺序」而不是「支持该原子命题的来源」
4. `verdict=false` 没有「反证必须进 `contradictingSources`」的硬约束

因此模型把「感冒通常不需要输液」等证伪材料放进 `supportingSources`。Snapshot 忠实映射成 `role=support`；`false` 且反证桶为空时判断再被降成 `unresolved`。这与真实 complete Snapshot 一致。

修复层：prompt/schema 合同 + merge/bind 按 `verdict=false` 改桶（不用 finding 文本）。Snapshot 只做与生产规则同向的读取兜底。
