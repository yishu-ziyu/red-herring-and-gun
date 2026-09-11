# 任务身份与服务端运行 · 验收（PR-D）

- 日期：2026-09-11
- 来源：交接包 `IMPLEMENTATION_PLAN.md` §5.2–§5.5、`ISSUES.md` RHG-06、`ACCEPTANCE.md` A04/A17–A22/A34/A38
- 现状：任务生命周期整个握在 HTTP 处理器里。没有 runId、没有 `clientRequestId`、没有取消、没有跨刷新恢复；`caseStore` 是 Map + JSON 落盘，按 createdAt 淘汰，不是可查的存储。

## 这件事是什么

把「一次调查」变成一等对象：有身份、能取消、能重连、能刷新恢复、能查历史、能持久化。

分两片做，各自独立可验收：

- **片一（本轮）**：存储适配层 + 运行身份 + 取消。
- **片二（下一轮）**：重连与刷新恢复接口 + 前端停止按钮与保存状态。

## Not this

- 不换框架、不上 Redis / 消息队列。单进程 RunService + 本地 SQLite。
- 不装第三方 SQLite 驱动：Node 22 自带 `node:sqlite` 够用；驱动藏在 repository 接口后面。
- 不迁移认证数据库；不动额度业务规则（沿用现有 checkQuota 的预留/退还口径）。
- 不删旧记录、不伪造旧记录的时间。
- 不把「已停止」写在前端：只有后端确认终态才显示。
- 片一不做前端画面；没有后端能力之前前端一个字都不加。

## Evaluator

### 片一 · 存储与迁移（命令）

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| D1 | 旧 `cases.json` 幂等导入：caseId / ownerHash / createdAt / report 全部保留；同一份文件导入两次不增行 | `apps/server/src/lib/caseStore.migration.test.ts` | 命令 |
| D2 | 导入前先备份 `cases.json`，备份文件名带时间戳且内容与原件字节一致 | 同上 | 命令 |
| D3 | 缺字段的旧记录保持未知：没有 createdAt 的条目不被当前时间填充，标 `createdAtUnknown` | 同上 | 命令 |
| D4 | 超过 LRU 上限（1000）的旧记录不静默丢弃：导入后 `caseCount()` = 原文件条数 | 同上 | 命令 |
| D5 | `putCase` / `getCase` / `listCases` / `appendCaseFeedback` 行为与旧的 Map 实现一致（既有 `caseStore.test.ts` 全绿） | `apps/server/src/lib/caseStore.test.ts` | 命令 |
| D6 | 重启后记录仍在：新开一个 store 实例读同一个库，能读到刚写的 case | 同上 | 命令 |
| D7 | 存储层不变量：`activities(runId, seq)` 唯一；写入活动必须带已存在的 run | `apps/server/src/lib/runStore.test.ts` | 命令 |

### 片一 · 运行身份与取消（命令）

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| D8 | 同一身份下同一 `clientRequestId` 重复创建返回同一个 runId，且不新建 run | `apps/server/src/lib/runService.test.ts` | 命令 |
| D9 | 同一 `clientRequestId` 但 payload 不同 → 明确冲突（409 语义），不复用旧 run | 同上 | 命令 |
| D10 | 不同身份用同一 `clientRequestId` 互不影响（按身份作用域） | 同上 | 命令 |
| D11 | `cancel(runId)` 幂等：第一次把状态推进到 `cancelling` 并 abort signal，终态再调无副作用 | 同上 | 命令 |
| D12 | 取消后不再启动新一轮：pipeline 阶段边界看到 aborted 就退出（用假管线验证调用次数） | 同上 | 命令 |
| D13 | 运行状态机：终态（completed / interrupted / cancelled）不能被后续状态倒退 | 同上 | 命令 |
| D14 | 重启后未完成的 run 标 `interrupted`，中间快照保留 | 同上 | 命令 |

### 片二 · 重连、刷新恢复、停止与保存状态

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| D15 | `GET /api/investigations/:runId` 给状态、revision、lastSeq、快照与全部活动；他人 404 | `runService.test.ts` + 真实 curl | 命令 |
| D16 | 匿名 run 靠不可猜 runId 当能力凭证；有归属的只给主人 | `handlers` 行为 + 真实 curl | 命令 |
| D17 | `GET /events?after=N` 只补发 `seq > N`，再接直播；心跳保留 | `runService.test.ts` | 命令 |
| D18 | 重连不新建 run、不扣额：同一 runId 反复读仍是同一条，`activeCount` 不变 | 同上 | 命令 |
| D19 | 终态的 run 补完就关，不挂长连接；订阅者抛错不影响其他订阅者 | 同上 | 命令 |
| D20 | 停止按钮三态：`停止调查 → 正在停止 → 已停止`，只有服务端确认才说「已停止」；已停止时不再说「中断」 | `goldenPath/stopAndResume.test.tsx` + 真实跑 | 命令 + 人评 |
| D21 | 刷新恢复：本地座标存在时接回原 run（`resume(runId, lastSeq)`）而不是重开；`clientRequestId` 双击只建一条 run | 同上 | 命令 |
| D22 | 保存状态独立显示「已保存在此设备 / 同步中 / 已同步 / 同步失败，重试」，失败不进 console 了事 | 同上 | 命令 |
| D23 | 门禁 | `cd apps && npm test`；`cd apps && npm run build` | 命令 |

## Evidence（片一）

- 驱动：`node:sqlite` 实测可用，Node v22.23.1，**不需要 flag**（只打一条 ExperimentalWarning）。因此没有新增任何依赖。
- 测试：`apps/server/src/lib/caseStore.migration.test.ts`（6）、`caseStore.test.ts`（10）、`runService.test.ts`（16）。全量 `cd apps && npm test` → 1241 过 / 1 跳过；`cd apps && npm run build` 绿。
- 迁移对照（`caseStore.migration.test.ts`）：1205 条旧记录导入后 1205 条；caseId / ownerHash / credibilityScore / report.overallStatus / createdAt 逐字段相等；同一库再打开不重复导入；缺 createdAt 的条目 `createdAt=0` + `createdAtUnknown`。
- 备份：导入前写 `cases.json.bak-<ISO>`，字节与原件一致。
- **真实取消跑通**：两次真实调查（隔夜菜反复加热、手机充电一整夜），`POST /api/investigations/:runId/cancel` 返回 `cancelling`，第一次的 run 终态落库 `cancelled`，流停止；快照 revision 与活动 seq 都落进 SQLite（20 条活动 seq 1..20）。
- **第一次实跑暴露了一个真 bug**：第二次取消时管线刚好在写最后一份报告，结果被报成 `completed` —— 用户点了停止却显示「已完成」。已改成硬规矩：`cancelling` 不可能是 `completed`，并补了两条测试。这条不是设计推演出来的，是跑出来的。
- 行为变更（需要你知道）：`caseStore` 换 SQLite 后**不再按 1000 条淘汰**。交接包 §5.4 明写「禁止静默删掉 1000 条以外的用户记录」，而 LRU 存在的唯一理由是 JSON 单文件写不动。旧的 LRU 断言已改成「不再淘汰」，保留期限要单独产品决策。
- 测试隔离：`src/test/setup.ts` 现在把 `DATA_DIR` 指到临时目录。**改之前，跑测试会直接写开发库并清空 cases 表**——这是我踩到的，先修掉才敢继续。
### 片二

- 测试：`runService.test.ts` 21 条、`stopAndResume.test.tsx` 12 条。全量 `cd apps && npm test` → 1260 过 / 1 跳过；`build` 绿。
- **真实浏览器跑完三态**：提交 → 停止调查 → 正在停止 → 已停止（服务端确认）。截图 `preview/stop-before.png`、`stop-confirmed.png`。停止后材料、活动、待核对证据都还在。
- **这一片跑出三个真 bug，全部是「看着像完成，其实是假的」那类**：
  1. **取消的终态帧到不了客户端**。总线只在 `sendEvent` 里发布，而取消的 `run_state` 是由另一个请求（POST cancel）触发的，那条路径不经过当前流的发送点。客户端于是永远停在「正在停止」，10 秒后流断，画面自己翻成「调查中断」。改成：总线是唯一出口，处理函数自己也订阅它。
  2. **`writeFrame` 用错了信号**。它拿 `disconnect.signal.aborted` 当「别写了」，而 catch 块里 `disconnect.abort()` 是「停管线」的意思。两者混用的后果：`abort` 之后的所有帧全被丢掉——包括**超时路径那条早就写好的「中断帧」**。也就是说，超时的时候前端从来就没收到过中断帧。这不是本轮引入的，是顺着这条线才浮出来的。
  3. **说了「重新调查一次」却没有按钮**。我在已停止文案里写了这句话，但那个状态下 `reviewAgain` 不渲染。现在补上按钮，并加了「说得出就必须点得到」的测试。
- 未验证项：断网（非刷新）回连；额度是否按取消口径退还（沿用现有 checkQuota，未改）。
- **能力边界（照实际写，不承诺做不到的事）**：客户端断开时服务端会中止管线并保留已获快照，所以刷新接回来的是「已中断 + 已有材料」，不是「后台继续跑」。界面上没有写「你可以随意切走，我们继续查」。
- 回滚：`cases.json` 备份在原地；删掉 `apps/server/.data/rhg.sqlite` 即回到空库（旧记录从备份恢复）；代码 `git revert` 本提交。

## 边界

- 额度、模型调用仍需真实授权；本轮不跑真实付费核查来验取消，用假管线验证 signal 传递与轮次停止。
