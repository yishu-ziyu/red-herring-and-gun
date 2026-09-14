# 证据库第一版（记忆复用）+ P1 收尾四件

契约依据：用户 2026-09-12 批准的路线图（P0→P1→证据库）；记忆里已有的半成品（搜索词复用、语义召回）之上补「证据级复用」层；P1 批分身登记的待裁尾巴。

## Part 0 · P1 收尾（前端）

- **W1**：`jumpToConflict` 逗号选择器修复（`InvestigationCanvas.tsx:143-145`）：先精确查 `[data-gp-claim-id="X"] .gp-conflict`，无结果再回退命题卡。
- **W2**：追问原句显示「marker 之前的完整用户问题」（而非只第一行）；`visibleOriginalClaim` 判定改为截到 `FOLLOW_UP_MARKER` 之前。
- **W3**：内部拼接段泄漏收口：显示用裁切函数移到 `apps/src/lib/composeFollowUpClaim.ts`（导出 `displayFollowUpClaim`），`ConclusionHero.tsx:131`、`ThinkingDisclosure.tsx:125`、`FollowUpSection.tsx:82`（复制简报）、`InvestigationCanvas` 统一改用。
- **W4**：`gp-global-notice`（历史打开失败/超时提示）给最小可读样式（`golden-path.css`，不动布局）。

## Part 1 · 证据库

### Change

**数据层**（文件：sqliteStore 迁移、新 `apps/server/src/lib/knowledgeStore.ts`、runCasePipeline 收尾钩子）：

- 新表 `knowledge_entries`（迁移幂等）：`id`、`atomNorm`（规范化命题文本，唯一索引）、`atomText`、`verdict`、`evidence`（JSON 数组：`{url,title,snippet,stance}`）、`sourceRunId`、`createdAt`、`lastVerifiedAt`、`hitCount`。
- 规范化：trim、压缩空白、全半角与大小写统一、去句末标点（具体规则写进模块并单测）。
- 调查 finalize 后沉淀：对每个可核查且判词非 unverified 的 atom upsert 一条；同 `atomNorm` 冲突时更新 verdict/evidence/`lastVerifiedAt`。
- **不写用户原句全文、不写用户名**；atom 文本是命题级调查逻辑，属可共享的核查知识。

**注入层**（文件：atomSearch/retrieveForAtoms 一带、新匹配模块）：

- 逐 atom 联网检索之前：对每个待检索 atom 做确定性语义匹配（算法与 `apps/src/lib/semanticRecall.ts` 同源：同义词组桥接 + 汉字 Dice + bigram Jaccard；优先抽取共享，其次端口，不许重新发明），查 `knowledge_entries`。
- 命中且 `lastVerifiedAt` 距今 ≤30 天且 verdict ∈ {true, false, mixed_misleading} → 把条目证据注入该 atom 的证据集（标 `provenance:"knowledge"` 与 `originDate`），**该 atom 跳过联网检索且不占 6 个检索名额**；活动流增加一行「命中知识库（YYYY-MM-DD 已核），免于本次检索」。
- 注入证据照常进 fact_checker；若该 atom 最终判 unverified/证据不足 → **自动降级**：该 atom 触发一次联网补查（走既有 evidenceLoop 补查机制），结果照常参与判定。
- 不命中 / 超龄 / 判词 unverified → 正常联网，无任何变化。
- 注入的证据条目在快照里带两个**新增可选字段** `provenance?: "knowledge"`、`originDate?: string`（InvestigationSnapshotV1 只加可选字段：core SSOT 与 apps/server 镜像同步改、mirror 守卫必须绿；不改其他任何字段，老快照无这两个字段照常渲染）。

**前端**（文件：证据行渲染 ClaimSection、ActivityFeed）：

- 知识库来源的证据条目有标记「知识库 · YYYY-MM-DD 已核」（小标签，不抢视觉层级）；活动流行有既有语义色体系内的一行。
- 其余呈现与正常证据完全一致（可点开来源等）。

**观测**：写 `$DATA_DIR/knowledge-observations.jsonl`：每 atom 一行 `{ts, runId, atomNorm, outcome: hit|miss|stale|injected|downgraded}`，不写用户原句。

### Not this

- 不做用户可见的记忆管理界面（chips 那套，另批）；不做「热门谣言」聚合页。
- 不取消逐 atom 检索上限语义；跳过检索的 atom 让出名额（已写在 Change 里）。
- 宪法边界，写死：不静默继承（atom 文本不同=人物/日期/链接变化→匹配不上→正常联网）；没证据不出结论不破（注入证据必须带真实 URL，fact_checker 绑定失败即降级联网）；**记忆只加速、不代替核查**。
- 不动 P0/P1 已修件；packages/core 仅允许上述快照可选字段扩展（SSOT + 镜像同步改），脊柱其余部分不动（T20 全量同步另说）。

## Evaluator

1. 数据层：规范化/upsert 幂等/迁移单测全绿；隐私抽查（JSONL 与表内无原句全文、无用户名）。【命令】
2. 注入层：五情形单测——命中注入且跳过检索、超龄不注入、unverified 不注入、注入后绑定失败自动降级补查、不命中零变化；命中 atom 不占检索名额有断言。【命令】
3. 收尾 W1–W4 各有测试（W1 选择器落点、W2 多行追问、W3 四处统一裁切、W4 样式存在）。【命令】
4. 机器门禁：`cd apps && npm test` 全绿、双 `npm run build` 零错误（主会话统一跑）。【命令】
5. **真实收口（烧 2 次调查）**：第一轮用隔夜菜案例改写变体 A 跑完（沉淀知识库）；第二轮用改写变体 B（语义相近、字面不同）跑——断言：至少一个 atom 命中（knowledge-observations 有 hit）、该 atom 无搜索请求、证据区有「知识库」标记、第二轮总耗时低于第一轮；双轮六步截图存 `docs/reports/2026-09-12-evidence-base/real-*.png`。【命令 + 人评】

## 文件归属（swarm 分工，三个分身）

- 收尾分身：W1–W4（`InvestigationCanvas.tsx`、`composeFollowUpClaim.ts`、`ConclusionHero.tsx`、`ThinkingDisclosure.tsx`、`FollowUpSection.tsx`、`golden-path.css`）。
- 服务端分身：sqliteStore 迁移、`knowledgeStore.ts`（新建）、`knowledgeMatch.ts`（新建）、`runCasePipeline.ts`、`atomSearch.ts`、`handlers.ts`（收尾沉淀 + 观测写入）、`packages/core` 与 `apps/server` 的 investigation 镜像（仅快照两个可选字段）及全部 server 测试。
- 前端分身：`ClaimSection.tsx` 证据行知识库标记、`ActivityFeed.tsx` 行及对应测试。

## 批次收口（契约 Evaluator 5，主会话在 swarm 后单独派）

真实两轮走查（改写变体 A 沉淀 → 改写变体 B 命中），断言命中 atom 无搜索请求、证据区有「知识库」标记、第二轮更快；产物 `docs/reports/2026-09-12-evidence-base/`。
