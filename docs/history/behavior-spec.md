# 行为规格（现状，2026-09-29，基线 `f96a37f`）

本文件记录 `apps/` 生产系统**实际**做什么，供行为保持重写对照。产品为什么这样设计见 `PRODUCT_SPEC.md`；
本文件只写可观察行为与它们的来源。代码、文档、实际运行冲突时，**实际用户可观察行为优先**，冲突写在第 11 节。

每条行为标一个类别：

| 标记 | 含义 | 重写时 |
|---|---|---|
| **P** 产品行为 | 用户能看见、能操作、能感知的结果 | 必须逐字保持 |
| **D** 领域行为 | 判定、筛选、绑定、收权等规则；决定 P 的内容 | 必须保持同一输入同一输出 |
| **I** 实现细节 | 用户感知不到的做法（模块划分、调用顺序中无副作用的部分） | 可以换 |
| **H** 历史偶然复杂度 | 为补旧问题叠出来的做法，本身奇怪但会影响输出 | 输出必须保持；实现可以合并重写 |

来源列里的路径都在 `apps/` 下。

---

## 1. 入口与路由

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 1.1 | `/` 显示首页输入；未知路径（含旧 `/?legacy=1`、`/demo`）都回首页输入，不另开页面 | P | `src/App.tsx` 路由分支，`App.test.tsx`「未知路径回落到生产首页」 |
| 1.2 | `/settings/api-key` 显示自带模型密钥设置页（生产也可达） | P | `App.tsx:219` |
| 1.3 | `/model-settings-preview` 只在开发构建可达 | P | `App.tsx:218` |
| 1.4 | 浏览器直接打开 SPA 的 `/s/...`（未被 Express 接管时）显示「分享链接不可用」页，不静默回首页 | P | `App.tsx:713`，`App.history.test.tsx` |
| 1.5 | Express `GET /s/:token` 输出服务端 HTML：可读时是分享投影正文（`robots index,follow`），不可读时一种说法的 404（`noindex`） | P | `server/src/lib/shareHandlers.ts` |
| 1.6 | Express `GET /r/:caseId` 输出服务端 HTML：只有案件主人可读；其余一律 404 页「报告未找到」 | P | `server/src/lib/caseHandlers.ts` |
| 1.7 | 开发构建 `/?fixture=<name>` 用脚本化快照驱动真实组件树；生产构建剔除 | I | `App.tsx:334`，`goldenPath/devFixture.ts` |
| 1.8 | 生产注册 `/sw.js` 离线壳；开发时注销所有 service worker | P | `src/main.tsx` |

## 2. 首页（输入态）

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 2.1 | 首屏只有主输入、「开始调查」、示例；不出现模型设置、AI Ping 品牌、BatchChecker、provider 控件 | P | `App.test.tsx` 前 7 条 |
| 2.2 | 加载时并行请求 `/api/models/health`、`/api/models/list`、`/api/checks/quota`；三者都不计额度 | P | `goldenPath/InputStage.tsx:132-170`，`server/src/lib/quotaPolicy.ts` |
| 2.3 | 探针 `checking` 期间、`unavailable`、或模型列表为空时，提交被拦下并显示「调查服务暂时不可用。你的材料还没有提交，请稍后重试。」，材料不清空 | P | `InputStage.tsx:127,176`，`resultAndQuota.test.tsx` |
| 2.4 | 额度用完时提交被拦下，访客提示登录并打开登录层；账号提示明天再来；材料留在框里 | P | `InputStage.tsx:172`，`resultAndQuota.test.tsx` |
| 2.5 | 点示例只把示例填进输入框并高亮，不提交 | P | `InputStage.tsx fillDemo`，`presentationIssueD.test.tsx` |
| 2.6 | 首页案例卡（生产 fixture：混合说法 / 语境错位 / 证据不足）：「查看这次调查」用同一套结果组件渲染落库快照，不 POST、不扣额；「用同一说法重新查」走正常提交（先过额度与服务检查） | P | `goldenPath/homeCases.ts`，`App.tsx:512-535` |
| 2.7 | 从首页进入调查态时滚回页顶（首页滚到案例区再点开，结论不被挤出视口）；调查态内部换轮、换 caseId 不跳 | P | `App.tsx:194` |
| 2.8 | 返回首页时输入框预填本线程原句 | P | `App.tsx:537` |
| 2.9 | 界面语言默认中文，可切英文并持久化（`rhg.uiLang`） | P | `src/lib/uiLang.ts` |

## 3. 提交

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 3.1 | 材料 = 文本 + 从文本里识别出的链接 + 图片（含视频抽帧）；三者全空时提示「先填材料」 | P | `InputStage.tsx:180`，`src/lib/caseIntake.ts` |
| 3.2 | 链接在**浏览器端**经 `https://r.jina.ai/<url>` 抓正文（15s 超时）；正文少于 200 字或命中登录墙特征判为抓取失败，失败正文不拼进说法 | P | `src/lib/linkScraper.ts` |
| 3.3 | 抓到的正文以 `\n\n【链接抓取内容】\n` 拼到用户原话之后作为 claim | P | `InputStage.tsx:188` |
| 3.4 | 只贴了打不开的链接、没有正文也没有图片：提示「链接打不开，无法确定其中的说法。请补充原文或截图，尚未开始调查。」，不发起调查，输入保留 | P | `InputStage.tsx:192`，`inputStageLinkScrape.test.tsx` |
| 3.5 | 有文字、部分链接打不开：页面级常驻提示「链接打不开（可能需要登录），已按你输入的文字继续」，切到调查态后仍在 | P | `App.tsx:749,810` |
| 3.6 | 图片只收 `image/*`、视频只收 `video/*`（抽帧，不读音轨）；有数量与总字节上限，超限给对应提示 | P | `InputStage.tsx handleAddFiles`，`src/lib/videoFrames.ts` |
| 3.7 | 纯文本、无链接无图片、且历史已读到时，若历史里有「完成」的同一句（只规范化空白）：弹「这条说法查过」对话框，给「打开旧调查 / 重新核查 / 取消」；带链接或图片的提交不做同句继承 | P | `App.tsx:496-510`，`App.history.test.tsx` |
| 3.8 | 同一份材料 5 秒内重复提交复用同一个 `clientRequestId`；服务端同身份同 id 只认一条 run | P | `goldenPath/useInvestigationRun.ts:215`，`server/src/lib/runService.ts` |
| 3.9 | 提交前在本机历史里做语义近似召回（`memoryRecall`），随请求上行；召回失败不阻断 | D | `src/lib/localMemoryRecall.ts` |
| 3.10 | 本地保存过自带模型密钥时，请求体带 `byoKey{baseUrl,apiKey,modelName}`；没保存或数据损坏时不带该字段 | P | `src/lib/agentExpansion.ts:263`，`src/lib/byoKeyRequest.ts` |
| 3.11 | URL 带 `?loop=1` 或 `?execution=loop` 时请求体带 `execution:"loop"`；服务端忽略该字段 | H | `agentExpansion.ts:271` |

## 4. 调查进行中

界面只消费通过 schema 校验的最新一份 `InvestigationSnapshotV1` 与公共活动；其余 SSE 事件在客户端被显式忽略（`useInvestigationRun.ts IGNORED_LEGACY_EVENT_TYPES`）。

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 4.1 | 还没收到快照时显示「正在拆解这句话…」 | P | `App.tsx:907` |
| 4.2 | 快照阶段 `received → decomposed → investigating → judging → complete`，中断为 `interrupted`；同一张画布承载调查中与完成态，不换壳 | P | `goldenPath/InvestigationCanvas.tsx`，`goldenPath.test.tsx` |
| 4.3 | `received` 时思考区：标题是拆题句、旁边是已等秒数；快照带 `preClaimWork:"checking"` 才换成核对句；命题出现后思考区整个消失；不出现假三步 | P | `thinkingWaitStatus.test.tsx`，`thinkingHonesty.test.tsx` |
| 4.4 | 四个角色头像（拆问题 / 找出处 / 核语境 / 作判断）的待命、执行中、完成状态绑定快照阶段；找出处右上角显示 `+N 篇` | P | `goldenPath/WorkRoles.tsx`，`goldenPath.test.tsx` 头像组 |
| 4.5 | 活动流「调查动态」按 seq 排序、按 id 去重；不在底部时显示「有 N 条新发现」；有源活动可点开来源；分歧活动是跳转按钮 | P | `goldenPath/ActivityFeed.tsx`，`activity.test.tsx` |
| 4.6 | 命题卡：未开始的默认收起；从 pending 进入 searching 自动展开一次；用户手动收起后不再强开 | P | `claimSection.test.tsx` |
| 4.7 | 检索返回后、核查前的来源显示中性「待核对」，绝不染成支持/反驳 | P | `goldenPath.test.tsx` |
| 4.8 | 第一份 `judging` 快照已经过来源方向审计，不会「先绿后改」 | D | `runCasePipeline.investigation.test.ts` |
| 4.9 | 停止按钮：有 runId 才出现；点后变「正在停止」且不可再点；服务端确认 `cancelled` 后按钮退场、显示「已停止」，材料保留；迟到的 HTTP 回执不能把已确认的终态倒退 | P | `stopAndResume.test.tsx`，`cancelReceiptRace.test.tsx` |
| 4.10 | 服务端总时限到（默认 420s）后收到 `timeout_pending`：显示「还在查，可以离开页面，稍后回来或刷新能看到结果」；晚到的 `complete` 让提示退场；流结束却没有报告时按中断收口，不停在 judging | P | `App.tsx:107,744`，`App.test.tsx` |
| 4.11 | 流中断（连接失败、60 秒无任何字节）：保留已有快照并按 `interrupted` 渲染，可重试；没有任何快照时回首页并显示「与调查服务的连接中断了，这次没有查完。请重试。」 | P | `agentExpansion.ts:345`，`App.tsx:300,731` |
| 4.12 | 「调整核查重点」：终态时直接开新一轮追问；进行中时先请求停止，等服务端终态后才开新轮；停止请求失败提示「停止请求未送达，尚未开始按新重点核查。」 | P | `App.tsx:781` |
| 4.13 | reduced-motion 下所有入场、位移动效关闭，结论立即可读 | P | `goldenPath.test.tsx`，`thinkingHonesty.test.tsx` |

## 5. 完成态

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 5.1 | DOM 阅读顺序：原句 → 直答 → 关键依据（1–3 条，无决定性证据则为 0，不拿相关材料凑）→ 缺口或边界 → 逐条命题 → 追问 → 案卷 | P | `presentationIssueB.test.tsx` |
| 5.2 | 结论第一句直接回答原句；不以「能信 / 不能信 / 只能信一部分 / 还查不清」起句；判断句与解释是两个节点 | P | `comprehension.test.tsx`，`goldenPath.test.tsx` E4 |
| 5.3 | 来源目录「收集到的来源 N」默认折叠，排在边界之后 | P | `conclusionHero.display.test.tsx` |
| 5.4 | 证据行左侧是文字+符号的关系（支持 / 反驳 / 相关）；点整行打开来源抽屉 | P | `goldenPath.test.tsx` M4 |
| 5.5 | 来源抽屉：焦点进入、Tab 闭环、Esc 与遮罩关闭、关闭后焦点回原行；窄屏是底部抽屉；快照更新时不自动关闭、不抢焦点；有摘录时标「出处原文摘录」在前；`reachable=false` 时写明原链接打不开 | P | `goldenPath.test.tsx` 抽屉组，`sourceDrawerPassage.test.tsx` |
| 5.6 | 证据标题：有命中小节时先写小节、页面标题作出处；没有就用页面标题；没有标题退回网址 | P | `goldenPath/snapshotUi.ts`，`evidenceTitle.test.ts` |
| 5.7 | 知识库复用的证据带「知识库 · YYYY-MM-DD 已核」；同一案上一轮复用带「依据来自刚才那一轮」 | P | `knowledgeMark.test.tsx` |
| 5.8 | 截图类：原图出处查到时显示独立辅助卡；没查到显示「原图出处未查到」全局缺口 | P | `goldenPath.test.tsx` |
| 5.9 | 中断：没有分条判断时写「还没有写成总判断」不编第一句；分条已齐时写「收束时中途停了」并给有界总答 | P | `handlers.investigation.test.ts`，`goldenPath.test.tsx` |
| 5.10 | 「这次没查」：原句里没进命题的分句整句留下（不按逗号切碎）；末尾「真的假的 / 是真的吗」不算没查 | P | `leftoverClaims.test.ts` |
| 5.11 | 保存状态：idle 不显示；本地已存 / 同步中 / 已同步 / 失败（失败时有可点的重试，重试不重新调查） | P | `stopAndResume.test.tsx`，`App.tsx:424` |
| 5.12 | 复制简报：含原句、判断、边界、日期、来源 URL；剪贴板失败有可见提示 | P | `presentationIssueD.test.tsx` |
| 5.13 | 可以追问：追问框 + 推荐追问胶囊；胶囊先填入框，确认后才发；元问句不生成检索追问 | P | `followUpSection.test.tsx` |
| 5.14 | 完成态不出现疾控、固定秒数、永久保留、无条件「已查验」一类编造字样 | P | `presentationIssueA.test.tsx`，`investigationDossier.test.tsx` |

## 6. 追问与线程

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 6.1 | 追问是同一线程的新一轮；请求 claim 由 `composeFollowUpClaim` 把追问放前、原对象与上一轮回答作上下文 | P | `src/lib/composeFollowUpClaim.ts` |
| 6.2 | 已登录且上一轮有服务端 caseId：请求带 `caseId` + `followUp:true`；否则带 `followUp:true` + `priorRound`（上一轮可见材料：命题、判断、可点开出处、结论）；首轮两者都不带 | P | `App.followUpLink.test.tsx`，`src/lib/priorRoundBrief.ts` |
| 6.3 | 服务端对追问的 caseId 做归属校验：不存在、属于别人、请求者未登录，统一 400「追问关联的案件不存在或无权访问」，退还额度，不建 run | P | `server/src/handlers.ts:836`，`handlers.followupValidation.test.ts` |
| 6.4 | 上一轮有可点开证据且追问被已核命题覆盖：不重新拆题，已核命题不检索，来源标 `prior-round`；冒出的新小问题只搜新的 | D | `server/src/lib/followUpReuse.ts`，`runCasePipeline.followUp.test.ts` |
| 6.5 | 轮次头列出本线程各轮；点前轮只读回看（不可追问、不可停止）；历史重开恢复各轮与各自日期 | P | `goldenPath/InvestigationThreadHeader.tsx`，`App.progressiveThread.test.tsx` |
| 6.6 | 停止一轮追问保留前面各轮，并把中断的这一轮也存下 | P | `App.progressiveThread.test.tsx` |
| 6.7 | 追问原句区只显示追问本身，不显示内部拼接；结论第一句被 IARC 类说法顶替时改写成这句追问 | P | `followUpClaimDisplay.test.tsx`，`investigationCanvasFollowUp.test.tsx` |

## 7. 历史

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 7.1 | 完成或中断的调查自动留存：先存本机 localStorage，再（已登录时）`POST /api/case` | P | `App.tsx persistResult` |
| 7.2 | 本机历史按身份隔离：匿名、每个账号各一份键；未传身份的旧键只作显式恢复 | P | `src/lib/knowledgeBase.ts:110`，`knowledgeBase.history.test.ts` |
| 7.3 | 本机存一条时，**删掉同 id 或同 claim 文本的旧条目**，最多保留 80 条 | D | `knowledgeBase.ts saveCase` |
| 7.4 | localStorage 写满时从最旧一半开始裁剪重试；仍失败则提示「调查自动保存失败，刷新后可能无法找回。请先保留当前报告。」 | P | `knowledgeBase.ts writeList`，`App.tsx:377` |
| 7.5 | 服务端存档失败提示「账户历史同步失败，暂时无法跨设备找回。」，保存状态变失败 | P | `App.tsx:397` |
| 7.6 | 服务端存档成功后，本机条目 id 换成服务端 caseId，列表与当前画布同步换 id | P | `App.tsx:403-414` |
| 7.7 | 历史列表 = 本机条目 + `/api/cases`（本人最近 50 条），同线程只留最新一轮，按时间倒序 | P | `App.tsx hydrateAccountCases groupThreadCases` |
| 7.8 | 重开历史：先读本机，再读 `GET /api/case/:id`；显示原日期「原调查时间：…。打开的是当时的记录，没有重新核查。」；零模型零检索零额度 | P | `App.tsx handleSelectCase`，`App.history.test.tsx` |
| 7.9 | 旧记录没有内嵌快照：客户端与服务端都确定性重建（`rebuildInvestigationFromReport`）；重建失败提示「这条历史暂时打不开，条目还留在列表里，可以稍后重试。」 | P | `App.tsx:131`，`caseHandlers.ts investigationForEntry` |
| 7.10 | 退出登录：清掉账户历史与进行中指针，只剩匿名本机历史；迟到的旧响应不渲染 | P | `App.tsx handleLogout`，`App.history.test.tsx` |
| 7.11 | 历史读取期间显示「正在读取调查历史…」；同句提醒只在历史读到后生效 | P | `App.tsx:861,500` |

## 8. 分享

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 8.1 | 只有已存到服务端（有 serverCaseId）的本人案件能分享；点创建先出预览，确认后才生成链接 | P | `goldenPath/ShareControl.tsx`，`ShareControl.test.tsx` |
| 8.2 | 预览与公开页都来自同一份白名单投影：去掉 ownerHash、feedback、名字像秘密的键、`investigationThread`（前轮私人调查）；追问只显示本轮问题 | P | `shareHandlers.ts buildPublicProjection` |
| 8.3 | 令牌 24 字节随机，库里只存哈希；30 天过期；撤销后读不到，再撤幂等；过期、撤销、不存在对外同一种 404 | P | `shareHandlers.ts` |
| 8.4 | 撤销分享后，私有路由 `/r/:id` 仍只给主人 | P | `shareHandlers.http.test.ts` |

## 9. 停止、刷新、断线、重启

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 9.1 | 刷新或断线**不取消**调查：服务端把「订阅者离开」和「取消」分开，管线继续跑到终态 | P | `handlers.ts:885`，`handlers.timeoutRace.test.ts` |
| 9.2 | 进行中时本机存指针 `rhg:active-run`（runId、原句、材料、lastSeq、线程、账户范围）；刷新后用它 `GET /api/investigations/:runId/events?after=N` 接回，不重开、不扣额 | P | `App.tsx:79,281`，`src/lib/investigationResume.ts` |
| 9.3 | 指针账户范围与当前账户不同则丢弃；接不回去且没有任何材料时清指针回首页 | P | `App.tsx:286,300` |
| 9.4 | 接回终态 run：补发活动与最新快照后关流，按已结束渲染 | P | `handlers.ts investigationEventsHandler`，`stopAndResume.test.tsx` |
| 9.5 | 显式停止：`POST /api/investigations/:runId/cancel` 幂等；服务端立即广播 `run_state: cancelling`，管线在下一阶段边界退出，落 `cancelled`；已点停止的 run 不会被报成 completed | P | `handlers.ts cancelInvestigationHandler`，`runService.ts finish` |
| 9.6 | 同一身份同一 `clientRequestId` 再次 POST：输入指纹相同则只订阅原 run（退还本次额度），不同则 409「同一个请求编号对应了不同的材料，这次没有重复核查。」 | P | `handlers.ts:856-871` |
| 9.7 | 进程重启：所有未到终态的 run 标 `interrupted`，中间快照保留 | P | `runService.markInterruptedOnBoot` |
| 9.8 | 超过总时限（420s）先发 `timeout_pending` 并与连接解耦，再给管线 120s 宽限：宽限内完成落 completed；宽限到仍未完成发中断快照 + 确定性「核查超过时限，先给中间结论。」报告，落 interrupted | P | `handlers.ts:1083-1196` |

## 10. 额度、登录、自带密钥

| # | 行为 | 类 | 来源 |
|---|---|---|---|
| 10.1 | 未登录访客每天 2 次、登录账号 3 次；来源 IP 每天 20 次天花板；按上海日历日；`CHECK_QUOTA_GUEST_LIMIT` / `CHECK_QUOTA_IP_LIMIT` 可覆盖 | P | `server/src/lib/checkQuota.ts`，`src/lib/checkQuota.ts` |
| 10.2 | 计额度的端点只有 `/mcp`、`/api/agent/orchestrate-stream`、`/api/agent/test-llm`；探针与只读端点不计 | P | `quotaPolicy.ts` |
| 10.3 | 开始时占位，出结果才扣；服务端自身失败退还；用户断开或取消照常计一次；BYO 密钥失败退还；超时收尾先计费 | P | `handlers.ts` catch 分支 |
| 10.4 | 额度用完返回 429，前端显示人话（访客：登录后继续；账号：明天再来） | P | `checkQuota.ts gateFreeCheck`，`agentExpansion.ts:318` |
| 10.5 | 非生产且非测试环境不执行额度；运维令牌头可绕过 | P | `checkQuota.ts isCheckQuotaEnforced hasOpsCheckBypass` |
| 10.6 | 邮箱验证码登录：6 位码 10 分钟有效，1 分钟限发一次，5 次错码作废；开发环境未配邮件时把验证码直接显示在面板上 | P | `accountStore.ts`，`emailAuthHandlers.ts` |
| 10.7 | 账号页可改显示名、导出数据、删除账号 | P | `components/v3/auth/AccountView.tsx` |
| 10.8 | 自带密钥设置页：预设厂商、测试连接（`POST /api/agent/test-llm`，5s，只放 https 与开发 localhost，拒内网）、保存到本机（base64 混淆），不回显密钥 | P | `components/v3/settings/ApiKeySettings.tsx` |
| 10.9 | 带 BYO 的调查：主力模型调用只打用户端点；端点是 MiniMax/阶跃时对应检索也换用户密钥；密钥失败 fail-closed，流以 `error{code:"byo_key_failed"}` 结束，用户看到服务端写死的中文原文，退还额度，不回退 env 密钥 | P | `server/src/lib/orchestrateByo.ts`，`handlers.ts:1144` |

## 11. 已知冲突（以实际行为为准）

| 冲突 | 实际行为（保持） | 旧说法 |
|---|---|---|
| MCP 工具调用 | `/mcp` 的 `tools/call` 内部去请求 `POST /api/agent/orchestrate`，该路由已不存在，每次返回 `isError` 与 `HTTP 404` 文本；且 `/mcp` 每次 POST 都过额度闸 | `mixerMcp.ts` 注释当作可用工具 |
| 刷新恢复 | 刷新接回的是**仍在跑**的调查 | `investigationResume.ts` 头注释说服务端会中止管线 |
| `/r/:id` 404 页 | 文案写「本系统是进程内存储，重启服务进程会清空历史 case」 | 实际已是 SQLite 持久化 |
| RunStatus `extracting` | 枚举里有，但从不写入 | `runStore.ts RUN_STATUSES` |
| 请求体 `execution:"loop"` | 客户端仍发，服务端忽略 | ADR-006 已废止 agentLoop |
| `ReasoningProvider` | 包在 App 外层，但没有任何组件消费它，挂载时不读写 localStorage | `store/reasoningStore.tsx` 头注释称「全局状态管理」 |
| `handlers.ts` 头注释 | 「域深度在 mvp/server/src/lib/」 | 目录早已改名 `apps/` |

## 12. 历史偶然复杂度（输出要保持，实现可以合并）

1. **报告收尾链**：`runCasePipeline.ts:1248-1474` 对同一个 `finalReport` 依次原地修改约 20 步：组装 → 原子级守门（false→mixed）→ 早收权门 → 短谣通道 → 公式分 → 口吻清洗 → 截图语境对照 → 附质询与追索记录 → 审稿修复 → 引用重绑 → 原图出处 → 探活剪枝 → 终收权门 → 结论重建 → 引用重绑 → 原图出处 → 整句判定规则表 → 引用重绑 → 原图出处 → 追问首句 → 链接打不开结论 → faceVerdict → checkedAt → 完成快照。整句判定已在 9-28 收成 `domain/verdict.ts` 一处决定，但前面各关仍会改 `verdictType` 与结论文字，最终输出依赖全部顺序。
2. **下划线补丁字段**：`_source`、`_mixedGuard`、`_tinyBoundSuppressed`、`_factCheckResultDerived`、`_scoreSource` 等写进报告并落库；`_source === "error-boundary"` 决定历史条目是「中断」。
3. **步骤间靠 agentId 与数组位置传数据**：`steps` 数组里 `rumor_detector` / `fact_checker` / `source_validator` / `report_composer` 多次 push，后续读取「最新一条」。
4. **快照在管线中途按 patch 累积**：`emitInvestigation` 把每次的 patch 合进 `investigationBase` 再整份重建。
5. **来源审计刷新**：用来源集合签名判断是否需要重跑 SourceValidator，时间不足 20s 时只做 fail-closed 应用。
6. **全局进程状态影响后续请求**：provider 额度耗尽/密钥失效/超时后，同一进程在一段时间内跳过该 provider（`providerRouter.ts quotaExhaustedUntil`）；检索 provider 同理（`searchProviders.ts`）。
7. **一致性共识事件**：`afterFactSource` 钩子按 220ms 间隔发 `consensus_debate_round` 帧，客户端全部忽略，只拖慢收尾。
8. **客户端与服务端同名文件**：约 10 对（`agentConfigs`、`schemas`、`checkQuota`、`interruptedSnapshot`、`investigationThread`、`semanticRecall`、`memoryCandidateTypes` 等），部分是再导出，部分是历史拷贝。

## 13. 待实测确认（Phase 2 验证）

- 额度闸 `gateFreeCheck` 在 `req.on("close")` 里补扣未结算的票。Node 16+ 请求体读完后 `req` 即触发 close，而闸门在 `express.json()` 之后才挂监听，是否实际触发取决于时序。需用真实进程测「服务端失败是否真的退还」。
- `/mcp` 的 `initialize`、`tools/list` 是否也消耗访客额度。
- 同进程连续多次调查时，provider 跳过状态对后一次结果的影响。
