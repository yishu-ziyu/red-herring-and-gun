# 验收：健康探针不再消耗每日核查额度

日期 2026-09-11。线上缺陷修复。验收口径：`docs/PRODUCT_SPEC.md` 用户看见的字与失败要显式；本契约只治一个已实测的缺陷。

## 一句话任务

打开一次首页不该消耗用户当天的免费核查额度。

## 缺陷（线上实测，非推断）

线上 `gun.yishuziyu.cn`（阿里云源）实测：全新访客**只加载首页、一次调查都没发起**，额度就归零。

复现证据（2026-09-11，浏览器真实会话）：

```
GET /api/checks/quota  → {"remaining":0,"total":1,"used":1,"kind":"guest","enforced":true}
GET /api/models/health → 429 {"error":"checks_exhausted","message":"今天的免费核查用完了。登录后每天可查 3 条。"}
```

机制（三处代码连起来）：

1. 前端每次加载输入页都会探测服务可用性：`mvp/src/goldenPath/InputStage.tsx:64` 与 `mvp/src/components/v3/Dashboard.tsx:212` 都 `fetch("/api/models/health")`。
2. 该端点挂在配额闸后面：`mvp/server/src/index.ts:222` `app.get("/api/models/health", requireQuota, ...)`。
3. `mvp/server/src/lib/checkQuota.ts` 的 `gateFreeCheck` 在请求 `close` 时若 ticket 未 settle 就 `commitFreeCheck`，而 `commitFreeCheck` 会 `bucket.used += 1`。

于是探针（一个只读可用性检查、全程不发起核查）被当成一次核查记账。未登录访客每天只有 1 条（`mvp/src/lib/checkQuota.ts:3` `GUEST_DAILY_CHECKS = 1`），因此**打开一次首页就用光当天额度，第二次进入即被拦**。

`checkQuota.ts:1` 的注释自己写着「按完成的核查计，不按 Token」，实现与注释相反。

## Change

- `mvp/server/src/index.ts`：`/api/models/health` 摘掉 `requireQuota`，与同族的 `/api/models/list`（本就未挂闸）一致。
- 新增 `mvp/server/src/lib/quotaPolicy.ts`：把「哪些端点计入每日额度」收成唯一来源，`index.ts` 的闸门经它判定，不再散落在各路由的中间件列表里。
- 计额度的端点集合保持不变：`/mcp`、`/api/agent/orchestrate-stream`、`/api/agent/batch`、非生产环境的 `/api/agent/test-llm`。

## Not this

- 不改额度上限（未登录 1 条 / 登录 3 条）。
- 不改 `gateFreeCheck` 的 close→commit 反滥用语义（中止真实核查仍应计数；那是另一件事，需单独裁决）。
- 不改前端探针逻辑、文案与 `/api/models/health` 的返回结构。
- 不处理 Vercel 侧 `/api` 自环（`vercel.json` 把 `/api` 转发到自己），那是独立的一条。
- 不改 `ops.sh`、不删 `mvp/`（T20 红线）。

## Evaluator

机器项：

- **E1 策略单元测试**：`mvp/server/src/lib/quotaPolicy.test.ts` 断言
  `isQuotaGatedPath("/api/models/health")` 为 `false`，
  且 `/api/agent/orchestrate-stream`、`/api/agent/batch`、`/mcp` 为 `true`。
- **E2 反例先行**：E1 在修改前必须失败（实测记录见本文「执行记录」）。先红后绿才算修好。
- **E3 源码无残留**：`rg -n 'models/health.*requireQuota' mvp/server/src/index.ts` 无输出。
- **E4 门禁**：`cd mvp && npm test` 零失败；`cd mvp && npm run build` exit 0；`cd mvp/server && npx tsc --noEmit` exit 0；根 `npm test`、`npm run build` 保持全绿。
- **E5 端到端（部署后，真实线上）**：全新访客（无 cookie）
  1. 读 `/api/checks/quota` 记 `used₀`；
  2. 加载首页（触发探针）；
  3. 再读 `/api/checks/quota`，要求 `used` **不增加**；
  4. 重复加载一次，仍不增加。

人物评项：

- **H1** 访客是否不再一进门就被额度拦住（主观体验）。

## 执行记录（2026-09-11）

- **反例先行**：`mvp/server/src/lib/quotaPolicy.test.ts` 在改动前跑出 4 条红，含 `expected 429 to be 200`（探针被闸门拦），即线上缺陷在本地复现。
- **改后**：该文件 8/8 绿。E1/E3 通过。
- **E4 门禁**：mvp 103 文件 1168 过 / 1 跳过、mvp build exit 0、mvp/server `tsc --noEmit` exit 0；根 core 621 / eval 85 / server 21 / web 83 全绿、根 build exit 0、`qa:gate` exit 0。
- **E5 端到端（真实公网）**：清掉 `v3_guest_checks` cookie 后进门 `{"remaining":1,"used":0}`，再加载一次仍 `used:0`。另做增量判定：连续调 `/api/models/health` 5 次全部 200，`used` 增量 0（修复前第一次即 429）。
- **反向验证（确认没有误放行）**：跑完一次真实调查（「隔夜菜会致癌，等于吃毒药」，约 165 秒）后 `used` 变为 1，证明真实核查仍照常计额度。
- **勘察副产物（已记录，未改）**：额度除按访客 cookie 记，还按 IP 记一份且上限同为 `GUEST_DAILY_CHECKS`（`checkQuota.ts:182`，`checkQuota.test.ts:94`「blocks a second guest on the same IP even with a fresh cookie」是既有既定行为）。同一出口 IP 下的第二个访客会被拦。
- **运维动作**：`quota.json` 曾积压 22 个访客 + 5 个 IP 的记账（全部由本缺陷烧出，无一是真实调查），已重置两次（最终一次为验证后清零，便于演示）。备份在服务器 `/tmp/quota.json.bak-20260911`。
