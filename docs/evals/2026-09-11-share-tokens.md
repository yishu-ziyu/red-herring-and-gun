# 显式分享 · 验收（PR-E）

- 日期：2026-09-11
- 来源：交接包 `IMPLEMENTATION_PLAN.md` §3.5、§5.3；`ISSUES.md` RHG-07；`ACCEPTANCE.md` A25–A27
- 现状（片一之前）：`/r/:caseId` 只能主人读（PR-A 修的），但**没有任何办法把结果给第二个人看**。想分享就只剩把私有链接发出去这一条路，而那正好是被堵死的那条。

## 这件事是什么

分享是用户**明确创建**的一次只读投影：先看清会公开哪些字段，再生成一条随机链接，可以撤销。

- `GET /api/cases/:caseId/share-preview` — 只主人可读；只看不写，告诉用户会公开什么。
- `POST /api/cases/:caseId/shares` — 只主人可建；返回明文令牌**一次**。
- `DELETE /api/cases/:caseId/shares/:shareId` — 只主人可撤销。
- `GET /s/:shareId` — 只读投影渲染公开页，**不读私有 case**。

## Not this

- 不让 `/r/:caseId` 兼任公开页。私有的还是私有的，公开的另给入口。
- 不用 caseId 派生链接：猜得出来的链接等于没有分享控制。
- 不把令牌明文落库：库里只存 sha256，泄库也换不出可用链接。
- 不用黑名单过滤敏感字段：投影用白名单构造，将来 report 多了字段默认不出去。
- 不承诺撤销能收回别人已经下载的副本；界面里明说这一点。
- 不做「复制成功但服务器没写成功」的假分享：创建失败就不给链接。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| S1 | 公开投影只含白名单字段；`ownerHash`、`feedback` 一定不在 | `shareHandlers.test.ts` | 命令 |
| S2 | 递归丢掉名字像秘密的键（apiKey / systemPrompt / debugTrace / email / memoryRecall…），保留正常字段 | 同上 | 命令 |
| S3 | 令牌随机、不可由 caseId 猜出；库里只存哈希，拿哈希当令牌读不到 | 同上 | 命令 |
| S4 | 撤销后读不到；重复撤销幂等；过期读不到；撤销后不在有效列表里 | 同上 | 命令 |
| S5 | 公开页读不到时只有一种 404 说法（不区分不存在/已撤销/已过期）且标 noindex | 同上 | 命令 |
| S6 | 公开页转义用户文本，`<script>` 不执行；渲染结论、问题、材料 | 同上 | 命令 |
| S7 | 无归属 case 谁都建不了分享；别人登着也是 404；主人能预览 | `shareHandlers.http.test.ts` | 命令 |
| S8 | 主人创建→公开页 200 且有正文→撤销→公开页 404 且无正文 | 同上 | 命令 |
| S9 | 公开页正文不含邮箱与 ownerHash | 同上 | 命令 |
| S10 | 界面：点「创建分享链接」先出预览，不直接生成链接 | `goldenPath/ShareControl.test.tsx` | 命令 |
| S11 | 界面：预览失败 / 创建失败都不给链接，不假装有 | 同上 | 命令 |
| S12 | 界面：创建后给出链接与撤销入口，撤销前先说明「已下载的副本收不回」 | 同上 | 命令 |
| S13 | 门禁 | `cd apps && npm test`；`cd apps && npm run build` | 命令 |
| S14 | 人看：公开页在不登录的浏览器里能打开，只有该公开的那些内容 | 人评 | 人评 |

## Evidence

- 测试：`shareHandlers.test.ts`（9）、`shareHandlers.http.test.ts`（6）、`ShareControl.test.tsx`（4）。全量 `cd apps && npm test` → 1279 过 / 1 跳过；`build` 绿。
- 权限测试用真会话（`requestCode → verifyAndCreate` + 签名 cookie），没有打桩权限判断。
- 未验证项：S14 人评（需要一个登录会话才能建分享；本地匿名访问建不了，属预期）。真实浏览器走查留给用户。
- 回滚：新增 `shareHandlers.ts` + 三个路由 + 一个前端组件，`git revert` 本提交即可；`shares` 表留着不删（审计）。

## 边界

- 分享链接默认 30 天有效（`SHARE_TTL_DAYS`），到期不可读；到期时间在建链接的响应里给用户。
- 分享只覆盖「结果」，不含重放过程；回放页（`/examples/:slug`）不在本轮。
