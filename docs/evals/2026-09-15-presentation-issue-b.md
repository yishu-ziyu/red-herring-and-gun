# 完成态阅读顺序：先原句与直接回答，再依据与缺口

Date: 2026-09-15

## Change

默认阅读顺序：

1. 原说法（轻量、保持原意）
2. 对原说法的直接回答（全页最高文字层级，沿用 24px）
3. 1–3 条决定性依据（可点，每条知道在证明什么）。没有决定性证据时允许为零，直接展示缺口，不为凑三条把相关材料当依据
4. 仍未查清与适用边界
5. 逐条核查详情（按需展开）
6. 基于当前缺口继续查证
7. 复制／保存／分享

大块推荐追问与案卷包装不得排在核心依据之前。结果首屏不是来源站点胶囊墙。不用能信/不能信盖章当第一句，不用置信分当主视觉。沿用现有色板、字阶、人物。

追问：优先从真实缺口、未解决争点或用户未核查的原句部分生成；没有真实分歧时不要出现「双方」模板。没有适合的建议就只留自由输入。不要在本 Issue 做复制简报加来源日期（那是 D）。

## Not this

- 不改首页案例、不重造分享、不换模型
- 不前端补写更顺口的判断（A 已取消混合句替换，保持）
- 不扩大到 packages 迁移
- 不改 D（复制简报加来源日期）、不切 T20、不另起视觉系统
- 不改停止 / 中断 / 超时那几块的显示条件（Issue C 负责）

## Evaluator

1. 1440 与 390：完成态首屏能找到直接回答、首条关键依据入口（有则）、缺口提示（有则）。命令/组件测试断言 DOM 顺序，不只是元素存在。【命令】
2. 关键判断最多两次站内操作打开对应原文；路径保留真实 claimId（A 已修来源挂接，不要回退）。【命令】
3. 无真实分歧的 fixture 不出现「支持与反驳双方的分歧」类建议。【命令】
4. `cd apps && npx vitest run` 覆盖 InvestigationCanvas / ConclusionHero / ClaimSection / FollowUpSection 相关测试。【命令】
5. 人评：若 `http://127.0.0.1:5173/?fixture=mixed` 和 `complete` 能开，用 Cursor 浏览器看阅读顺序。开不了写未做。【人评】

## Evidence

- DOM 顺序：原句 → 直答 → 关键依据 → 缺口/边界 → 命题详情 → 追问 → 案卷。来源条折叠且在关键依据之后。`presentationIssueB.test.tsx` 用 `compareDocumentPosition` 断言，不只检查元素存在。
- 关键依据一次点击打开对应原文，第二条保留真实 claimId；无决定性证据时关键依据为零并展示缺口，不把 context-only 当依据。
- 无真实分歧的 `supportedComplete` 不出现「支持与反驳双方」类建议，只留自由输入。
- `cd apps && npx vitest run` 覆盖 InvestigationCanvas / ConclusionHero / ClaimSection / FollowUpSection 相关测试：`presentationIssueB` `presentationIssueA` `conclusionHero.display` `followUpSection` `claimSection` `investigationReadingOrder` `comprehension` `resultAndQuota` `investigationCanvasFollowUp` `followUpClaimDisplay` `investigationDossier` `goldenPath` 共 12 文件 186 绿。全量 vitest 另有 11 红，均为 App 中断文案 / 链接抓取 / 服务端管线（Issue C 范围），不是本 Issue 改动。
- 人评：2026-09-15。`cd apps && npm run dev` 后 `127.0.0.1:5173` 可开。Cursor 内置浏览器 `browser_tabs` 能新建标签但立刻失效，`browser_navigate` 报 No browser tab available，该面板未走通。同一 URL 用本机 Chrome 看 1440 与 390：`mixed` / `complete` / `conflict` 阅读顺序 PASS，详见走查记录。
