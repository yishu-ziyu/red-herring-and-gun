# 公共活动层 · 验收（PR-C）

- 日期：2026-09-11
- 来源：交接包 `docs/design/2026-09-11-investigation-experience/IMPLEMENTATION_PLAN.md` §5.1、`ACCEPTANCE.md` A07–A11、`ISSUES.md` RHG-05
- 现状：调查中页面只有「快照换了 → 整块重画」。没有「刚刚做了什么、带回了什么」，用户看不到过程，只有阶段名字。

## 这件事是什么

给调查中加一层**确定性投影**的公共活动：服务器从已校验快照的差分 + 结构化 hook 生成事件，前端按 `seq` 去重累计并显示。不是模型写的直播稿，不是原始工具日志，也不是第二个真相源。

改的：

1. **契约**（`packages/core/src/investigation/activity.ts`，镜像到 `apps/server/`）：`PublicActivity` 判别联合 + typebox schema + 每 kind 的 payload 白名单。
2. **投影**：`ActivityLog` 从 `prev → next` 快照差分产出 `claim_decomposed / source_found / evidence_assessed / conflict_detected / gap_identified / judgment_revised / run_completed`；`search_started` 来自 `onAtomSearchStart`，只描述动作。
3. **传输**：SSE 新事件 `investigation_activity`，一事件一活动；先发快照，后发引用它的活动。
4. **消费**（`useInvestigationRun`）：按 `id` 去重、按 `seq` 排序、`seq` 回退忽略、终态不被晚到活动倒退。
5. **显示**（调查中画布）：活动按真实顺序出现；有引用对象的活动可点开对应来源；用户上滚看旧项时新发现不抢滚动，显示「有 N 条新发现」。

## Not this

- 不直播内部思考：不新增 `agent_thought` / systemPrompt / provider 原始报错入口。
- 不把活动层升成第二个真相源：快照坏不伪造结果，活动坏不影响结果。
- 不发明引用：`Search` 事件没有可归属的 claim 就不写 `claimIds`，宁可只描述动作。
- 不加 `evidenceIds`：`InvestigationEvidenceLink` 没有稳定 id，编一个就是改 schema，超出本轮。字段等 PR-D 有 run 内证据 id 再加。
- 不做跨刷新的重放：`seq` 持久化与补发属于 PR-D（RunService）。本轮流断了活动就断，不假装能续。
- 不猜引用关系：服务端只从结构化字段取关联，不读自由文本。
- 不改 `runCasePipeline` 的核查逻辑与 `toPublicStreamEvent` 的错误收敛口径。

## Evaluator

### 契约与投影（命令）

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| C1 | 新命题 → `claim_decomposed`；新来源 → `source_found`；判定出现/改变 → `evidence_assessed`（含 `judgment_revised`）；新争点 → `conflict_detected`；新缺口 → `gap_identified`；phase=complete → `run_completed` | `apps/server/src/lib/investigation/activity.test.ts` | 命令 |
| C2 | `seq` 从 1 起单调 +1；`id` = `runId:seq`，不含时间戳；跨实例同输入同 seq | 同上 | 命令 |
| C3 | 同一快照重复投影不产生新活动；再投影一次 `prev===next` 结果为空 | 同上 | 命令 |
| C4 | 引用纪律：每个活动的 `claimIds` / `sourceIds` 都存在于同一 revision 的快照里 | 同上 | 命令 |
| C5 | 没有可归属对象的事件只描述动作：`search_started` 的 `claimIds`、`sourceIds` 都为空 | 同上 | 命令 |
| C6 | payload 白名单：塞进 provider 原文、`agent_thought`、`systemPrompt`、`apiKey` 都不出现在活动的任何字段（含 JSON 序列化后全文） | 同上 | 命令 |
| C7 | schema 拒绝未知 `kind`、`version≠1`、缺 `seq`、缺 `runId` | 同上 | 命令 |
| C8 | 镜像：`activity.ts` 两侧字节一致 | 两侧 `mirror.test.ts` | 命令 |

### 传输与消费（命令）

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| C9 | `applyRunEvent` 收到同 `id` 两次只留一条；乱序到达按 `seq` 稳定；`seq` 回退忽略 | `apps/src/goldenPath/useInvestigationRun.test.tsx` | 命令 |
| C10 | `complete` 之后到达的活动不改 state（终态不倒退） | 同上 | 命令 |
| C11 | 非法活动（schema 不过）不进 state；活动层全坏时只有快照的流仍渲染完整结果 | 同上 + `goldenPath.test.tsx` | 命令 |
| C12 | `mvp/server` 发出活动：`onInvestigationSnapshot` 先发快照再发活动，且活动引用得进已发快照 | `apps/server/src/handlers.activity.test.ts` | 命令 |

### 画面（命令 + 人评）

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| C13 | 调查中画布按顺序渲染活动行，文案是模板 + 已校验字段，不出现 provider 名、token、工具原文 | `goldenPath.test.tsx` | 命令 |
| C14 | 有 `sourceIds` 的活动行可点，点开对应来源（`data-gp-source-id` 对上） | 同上 | 命令 |
| C15 | 底部不在视口时新活动不抢滚动，出现「有 N 条新发现」，点它才滚到底 | 同上 | 命令 |
| C16 | `prefers-reduced-motion` 下活动进场不位移 | 同上 | 命令 |
| C17 | 门禁 | `cd apps && npm test`；`cd apps && npm run build` | 命令 |
| C18 | 真实一次调查：活动按真实顺序出现，看不到供应商日志与内部思考 | 截图 + 人评 | 人评 |

## Evidence

- 测试：`apps/server/src/lib/investigation/activity.test.ts`（12）、`apps/server/src/lib/investigationEmitter.test.ts`（4）、`apps/src/goldenPath/activity.test.tsx`（13）、两侧 `mirror.test.ts` 各加 `activity.ts`。全量 `cd apps && npm test` → 1219 过 / 1 跳过；`cd apps && npm run build` 绿。
- 关于「先红后绿」：`source_found` / `source_checked` 的转归规则是先写完投影再改的（旧规则一份材料连发两帧）。改前那版测试确实红过（`source_checked` 先于 `source_found` 出现），改成按转归只报一次后才绿。除此外，本模块是新写的，不存在“先有测试的旧实现”。评审别把它当成红-绿-重构的完整证据。
- **真实一次调查**（不是 fixture）：`POST /api/agent/orchestrate-stream`，说法「隔夜菜亚硝酸盐超标，吃了会中毒。」。真实检索与模型调用，共 27 条活动：拆题 2、开始查找 2、带回材料 10、判定材料 5、形成判断 2、还缺 4、判断修订 0、完成 1。原始流与截图落在 `preview/activity-live-real.sse.txt`、`activity-live-real.png`。
- fixture 截图：`preview/activity-desktop.png`（1440×1100，`?fixture=judging`）、`activity-mobile.png`（390×900）。
- 泄密抽查：真实流里 `investigation_activity` 帧不含 `providerErrors` / `systemPrompt` / `apiKey` / `sk-`；活动 payload 只有白名单键。
- **没做的**：C16 不适用——活动行没有进场动效（没有位移可关），不是测过而是没做；若以后加动效，`prefers-reduced-motion` 守卫要同时补。
- **已知未清**：原始 `agent_thought` 帧仍在流上（本次真实流 132 条），Golden Path 客户端不消费它们，也没有进活动层。把它们从服务端拿掉是 legacy 壳的清理，属 PR-F，本轮不动。
- 未验证项：跨刷新重放、断线补发（PR-D）。
- 回滚：`packages/core` + `apps/server` 的 `activity.ts`、`apps/server/src/lib/investigationEmitter.*`、`apps/src/goldenPath/ActivityFeed.tsx`、`activity.test.tsx` 均为新增；已有文件只动了 `index.ts` 一行导出、`handlers.ts` 三处调用、`InvestigationCanvas` / `App.tsx` 传参、`copy.ts` 文案、CSS 一段。`git revert` 本提交即可。
