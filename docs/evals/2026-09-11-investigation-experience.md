# 调查体验重构 · 验收标准

- 日期：2026-09-11
- 交接包：`docs/design/2026-09-11-investigation-experience/`（`START_HERE.md` / `IMPLEMENTATION_PLAN.md` / `ISSUES.md` / `ACCEPTANCE.md`）
- 设计提议：`docs/design/2026-09-11-investigation-experience/prototype.html`（虚构教学案例，不是真实核查）
- 生产入口：`mvp/src/App.tsx` 的 `ProductApp`；默认 `/` 走 `goldenPath/`。`/?legacy=1` 是旧壳。`packages/web` 不是本轮生产入口。
- 工作树起点：`feat/investigation-experience`，基线 `632746e`。不回退、不自动合并、不部署。

## Change（用户必须能看见）

把「输入一句话，然后等待一份报告」改成「交来一份材料，看见问题怎样被拆清楚、哪些线索带来发现，最后能亲手查验判断」。

分阶段：

1. **PR-A（本轮先做完）**：未分享的调查不能靠 `/r/:id` 或 JSON 被外人读到正文；首页在历史还在加载时仍能提交新材料，不会点了没反应。
2. **PR-B**：生产组件（不是另起的 demo）按原型设计系统可点预览：首页、调查中、结果、来源、争议、历史、设置、错误态；桌面与 390px 手机截图。
3. **PR-C 起**：公共活动层、任务身份、取消/重连、显式分享接到现有核查管线。

## Not this

- 不把交接包里的「海岬市公园」虚构案例改标签当成真实调查上线。
- 不把概念拼图的阅读量、医疗/政策例子、绿色成功框里的「不准确」直接上线。
- 不只改 `packages/web`，不另建一个永远不接生产的漂亮 demo。
- 不回退用户新提交；不自动合并或部署；不花新的付费模型/搜索额度冒充已验证。
- 不重写核查算法、不换框架、不上消息队列。
- 不准删测试来让构建变绿。旧视觉断言逐项映射到新行为。

## Evaluator

### PR-A（机器，本轮硬条）

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| A1 | 有归属的 case：未登录 `GET /r/:id` 与 `GET /api/case/:id` 都是 404，响应正文不含原说法、结论、ClaimReview JSON-LD | `mvp/server/src/lib/caseHandlers.test.ts` | 命令 |
| A2 | 有归属的 case：其他账号同样 404、无正文；主人 JSON 仍 200 | 同上 | 命令 |
| A3 | 无归属的旧记录按私有处理：游客与登录用户的 `/r/:id`、`/api/case/:id` 都 404、无正文 | 同上 | 命令 |
| A4 | 主人打开自己的 `/r/:id` 仍可读；claim 含 `<script>` 时 HTML 转义，不执行脚本 | 同上 | 命令 |
| A5 | 生产首页：`/api/cases` 挂起（模拟历史延迟）时，非空提交仍发起一次 `requestOrchestrateStream`，输入不被禁用 | `mvp/src/App.history.test.tsx` | 命令 |
| A6 | 同句提醒只在历史已有可靠结果时出现；历史未就绪时不截断提交 | A5 + 既有同句测试仍绿 | 命令 |
| A7 | 前端与 server 相关测试、`mvp` build 不回归 | `cd mvp && npx vitest run src/App.history.test.tsx server/src/lib/caseHandlers.test.ts`；再 `cd mvp && npm test`、`cd mvp && npm run build` | 命令 |

### PR-B 及之后

交接包 `ACCEPTANCE.md` A01–A40 仍是总清单。PR-B 至少要有：生产组件 fixture 预览地址、桌面 1440 与手机 390 的首页/调查/结果/来源截图。视觉是否满意由用户判断。

人评：原型与生产预览是否同一套阅读体验。

## Evidence

- 改了哪些生产路径
- 先失败后通过的测试记录
- 桌面/手机截图（fixture 或 real 必须标明）
- 未跑的付费模型/搜索项标「未验证」
- 回滚：回到本分支分叉点 `632746e`

## 边界

- `eval:gate` 与真实 SSE 本轮不跑（需模型费用授权）。
- 旧 `/r/:id` 不再当公开分享入口。显式分享令牌是 PR-E，本轮不假装已经能公开分享。
