# 验收标准：[Correctness] Investigation Source ID 跨 Snapshot 稳定（Issue #76）

日期：2026-09-06。独立于 PR #72 / #66 最终验收。不手改 #72 REAL artifacts。不关 #53。不启动 #54。

## Change

一次 investigation 生命周期内，同一个规范化来源 URL 一旦进入 Investigation Snapshot，后续 Snapshot 里它的 `InvestigationSource.id` 必须保持不变。

用户必须能看见：同一条 Evidence 从待核对归到支持 / 反驳 / 仅相关时，仍是同一个对象（同一 `sourceId`，生产 UI 同一 DOM 节点），而不是旧 row 消失、新 row 重建。

#66 capture gate 必须按 semantic source identity 判断 transition：同一个 `src-N` 若前后映射到不同 URL，不得报 `unassessed → support`；`sourceIdsStable=false` 必须 FAIL。

## Not this

- 不在 EvidenceBoard / Drawer 用 URL heuristic 假装 continuity
- 不只改 React key / Drawer identity
- 不只改 capture script
- 不只把 registration 从 evidence-first 改成 bundle-first
- 不把同一 URL 的 support + contradict 合成 source-level verdict
- 不改 Snapshot schema 字段（id 仍是 string；不新增 allocator 字段）
- 不碰 `docs/design/2026-09-06-mode3-production/final/` 里的 #72 REAL artifacts
- 不继续改 PR #72，不 merge，不关 #53，不启动 #54

## Evaluator

机器：

- [x] A. same URL across phase：investigating 中 URL X 为 unassessed，judging 中同 URL X 为 support，`sourceId` 严格相等
- [x] B. reorder：同一批来源 role / evidence bucket 重排后，已有 URL 的 id 全不变
- [x] C. add source：Snapshot N 有 X/Y，N+1 新增 Z，X/Y id 不变
- [x] D. role change：unassessed → support / contradict / context-only，sourceId 都不变
- [x] E. same URL dual relation：同一 URL 同一 Claim 同时 support + contradict 时，InvestigationSource 仍只有一个；EvidenceLink 仍可有两条 relation；不把 stance 合成 source-level verdict
- [x] F. #63 UI integration：用接近真实形状的 Snapshot rerender（同 Claim + 同 URL，unassessed → support），Evidence DOM `before === after`，且仍服从 stable / relation / ephemeral
- [x] G. capture gate：`(claimId, sourceId)` 同号但 URL 不同不得报真实 settling；`sourceIdsStable=false` 必须 FAIL；同 URL 且同 sourceId 的 unassessed→support 才算 transition
- [x] H. `npm test`（root）全绿：core 605 / eval 85 / server 21 / web 83 = 794
- [x] I. `cd mvp && npm test`：1002 通过 / 1 skipped
- [x] J. `npm run build` 与 `cd mvp && npm run build` 通过

人评：独立 #76 PR。描述写清 root cause、identity invariant、为何跨 Snapshot 稳定、为何新增来源不改旧 id、为何 dual relation 不合并、capture gate 如何避免 false positive、tests/build。等人工 Review。不 merge。

## 方案（实现前判定）

Root cause：`buildInvestigationSnapshot()` 每次从空集合按 `src-${sources.length + 1}` 编号，judging 先注册 evidence bucket、investigating 只有 bundle，同一 URL 换号。

不采用 in-run allocator：allocator 若只活在一次 SSE 进程里，历史 deterministic rebuild 与实时 complete 帧会对同一输入给出不同 id；若写入 Snapshot 则 schema 漂移。

采用：`InvestigationSource.id` 从规范化 URL（trim）确定性派生。id 只是该 URL 的纯函数，与 phase / role / 注册顺序 / 是否有后来源无关。实时 SSE、单帧 rebuild、历史静态 Snapshot 用同一函数。同 URL 仍只登记一个 Source；claim-specific EvidenceLink 继续各自持有 stance。
