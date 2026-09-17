# 首页真实案例、复制简报、历史重开、分享预览

Date: 2026-09-15
来源：Issue D（P2）。首页例子只填输入框；复制简报没有来源 URL 与核查日期，失败静默；历史重开可能走新调查；分享预览只列字段名，不是接收方实际会看见的内容。

## Change

1. **首页真实案例。** 输入下方放脱敏、人工检查过的真实已完成调查快照（至少覆盖混合说法 / 语境错位或证据不足等不同处理，可用现有生产 fixture/存量快照，明确标记）。案例卡：原说法、最重要的发现、调查日期。主操作「查看这次调查」（不发起新调查、不扣额度、不假装实时过程），次要「用同一说法重新查」。用生产结果组件渲染，不维护第二套假报告。当前例子按钮只填输入框的行为可保留，新增查看必须不走模型/搜索。
2. **复制简报。** 原句、判断、必要边界、核查日期、实际关键来源链接。剪贴板失败可见，不静默装作成功。产品署名不能当证据。
3. **历史重开。** 保持原日期，不触发新核查。本机与账号留存范围清楚，保存失败可重试。
4. **分享预览。** 预览 = 接收方实际会看见的内容，沿用服务端脱敏投影，不能用私人调查对象在前端另拼公开版。公开需显式确认；撤销后接收方不能继续读；不存在/已撤销有明确状态，不静默回首页。

## Not this

- 不扩成知识管理平台
- 不把登录/模型配置变成理解产品的前置课
- 不改 A 的来源挂接、不回退 B 阅读顺序、不回退 C 收束
- 访客仍能先用
- 不新建 GitHub Issue，不切 T20，不恢复已退役静态 demo 管线，不做公共社区

## Evaluator

1. 查看首页案例：断言没有 orchestrate-stream / 模型调用 / 扣额；有调查日期；同一套结果渲染。【命令】
2. 复制简报含来源 URL 与日期；失败路径有可见提示。【命令】
3. 历史重开不 POST 新调查、日期不变。【命令】
4. 分享预览字段与 GET 公开投影一致。【命令】
5. `cd apps && npx vitest run` 覆盖 InputStage / ProductShell / FollowUpSection / ShareControl / App.history 相关。【命令】

人评：首页案例是否一眼能看出「这是已完成调查」；复制简报是否能单独转发；分享预览是否就是接收方会看到的内容。开不了浏览器就写未做。

## Evidence

- 首页案例：`mixedComplete` / `conflictKnownReason` / `unresolvedComplete` 明确标「生产 fixture」；查看走 `InvestigationCanvas` 完成态，无 `orchestrate-stream`、无模型、额度耗尽仍可看；有调查日期。例子按钮仍只填输入框。
- 复制简报：原句、判断、必要边界、核查日期、来源 URL；失败 `role=alert`；不含「红鲱鱼与枪」。
- 历史重开：打开已留存记录不 POST `/api/case`、不调 `requestOrchestrateStream`；`.gp-original-time` 保持原 `timestamp`。抽屉写本机 / 账号范围。重试保存沿用已有时间戳。
- 分享预览：`sharePreviewContent` 只取 GET 投影的 claim / conclusion / claims / sources / 日期；`/s/` 缺失页不渲染首页输入。Vite 代理 `/s/`。
- `cd apps && npx vitest run` 覆盖 InputStage / ProductShell / FollowUpSection / ShareControl / App.history：`presentationIssueD` `ShareControl` `followUpSection` `followUpClaimDisplay` `App.history` `App.test` `presentationIssueA` `presentationIssueB` `goldenPath` `resultAndQuota` `conclusionHero.display` 共 9+ 文件 174 绿（上述一组）+ D 专项 7 绿。
- 人评：2026-09-15 Cursor 内置浏览器标签建完即消失；改用本机浏览器打开 `http://127.0.0.1:5173/`（无 fixture）。**PASS**。原文见下。
  1. 首页输入下有「已完成的调查案例」三张卡，均含原说法、最重要发现、调查日期；主操作「查看这次调查」。点混合说法后地址栏仍是 `/`，立刻 `data-gp-phase=complete`，无 investigating、无 orchestrate 请求。画布原文：「只有前半截有依据且被夸大；后半截站不住。」「完成于 2026/9/6 16:00:00」「原调查时间：2026/9/6 16:00:00。打开的是当时的记录，没有重新核查。」一眼能看出这是已完成调查。
  2. 「用同一说法重新查」离开完成态，进入 `phase=received` / 「正在调查」/ 有停止按钮，无旧日期。像新调查。
  3. 完成态可点「复制结论简报」。把 `clipboard.writeText` 拒掉后出现 `role=alert`：「没能复制到剪贴板，请重试。」没有「已复制简报」。
  4. 此人评浏览器打开时无旧历史（空：「还没有查过的说法。」抽屉写明只留本机）。重新查之后抽屉里只有刚产生的「调查中」条目，无法评「日期像旧的」。未走分享预览。
