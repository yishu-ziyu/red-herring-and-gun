# 验收矩阵 · 完成情况

本文件最初是**检查清单**，不是通过记录。2026-09-11 按实际结果逐行回填。

图例：✅ 有机器或真实跑的证据 ｜ 🔶 部分做到 / 未逐档验证 ｜ ⛔ 本轮没做

回填口径：**只认跑出来的东西**。截图要指明文件，测试要指明套件。
没有证据的行一律不写 ✅，宁可写 🔶 或 ⛔。

跑出来的失败与根因记在 `lessons.md`（同一目录），那是这份矩阵可信的原因。

| ID | 场景 | 通过标准 | 状态 | 证据 / 缺口 |
| --- | --- | --- | --- | --- |
| A01 | 1440×1000 首页 | 标题、输入、提交与人物组清楚，首屏不被说明和登录挤占 | ✅ | `preview/prb-home-desktop.png`（1440×1000，生产 `/`） |
| A02 | 1024/390/320px | 无正文横向滚动，无固定栏压住按钮，正文≥16px | 🔶 | 有 1440 / 390 / 320 代码路径与 390 截图；1024 与 320 未逐档截图 |
| A03 | 历史 API 延迟 10s | 可提交新材料，非空提交不静默返回 | ✅ | `App.history.test.tsx`：`/api/cases` 挂起时非空提交仍发起一次 |
| A04 | 双击/回车+点击 | 一个 clientRequestId 仅创建一次 run、登记一次额度 | ✅ | `runService.test.ts` D8–D10（服务端幂等）+ 前端 clientRequestId 复用；额度只登记一次未单独断言 |
| A05 | 输入+链接+图片 | 原文不被抓取正文替换；图片可看、可移除 | ⛔ | 本轮未验（能力未改动） |
| A06 | 立即进入调查 | 零快照时原材料仍可见，可返回并保留 | ✅ | `goldenPath.test.tsx` 零快照仍渲染原材料 |
| A07 | 真实搜索启动但无结果 | 仅显示动作，不显示“已找到原文” | ✅ | `activity.test.tsx` C5：`search_started` 只描述动作，不带引用 |
| A08 | 活动重复/乱序 | 同 ID 去重、按 seq 合理重放，终态不倒退 | ✅ | `activity.test.tsx` C9 去重/乱序；D13 终态不倒退 |
| A09 | 活动引用缺对象 | 等快照或显示不可用，不开错来源 | ✅ | `activity.test.tsx`：引用对象不在快照里就不渲染成可点行 |
| A10 | 有限旧事件/no activity | 仍可读快照与最终结果，不要求 fabricated activity | ✅ | `activity.test.tsx` C11：没有活动字段的流仍渲染完整结果 |
| A11 | 用户查看较早发现 | 新发现不抢滚动，显示跳转提示 | ✅ | `activity.test.tsx` C15「有 N 条新发现」 |
| A12 | reduced-motion | 无强制闪烁/移动，可完整操作 | 🔶 | 活动行没有进场动效（无可关）；既有 `prefers-reduced-motion` 守卫仍在 |
| A13 | 查找决定性依据 | 从结果出发两次点击内看到片段和来源 | 🔶 | 结果页阅读顺序重做过 9 轮；未做「两次点击内」的计时验证 |
| A14 | 来源摘要 | 不使用“原文摘录”标签；模型整理另行标注 | ✅ | `copy.ts`：`sourceExcerpt = 检索片段（非逐字原文）` |
| A15 | 证据冲突 | 两侧分别点击分别打开正确来源；同源转载不冒充独立 | ✅ | `goldenPath.test.tsx` 争点两侧独立；`a8a2eea`。**完成态原先一侧都不渲染（见 lessons F1）** |
| A16 | 结论改变 | 保留先前记录与修订信息，不复用陈旧状态 | ✅ | `judgment_revised` 活动 + 快照判断变化测试 |
| A17 | 网络断开再接 | 不重发创建请求；序号去重；连接状态不同于任务状态 | ✅ | `activity.test.tsx` C9 + `runService.test.ts` D17/D18 |
| A18 | 刷新 | GET 已有 run/快照，原结果不消失、不重新扣额 | ✅ | `stopAndResume.test.tsx` D21：接回原 run 的断点，不重开 |
| A19 | 停止 | 后端确认后显示已停止；不启动下一轮；说明在途调用边界 | ✅ | 三态停止 + 真实浏览器截图 `preview/stop-*.png`。**能力边界：不硬断在途请求** |
| A20 | 服务端重启 | 已完成报告仍在；未完成标中断，可明确重试 | ✅ | `runService.test.ts` D14 `markInterruptedOnBoot`，快照保留 |
| A21 | 保存失败 | 保留结果；可见本地/远端保存状态和重试 | ✅ | 四种保存状态可见；失败可点重试（**第一版写了「重试」却没有按钮，见 lessons F6**） |
| A22 | 重查 | 新 run 保留旧 case 版本和原调查时间，不覆盖旧记录 | ✅ | `handleRetry` 开新 run，旧 case 与时间保留 |
| A23 | 旧报告无活动 | 静态展示，说明过程未保存，零模型重建 | ✅ | restored 路径传 `activities=[]`，零模型重建 |
| A24 | 账号 A/B 切换 | 历史与本地镜像按身份隔离，无跨账号上传 | 🔶 | 沿用既有账号隔离，本轮未重验 |
| A25 | 分享权限 | 未分享的 case 在 /r 与新分享路径均无公开正文 | ✅ | `caseHandlers.test.ts`：未分享的 case `/r/:id` 与 `/api/case/:id` 都 404 |
| A26 | 显式分享+撤销 | 随机 token、只读字段白名单；撤销后不可再读取 | ✅ | `shareHandlers.test.ts` + `shareHandlers.http.test.ts`（真会话） |
| A27 | 私密字段 | 事件/分享/日志无 key、邮箱、system prompt、原始 thought | ✅ | 活动 payload 白名单 C6；公开投影白名单 S1/S2/S9 |
| A28 | 登录失败/过期/退出失败 | 状态真实、保留材料、焦点可用 | ⛔ | 本轮未验 |
| A29 | 案例回放 | 持续显示回放与原时间，零模型/零搜索/零扣额 | ⛔ | 未做：没有 `/examples` 页与回放 |
| A30 | 示例来源 | 虚构数据明确标注，禁止发布成真实调查 | 🔶 | 首页示例是教学 fixture；「已核对公共案例」层未做 |
| A31 | HTML / Markdown 注入 | 用户输入、来源文本与分享 JSON 安全转义，不执行脚本 | ✅ | 公开页转义 S6 + PR-A 的 `/r/:id` 转义 |
| A32 | URL fetch 安全 | 回环/内网/危险重定向不可抓取；BYOK base URL 也受保护 | ⛔ | 本轮未验（`ssrfGuard` 未改） |
| A33 | 200% 缩放+键盘 | 内容可读，弹窗焦点进入/约束/返回，Escape 可关 | 🔶 | Drawer 焦点进入/约束/Escape 既有；200% 缩放未验 |
| A34 | SQLite 迁移 | 原 ID/owner/时间/报告保留，重复运行不增行，备份可恢复 | ✅ | `caseStore.migration.test.ts` D1–D4，含 1205 条对照 |
| A35 | 生产入口 | 真正渲染新组件；不能只在新 demo 路由漂亮 | ✅ | `apps/src/App.tsx` ProductApp，`?fixture=` 驱动同一棵组件树 |
| A36 | 服务不可用 / 额度不足 | 不丢用户材料，不擅自新收费；回放仍可用 | 🔶 | 连接失败提示既有；额度不足路径未重验 |
| A37 | 取消时晚到请求 | 旧 run 不污染新 run，终态不会变回处理中 | ✅ | `runService.test.ts` D12（取消后不再开新轮）+ D13 |
| A38 | 幂等请求 payload 不同 | 明确 409 或等价冲突，不能复用错误输入的任务 | ✅ | `runService.test.ts` D9：payload 不同返回 conflict，HTTP 层翻 409 |
| A39 | 系统失败 vs 证据不足 | interrupted 与 completed+unresolved 区分 | ✅ | `interrupted` 与 `completed+unresolved` 分列；本轮停止态另成一说 |
| A40 | 回放/历史/探针请求 | 不进入核查计费和搜索执行路径 | ✅ | 新增只读端点不进入计费路径；`checkQuota` 未改 |

## 命令与证据

本矩阵由 `IMPLEMENTATION_PLAN.md` 的实施结果回填。当时给的命令是 `npm --prefix mvp`，
`mvp/` 现已改名 `apps/`（契约 `docs/evals/2026-09-11-mvp-to-apps.md`），实际命令：

```bash
cd apps && npm test        # 113 套 / 1281 过 / 1 跳过
cd apps && npm run build   # tsc && vite build
```

### 门禁结果（2026-09-11，最后一次回填时）

```
apps: npm test    → 113 passed | 1 skipped, 1281 passed | 1 skipped
apps: npm run build → ✓ built
```

### 真实跑过的（不是 fixture）

| 时间 | 做了什么 | 证据 |
| --- | --- | --- |
| 20:22 | 真实一次调查（隔夜菜亚硝酸盐），27 条活动 | `preview/activity-live-real.sse.txt`、`activity-live-real.png` |
| 20:35 | 真实一次调查，快照 revision 与活动 seq 落 SQLite | `run_activities` 表 20 条 seq 1..20 |
| 21:41 | 真实取消，流上收到 `run_state: cancelling` → `cancelled` | `/tmp/stopwire3.sse` |
| 21:44 | 真实浏览器停止三态 | `preview/stop-before.png`、`stop-confirmed.png` |

### 截图清单（`preview/`）

首页 `prb-home-desktop.png` / `prb-home-mobile.png`；调查中含新发现 `activity-desktop.png`、
`activity-live-real.png`；结果 `prb-complete-desktop.png` / `prb-complete-mobile.png`；
来源打开 `prb-source-desktop.png`；争议双方 `conflict-desktop.png`、`conflict-contradict-open.png`；
中断 `prb-interrupted-desktop.png`；停止 `stop-before.png`、`stop-confirmed.png`；390 手机三张。
**历史抽屉与登录/设置没有本次截图**——那两块本轮没改。

### 明确没做的付费/高风险项

- `eval:gate` 未跑（需模型费用授权；本轮的真实调用只用于验证活动层与取消）。
- 断网（非刷新）回连未验。
- `/examples/:slug` 公共案例回放未做，首页只有教学示例。
