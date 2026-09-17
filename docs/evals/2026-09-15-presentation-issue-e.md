# 真实用户路径自动化：命题、来源、结论、缺口对得上

Date: 2026-09-15
来源：Issue E。补 #54「看不看得懂」的机器验收，不另开 GitHub Issue。人评 5 位真人访谈本轮不做。不切 T20。

## Change

用真实用户事件走通生产壳 `apps/` 的可见路径，断言页面上的命题、来源、结论、缺口彼此对得上，而不是只检查某个组件或某个词出现。可用 fixture 与用户事件，不必真打模型。

必须覆盖：

1. **提交 → 查看命题 → 点关键依据 → 看原文摘录与命题对得上 → 保存 → 重新打开。** 重开后日期不变，不 POST 新 orchestrate。
2. **分享确认 / 撤销。** 预览只来自服务端脱敏投影；撤销后公开页明确不可用，不静默回首页。
3. **刷新恢复。** 进行中有指针则 resume GET（`/api/investigations/:id/events`），不重开调查、不扣额。
4. **五类输入里机器能覆盖的：** 混合、无实质争议、证据不足、中断。链接失败沿用已有 `inputStageLinkScrape` 测试，纳入本轮命令。

键盘 / 焦点：能用用户事件覆盖的（打开来源后 Escape 关掉抽屉）写进机器项；整页焦点顺序、屏幕阅读器、5 人访谈标人评。

## Not this

- 不为绿灯改产品门禁，不放宽 A/B/C/D 契约
- 不扩知识库、不换模型、不切 T20
- 不新建 GitHub Issue
- 不做 5 位真人访谈（标人评未做）
- 不把「组件出现了某个词」当成路径验收

## Evaluator

1. 提交混合说法：完成态结论、命题、缺口与 fixture 一致；点关键依据后抽屉里的命题文本、摘录、原文 URL 对上该条，不对上另一条。保存后重新打开：原调查日期不变，不 POST `/api/case`，`requestOrchestrateStream` 不增加。【命令】
2. 登录后分享：预览字段只来自 GET 脱敏投影（原句、结论、命题、来源 URL），不含账号邮箱。确认后可撤销；打开已撤销的 `/s/` 显示「分享链接不可用」，不是首页输入。【命令】
3. 本地有进行中指针：只 GET `/api/investigations/:id/events?after=`，不调 `requestOrchestrateStream`，不 POST 新调查，额度 remaining 不因刷新变少。【命令】
4. 无实质争议：结论与来源对上该条事实，不出现「支持与反驳双方」类建议。【命令】
5. 证据不足：无关键依据、缺口可见且对上 fixture，不把相关材料当依据。【命令】
6. 中断：已获命题仍在，不编总判断；黄卡与命题文本对得上。【命令】
7. 链接失败：已有 `inputStageLinkScrape` 覆盖「打不开仍继续、提示常驻、不把登录墙正文当说法」。纳入本轮命令。【命令】
8. 打开来源抽屉后按 Escape，抽屉关掉。【命令】
9. 5 位没有技术背景的真人按任务单走完，能指结论、依据、出处。【人评 · 未做】
10. 整页键盘焦点顺序、屏幕阅读器朗读。【人评 · 未做】

## Evidence

- 提交 → 依据 → 保存 → 重开：`presentationIssueE` 走 App 用户事件 + `mixedComplete` fixture。结论、两条命题、缺口「不覆盖重症」对上 fixture；点第二条关键依据后抽屉 claimId / 命题文本 / 摘录「普通感冒无输液指征」/ `health.gov.cn` 对上第二条，不对上第一条。Escape 关掉抽屉。重开后原调查日期不变，`requestOrchestrateStream` 仍为 1，不 POST `/api/case`。
- 分享：登录后预览字段等于 GET 脱敏投影（原句、结论、两条命题、两条来源 URL），不含账号邮箱。确认后撤销；打开 `/s/tok-e-revoked` 是「分享链接不可用」，不是首页输入。
- 刷新恢复：本地指针 `run-e-resume` / `after=4` 只 GET `/api/investigations/run-e-resume/events?after=4`，不调 orchestrate、不 POST `/api/case`、额度接口只有 GET。画面仍是进行中原句与命题，不是完成态。
- 无实质争议 / 证据不足 / 中断：同文件走 App 提交。支持态结论与 `gov.cn` 摘录对上、无「双方」芯片；证据不足无关键依据、缺口「待补证」；中断黄卡「还没有写成总判断」、两条命题仍在、不编混合总答。
- 链接失败：纳入已有 `inputStageLinkScrape`（打不开仍继续、提示常驻、不把登录墙正文当说法）。
- `cd apps && npx vitest run src/goldenPath/presentationIssueE.test.tsx src/goldenPath/presentationIssueA.test.tsx src/goldenPath/presentationIssueB.test.tsx src/goldenPath/presentationIssueD.test.tsx src/goldenPath/stopAndResume.test.tsx src/App.history.test.tsx src/goldenPath/ShareControl.test.tsx src/goldenPath/inputStageLinkScrape.test.tsx` **8 文件 71 绿**（E 专项 6）。
- 人评：5 位真人访谈未做。整页键盘焦点顺序、屏幕阅读器未做。未切 T20，未放宽 A/B/C/D。
