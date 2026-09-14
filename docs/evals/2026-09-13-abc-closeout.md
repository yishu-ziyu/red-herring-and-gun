# 2026-09-13 · A 发版通道 / B 证据库 1.1 / C 看不看得懂

契约依据：用户 2026-09-13 裁完 A、B、C 都要做；随后另裁「追问快路径」与「整套真实案例评分考试重做」给其他分身。本契约只覆盖留下的三件。P0/P1/证据库 v1 已落地，不得回退。未部署。用户没要求 commit，不得主动 commit。

## Change

### A · 修发版通道（不含评测闸门）

- `apps/server/src/lib/shareHandlers.ts` 的类型错误修掉：`cd apps/server && npx tsc --noEmit` 不再被这一处挡住。
- `./ops.sh check` 能过（本地测试、构建、服务端 tsc、本地 API 冒烟）。
- 发版：`./ops.sh check` 过后再按 `apps/deploy-to-server.md` / `./ops.sh deploy --yes` 尝试。缺密钥/SSH/远端则停，写清缺什么。部署脚本若要求先 commit，做完代码与检查后把「差一次 commit 才能发」写进报告，不擅自 commit。

### B · 证据库 1.1：记忆去重 + 判定拍吃初稿

- **去重**：被知识库注入的 atom 不再按新 `atomNorm` 沉淀成新行。用户再查相似说法时 `knowledge_entries` 条目不膨胀。
- **判定提速（做一版，不是只出方案）**：命中知识库的 atom，把已有判词与证据作为 `knowledgeDrafts` 注入 fact_checker、cross_examiner、report_composer，当可复核初稿，不是检索省了、判定仍从零想。
- 宪法边界写死：人物/日期/链接变了必须当新命题；没证据不出结论；记忆只加速不代替核查。注入失败或复核推翻仍走既有降级/补查。
- 观测：`knowledge-observations.jsonl` 增加 `deduped`、`reused_verdict`；不写用户原句、不写用户名。

### C · 「看不看得懂」验收材料（赛题 #54）

- 单独契约 `docs/evals/2026-09-13-comprehension.md`。
- 给非技术用户的任务单、记录表、通过/失败标准。
- 机器可检部分：结论第一句是否直答原句、来源是否可点开。
- 找真实用户本人做访谈做不到就停在材料齐备，不假装已经找过真人。

## Not this

- 不改 `packages/eval/`、`apps/server/eval/`、`npm run eval:gate` 的基线、资格标签或考题。评测考试另有分身重做。
- 不改追问快路径：不改 `composeFollowUpClaim`、追问 orchestrate payload、`followupObservation`、不为追问跳过检索或拆题。
- 不回退 P0/P1/证据库 v1。
- 不做用户可见的记忆管理界面、不做「热门谣言」页。
- 不取消逐 atom 检索上限语义。
- 不用脆弱的端到端秒数当判定提速的唯一门禁。
- 不擅自 commit、不改 git config、不用 `--no-verify`、不硬推缺密钥的部署。
- 不假装已经找过没有技术背景的真人用户。

## Evaluator

### A

1. `cd apps/server && npx tsc --noEmit` 退出码 0。【命令】
2. `./ops.sh check` 退出码 0。【命令】
3. 部署：有密钥则 `./ops.sh deploy --yes`；没有则停并写清缺 `ALIYUN_HOST` / `ALIYUN_USER` / SSH。若只差 commit，写进报告。【命令 / 环境】

### B

1. 单测：第二轮命中注入后 `knowledge_entries` 行数不增加；观测有 `deduped`。【命令】
2. 单测：命中 atom 的 lookup 带出 `priorVerdict`；注入后 bundle 上有 `knowledgeDrafts`；判定拍输入含该初稿；cross_examiner 用户内容含该初稿。【命令】
3. fact_checker / cross_examiner 的说明里写明：初稿只供复核；人物/日期/链接变了必须当新命题；没证据不得沿用初稿结论。【命令】
4. `cd apps && npm test` 相关套件绿；收口时再跑全量与双 build。【命令】
5. 真实双轮很贵：实现与单测绿之后，仅当单测盖不住「条目不膨胀」时才烧。本契约不把端到端秒数当唯一门禁。【命令，按需】

### C

1. `docs/evals/2026-09-13-comprehension.md` 含 Change / Not this / Evaluator；人评项标「人评」。【文件】
2. 任务单：贴一句说法 → 看结论第一句 → 能否指出依据和来源；有记录表与通过/失败标准。【文件】
3. 机器项：完成态结论第一句（`[data-gp-direct-answer]`）是对原句的直接回答，不是「能信 / 不能信 / 只能信一部分 / 还查不清」四词盖帽；来源可点开（结论区或抽屉有 `a[href]` 指向真实 URL）。【命令】
4. 真人访谈：本实施者做不到。材料齐备后在 NOTES 把「等人裁 / 等人试」单独列出。【人评】

## Gate

- `cd apps/server && npx tsc --noEmit`
- `./ops.sh check`
- `cd apps && npx vitest run src/lib/knowledgeStore.test.ts src/lib/atomSearch.knowledge.test.ts src/lib/casePipeline/runCasePipeline.knowledge.test.ts src/lib/agentConfigs.test.ts src/lib/crossExam/crossExam.test.ts src/lib/shareHandlers.test.ts src/goldenPath/comprehension.test.tsx`（路径以仓库实际为准）
- 收口：`cd apps && npm test`；`cd apps && npm run build`；仓库根 `npm run build`

不跑 `npm run eval:gate`。

## Evidence

- 本文件（锁定后不为让旧尝试及格而改评测口径）
- `docs/evals/2026-09-13-comprehension.md`
- 走查材料目录 `docs/reports/2026-09-13-comprehension/`
- 命令输出（测试数、tsc、ops.sh check、是否部署）
- `docs/NOTES.md` 头部「当前状态」

## 文件归属

- A：`apps/server/src/lib/shareHandlers.ts` 及分享相关测试
- B：`knowledgeStore.ts`、`atomSearch.ts`、`agentConfigs.ts`（服务端）、`orchestrate.ts`（只加知识库初稿接线，不改追问 payload）、`crossExam.ts`、对应测试
- C：`docs/evals/2026-09-13-comprehension.md`、`docs/reports/2026-09-13-comprehension/`、`apps/src/goldenPath/comprehension.test.tsx`
- 禁动：`packages/eval/`、`apps/server/eval/`、`composeFollowUpClaim*`、`followupObservation*`、追问 orchestrate payload
