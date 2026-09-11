# 验收：访客额度改 2 次/人，IP 不再当单人闸

日期 2026-09-11。用户裁决：访客每天 2 次；同一 IP 是共享的，不能因为别人用过就把我挡住；测试期要能不被限制。

## 一句话任务

额度按「每个访客每天 2 次」算，同一出口 IP 不再出现「第一个人查完、后面所有人当天全被挡」。

## 现状与根因（代码 + 线上实测）

两处叠加，缺一不可：

1. **上限只有 1**：`mvp/src/lib/checkQuota.ts:3` `GUEST_DAILY_CHECKS = 1`。
2. **访客桶会继承 IP 桶的用量**（真正的元凶）：`mvp/server/src/lib/checkQuota.ts:164`

   ```ts
   memory.used = Math.max(memory.used, ip.used, cookieUsed);
   ```

   `memory` 是按访客 cookie id 分的桶，`ip` 是整条 IP 的聚合。这行让**新访客一进门就背上该 IP 上已有用量**；再配合 `guestBlocked` 里 `ip.used + ip.inflight >= GUEST_DAILY_CHECKS`，等于整条 IP 当天只允许 1 次核查。

线上实测：我自己跑完一次真实调查后，清掉访客 cookie 换「全新访客」进来，`/api/checks/quota` 仍是 `{"remaining":0,"used":1}`，界面显示「今天免费次数用完了」。

反滥用的原意（清 cookie 不能无限刷）是对的，但把「单人额度」和「整条 IP 的额度」当成同一个数字，就把共享 IP 的所有人绑在了一起。

## Change

- `mvp/src/lib/checkQuota.ts`：
  - `GUEST_DAILY_CHECKS` 1 → **2**（每个访客每天 2 次）。
  - 新增 `IP_DAILY_CHECKS = 20`（整条 IP 的当日天花板，只防滥用，不当单人额度）。
- `mvp/server/src/lib/checkQuota.ts`：
  - `guestState` 去掉 `ip.used` 对 `memory.used` 的覆盖：访客桶只记该访客自己的用量（cookie 带来的 `cookieUsed` 仍取）。
  - `guestBlocked`：访客桶对 `GUEST_DAILY_CHECKS`，IP 桶对 `IP_DAILY_CHECKS`，两者独立判定。
  - `peekCheckQuota`：`used` 报访客自己的用量（不再取 `max(memory.used, ip.used)`），`remaining` 取「访客剩余」与「IP 剩余」的较小值，界面因此不会在 IP 触顶时谎报还有额度。
  - 新增环境变量 `CHECK_QUOTA_GUEST_LIMIT`、`CHECK_QUOTA_IP_LIMIT`：给所有者测试期放宽用；不设置时用上面的默认值（`2` / `20`）。
- 测试：把「blocks a second guest on the same IP even with a fresh cookie」改为反向断言（同 IP 第二个访客**不**被挡），并新增「IP 天花板仍然生效」与「新访客不继承 IP 用量」两条。

## Not this

- 不改登录账号额度（仍是 3 次/天）。
- 不删 IP 桶：它仍是防「清 cookie 无限刷」的天花板，只是数字与单人额度解耦。
- 不改 429 的文案与 `/api/checks/quota` 的字段结构。
- 不改 `ops.sh`、不删 `mvp/`（T20 红线）。
- 不动 `health` 探针已摘出闸门那件事（上一个契约已验收）。

## Evaluator

机器项（`mvp/server/src/lib/checkQuota.test.ts`）：

- **E1 访客额度是 2**：新访客 `peekCheckQuota` 得 `{ remaining: 2, total: 2, used: 0 }`。
- **E2 用满即拦**：提交 1 次后 `remaining` 为 1；提交 2 次后为 0，`beginFreeCheck` 返回 `ok: false`。
- **E3 同 IP 第二人不被挡**（本次改动的核心）：同一 IP、干净 cookie 的第二个访客 `beginFreeCheck` 返回 `ok: true`。
- **E4 IP 天花板仍生效**：把 `CHECK_QUOTA_IP_LIMIT` 设成 2，同一 IP 下第 3 个访客被拦。
- **E5 新访客不继承 IP 用量**：同一 IP 上第一个访客用满 2 次后，第二个访客 `peek` 报 `used: 0`。
- **E6 环境变量覆盖生效**：`CHECK_QUOTA_GUEST_LIMIT=5` 时 `peek.total` 为 5。
- **E7 门禁全绿**：`cd mvp && npm test` 零失败、`mvp build` exit 0、`mvp/server tsc` exit 0、根 `npm test` 与 `npm run build` exit 0。

人评项：

- **H1** 部署后你自己在同一浏览器连查 2 次能跑通，第 3 次才提示额度用尽。
- **H2** 测试期是否需要把 `CHECK_QUOTA_GUEST_LIMIT` 放宽（我不预设你会怎么测）。

## 执行记录（2026-09-11）

- **反例先行**：改 `GUEST_DAILY_CHECKS` 与 `guestState` 后先跑旧测试，`checkQuota.test.ts` 9 条红——每条都编码了旧行为，逐条按原意重写（下面「重写而非删除」一节）。
- **改后**：`checkQuota.test.ts` 13/13 绿。新增 3 条：同 IP 第二人不被挡、IP 天花板仍生效、`CHECK_QUOTA_GUEST_LIMIT` 覆盖生效。
- **一条测试暴露了旧实现的问题**：`quotaPolicy.test.ts` 的「真实核查端点仍消耗额度」原本能过，靠的正是 `memory.used = Math.max(memory.used, ip.used, …)` 那条串味路径（不带 cookie 的请求会继承 IP 用量）。串味去掉后它立刻红，说明这条断言本身在依赖缺陷。已改成「带同一访客 cookie 连查」才断言 429——这才是在测访客自己的额度。
- **重写而非删除的断言**（每条保留原意，只换可观测判据）：
  - `does not trust the first X-Forwarded-For hop`、`prefers X-Real-IP over X-Forwarded-For`：原本用「第 2 次被拦」当作「落在同一条 IP 键上」的信号；额度变 2 后这个信号失效。改为把 `CHECK_QUOTA_IP_LIMIT` 设成 1，用 IP 天花板作信号——被测对象仍是 IP 键的取值规则，与单人额度无关。
  - `writes checks_exhausted without leaking provider words`：改成先把 2 次用满再断言 429。
- **删除的断言 1 条**：`blocks a second guest on the same IP even with a fresh cookie`——它断言的正是用户本次要求改掉的行为，由新增的 `does not block a second guest on the same IP` 反向取代。
- **门禁**：mvp 103 文件 1170 过 / 1 跳过（较上批 +2）、mvp build exit 0、mvp/server tsc exit 0；根 core 621 / eval 85 / server 21 / web 83 全绿、根 build exit 0。
- **线上实测**：同一 IP 连查 4 次额度视图，不再被拦（改动前第 2 次即挡）；新访客 `{"remaining":2,"total":2,"used":0}`。
- **测试期放宽已上线**：`CHECK_QUOTA_GUEST_LIMIT=999`、`CHECK_QUOTA_IP_LIMIT=9999` 写在**本地** `mvp/.env.local`（已被 `mvp/.gitignore:7` 覆盖，不进仓库）。**踩过一个坑**：先写在服务器 `/opt/red-herring/.env.local` 上，被随后的 `ops.sh deploy` 用本地那份覆盖掉了——`deploy_current_mvp` 里 `scp "$MVP_DIR/.env.local" …` 会覆盖远端 env，所以这类变量必须写在本地。现容器内已确认两个变量到位，线上 `{"remaining":999,"total":999}`。
- **还原办法**：删掉 `mvp/.env.local` 末尾那两行 `CHECK_QUOTA_*`（连同上面的注释），重新 `./ops.sh deploy --yes`，即恢复访客 2 条/人/天、IP 天花板 20。**注意**：放宽期间界面会显示「今天还能免费查 999 条」，给评委看之前要还原。
