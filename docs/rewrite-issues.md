# 重写期间发现、未修的问题

行为保持重写不顺手改行为。下列问题原样保留，等用户裁决要不要修、要不要发 GitHub issue。
每条写清现状、证据、影响；裁决后在「处置」一列记录。

| # | 问题 | 现状（保持中） | 证据 | 影响 | 处置 |
|---|---|---|---|---|---|
| R1 | MCP 工具调用必失败 | `/mcp` `tools/call` 请求已删除的 `POST /api/agent/orchestrate`，恒返回 `isError` + `HTTP 404` | `server/src/lib/mixerMcp.ts:171`；`index.ts` 无该路由 | 接入方拿不到核查结果 | 待裁决 |
| R2 | `/mcp` 每次 POST 都过额度闸 | `initialize`、`tools/list` 也占访客额度（是否真的扣，见 R5） | `quotaPolicy.ts QUOTA_GATED_PATHS` | MCP 握手可能耗尽访客当天次数 | 待裁决 |
| R3 | `/r/:id` 404 页文案过时 | 写「本系统是进程内存储，重启服务进程会清空历史 case」 | `caseHandlers.ts buildSharePageHtml` | 误导用户以为记录已丢 | 待裁决 |
| R4 | 刷新恢复模块注释与行为相反 | 注释说服务端会中止管线；实际继续跑 | `src/lib/investigationResume.ts` 头注释 | 只影响读代码的人 | 可随重写更正注释（不改行为） |
| R5 | 额度闸补扣监听的时序 | `gateFreeCheck` 在 `express.json()` 读完请求体之后才挂 `req.on("close")`，是否触发取决于时序 | `checkQuota.ts gateFreeCheck` | 「服务端失败退还额度」可能被提前的补扣吞掉 | Phase 2 实测后定 |
| R6 | `RunStatus.extracting` 从不写入 | 死枚举值 | `runStore.ts RUN_STATUSES` | 无 | 可随重写删（不影响落库数据） |
| R7 | 共识帧人为延时 | `afterFactSource` 每帧 `wait(220)`，客户端全部忽略 | `handlers.ts makePipelineHooks` | 每次有共识记录的调查白等几百毫秒 | 待裁决（删延时会改变帧时序，属行为变化） |
| R9 | 重启前 5 秒内的会话与额度变化会丢 | 账号、会话、额度桶只在 5 秒周期里进待写队列；SIGTERM 时的 flush 只写队列里已有的，最近一次周期之后的登录与扣额不落盘 | `jsonSnapshot.ts flushSnapshots startSnapshotLoop`；golden `g17-legacy-data` 登录后立刻重启，`list-after-restart` 返回空（会话丢了） | 发布或崩溃重启时，刚登录的用户被登出、刚用掉的额度被退回 | 待裁决 |
| R10 | 本机配置下截图调查必然失败 | 图片解析请求 `${STEPFUN_BASE_URL}/chat/completions`；本机 `STEPFUN_BASE_URL` 指向 step_plan（Anthropic 协议端点），拼出 `step_plan/chat/completions` 返回 404；`handlers.ts` 在图片解析失败时直接抛出，整次调查按服务端错误收尾 | golden `g07-image` 真实录音：6 秒内以「这次核查没能完成，请稍后重试」结束；`/api/models/health` 探针也打同一个 404 地址 | 带截图的调查一律失败，而不是跳过图片、按文字继续查。线上配置是否相同未知 | 待裁决（线上配置需确认） |
| R8 | 已提交代码引用未提交的文档 | `domain/verdict.ts` 注释指向 `docs/evals/2026-09-28-judgment-refactor.md`，该文件在 main 工作区未跟踪 | `git status` | 规则表出处在仓库里找不到 | 由用户决定是否提交该文件 |
