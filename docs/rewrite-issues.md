# 重写期间发现、未修的问题

行为保持重写不顺手改行为。下列问题原样保留，等用户裁决要不要修、要不要发 GitHub issue。
每条写清现状、证据、影响；裁决后在「处置」一列记录。

| # | 问题 | 现状（保持中） | 证据 | 影响 | 处置 |
|---|---|---|---|---|---|
| R1 | MCP 工具调用必失败 | `/mcp` `tools/call` 请求已删除的 `POST /api/agent/orchestrate`，恒返回 `isError` + `HTTP 404` | `server/src/lib/mixerMcp.ts:171`；`index.ts` 无该路由 | 接入方拿不到核查结果 | 待裁决 |
| R2 | `/mcp` 每次 POST 都过额度闸 | `initialize`、`tools/list` 也占访客额度（是否真的扣，见 R5） | `quotaPolicy.ts QUOTA_GATED_PATHS` | MCP 握手可能耗尽访客当天次数 | 待裁决 |
| R3 | `/r/:id` 404 页文案过时 | 写「本系统是进程内存储，重启服务进程会清空历史 case」 | `caseHandlers.ts buildSharePageHtml` | 误导用户以为记录已丢 | 待裁决 |
| R4 | 刷新恢复模块注释与行为相反 | 注释说服务端会中止管线；实际继续跑 | `src/lib/investigationResume.ts` 头注释 | 只影响读代码的人 | 已更正注释（Slice E，行为未变） |
| R5 | 额度闸补扣监听的时序 | `gateFreeCheck` 在 `express.json()` 读完请求体之后才挂 `req.on("close")`，是否触发取决于时序 | `checkQuota.ts gateFreeCheck`；2026-09-29 生产模式实测（见 R12）：被处理器提前拒绝、没有显式结算的请求，额度查询里 `remaining` 减 1 而 `used` 仍为 0——名额一直处于占用未结算状态，补扣监听没有把它记成已用 | 「服务端失败退还额度」可能被提前的补扣吞掉；未结算的占用会一直扣着当天名额 | 待裁决（与 R12 一起） |
| R6 | `RunStatus.extracting` 从不写入 | 死枚举值 | `runStore.ts RUN_STATUSES` | 无 | 保留：`RUN_STATUSES` 同时用来校验落库的 run 状态，删掉会让读旧库的判定跟着变，收益不值这个风险 |
| R7 | 共识帧人为延时 | `afterFactSource` 每帧 `wait(220)`，客户端全部忽略 | `handlers.ts makePipelineHooks` | 每次有共识记录的调查白等几百毫秒 | 待裁决（删延时会改变帧时序，属行为变化） |
| R9 | 重启前 5 秒内的会话与额度变化会丢 | 账号、会话、额度桶只在 5 秒周期里进待写队列；SIGTERM 时的 flush 只写队列里已有的，最近一次周期之后的登录与扣额不落盘 | `jsonSnapshot.ts flushSnapshots startSnapshotLoop`；golden `g17-legacy-data` 登录后立刻重启，`list-after-restart` 返回空（会话丢了） | 发布或崩溃重启时，刚登录的用户被登出、刚用掉的额度被退回 | 待裁决 |
| R10 | 本机配置下截图调查必然失败 | 图片解析请求 `${STEPFUN_BASE_URL}/chat/completions`；本机 `STEPFUN_BASE_URL` 指向 step_plan（Anthropic 协议端点），拼出 `step_plan/chat/completions` 返回 404；`handlers.ts` 在图片解析失败时直接抛出，整次调查按服务端错误收尾 | golden `g07-image` 真实录音：6 秒内以「这次核查没能完成，请稍后重试」结束；`/api/models/health` 探针也打同一个 404 地址 | 带截图的调查一律失败，而不是跳过图片、按文字继续查。线上配置是否相同未知 | 待裁决（线上配置需确认） |
| R11 | 接回与重复提交的流不做公开清洗 | 首次提交的流每帧经 `toPublicStreamEvent`（去掉模型 ID、`latencyMs`、`systemPrompt`/`userContent`、原始诊断，工具错误改成通用文案）；`GET /api/investigations/:runId/events` 与「同一 clientRequestId 重复提交」走的订阅直接写总线原始事件 | `handlers.ts investigationEventsHandler` 的 `write(event)`；golden `g12-duplicate` 重复提交那条流：2 帧带 `latencyMs`、1 帧带 `systemPrompt`、2 帧带 `minimax:` 形状的模型引用、3 帧工具错误是原始报错文本，首次提交的流一帧都没有 | 调查还在跑时刷新接回或重复提交，浏览器网络面板能看到模型 ID、内部提示词与原始报错；界面本身不显示这些字段 | 2026-10-03 用户授权修复，Issue #132：接回 write 统一清洗，超深子树截断，工具失败对象去诊断；SSE 回归覆盖首次/接回/重复，未部署 |
| R12 | 被拒绝的请求也占掉访客当天的免费次数 | 调查流处理器里，缺 claim、modelChoice 非法、JSON 解析失败三种 400 不退还额度闸发的名额（前两种已实测，第三种读代码同理；坏 byoKey、追问案件不存在、409、重复提交会退还） | `handlers.ts orchestrateStreamHandler` 的提前返回；2026-09-29 生产模式（访客每天 2 次）临时探针：缺 claim 的 400 之后 `remaining` 2 → 1，modelChoice 非法的 400 之后 1 → 0，第三个请求直接 429「今天的免费核查用完了」，一次调查都没跑 | 前端正常使用时不会发出这类请求；直接调用接口或前端出错时，访客会被自己的坏请求耗尽当天次数 | 待裁决（修法是这几个提前返回也退还名额，会改变额度计数） |
| R8 | 已提交代码引用未提交的文档 | `domain/verdict.ts` 注释指向 `docs/evals/2026-09-28-judgment-refactor.md`，该文件在 main 工作区未跟踪 | `git status` | 规则表出处在仓库里找不到 | 由用户决定是否提交该文件 |
