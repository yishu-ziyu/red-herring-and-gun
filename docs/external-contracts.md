# 对外契约（现状，2026-09-29，基线 `f96a37f`）

重写期间下列任何一项的形状、状态码、字段名、文案、存储格式都不许变。要变就先写进 `rewrite-issues.md` 等用户裁决。

## 1. HTTP 接口

所有 JSON 接口 `Content-Type: application/json`。「身份」指邮箱会话 cookie `v3_email_session`。「额度」指第 5 节的免费核查闸。

| 方法 路径 | 身份 | 额度 | 请求 | 响应 |
|---|---|---|---|---|
| `GET /health` | — | — | — | `200 {status:"ok", timestamp}` |
| `POST /api/agent/orchestrate-stream` | 可选 | 计 | 见 1.1 | `200 text/event-stream`（第 2 节）；`400 {message}`（JSON 不可解析 / 缺 claim / BYO 畸形 / modelChoice 非法 / 追问无权）；`409 {message, runId}`（同 clientRequestId 不同材料）；`429 {error:"checks_exhausted", message}` |
| `GET /api/investigations/:runId` | run 有主则须本人 | — | — | `200 {runId, caseId, status, revision, lastSeq, snapshot, activities, updatedAt}`；`404 {message:"没有这次调查"}` |
| `GET /api/investigations/:runId/events?after=N` | 同上 | — | — | SSE：`run_started` → N 之后的 `investigation_activity` → 最新 `investigation_snapshot` → `run_state`；终态即关，否则接直播 |
| `POST /api/investigations/:runId/cancel` | 同上 | — | — | `200 {runId, status, accepted}`（幂等）；`404` |
| `GET /api/models/list` | — | — | — | `200 {models:[{provider, model, label…}]}`；`500 {message}` |
| `GET /api/models/health` | — | — | — | `200 {status:"available"\|"unavailable"\|"unknown", message?}`（异常也回 200 unknown） |
| `GET /api/checks/quota` | 可选 | — | — | `200 CheckQuotaView`；访客时同时刷新 `v3_guest_checks` |
| `POST /api/agent/test-llm` | — | 计 | `{baseUrl, apiKey, modelName?}` | 生产 `404`；开发 `200 {ok, latencyMs, status?, error?}` 或 `400 {ok:false, error}` |
| `POST /api/agent/memory-candidates` | 必须 | — | `{action:"setStatus", id, status, reason?}` | `200 {candidate}`；`400`；`404`；`401 {error:"Not authenticated"}` |
| `POST /api/case` | 必须 | — | `{claim≤500字, report≤128KB, credibilityScore?, caseId?}` | `200 {caseId, createdAt}`；`400`；`401 {error:"login required"}`；`403`（覆盖别人的 caseId）；`413`；`429 {error:"too many saves"}`（每账号每小时 10 次） |
| `GET /api/case/:caseId` | 须是主人 | — | — | `200` 案件（去掉 ownerHash，附 `investigation`：落库快照或确定性重建）；`404 {error:"case not found", caseId}` |
| `GET /api/cases` | 可选 | — | — | 未登录 `200 {cases:[]}`；登录 `200 {cases:[{caseId, claim, createdAt, credibilityScore, status:"done"\|"interrupted", threadId?, threadClaim?, roundCount?}]}`（≤50） |
| `GET /api/cases/:caseId/share-preview` | 主人 | — | — | `200 {preview: PublicShareProjection}`；`404` |
| `POST /api/cases/:caseId/shares` | 主人 | — | — | `201 {…, url:"/s/<token>", expiresAt, preview}`；`404` |
| `DELETE /api/cases/:caseId/shares/:token` | 主人 | — | — | `200 {revoked:true, alreadyRevoked}`；`404` |
| `GET /s/:token` | — | — | — | HTML；可读 200 + `X-Robots-Tag: all`；不可读 404 + `noindex` |
| `GET /r/:caseId` | 须是主人 | — | — | HTML；主人 200，其余 404「报告未找到」 |
| `POST /api/feedback` | — | — | `{claim?, verdictType?, score?, reason}` | `200 {ok:true}`；`400 {error:"reason is required"}` |
| `POST /api/auth/email/request` | — | — | `{email}` | `200 {ok, message, delivery?, devCode…}`；`400`；`429 rate_limit`；`502 send_failed`；`503 mail_unconfigured` |
| `POST /api/auth/email/verify` | — | — | `{email, code}` | `200 {ok:true, message:"登录成功"}` + Set-Cookie；`401` |
| `GET /api/auth/email/me` | 可选 | — | — | `200 {authenticated:true, email, displayName, name, createdAt, loginCount, lastLoginAt}`；未登录 `401` |
| `PATCH /api/auth/email/profile` | 必须 | — | `{displayName≤24}` | `200 {ok, …account}`；`400 too_long` |
| `POST /api/auth/email/logout` | — | — | — | `200 {ok:true}` + 清 cookie |
| `GET /api/account/export` | 必须 | — | — | `200` 账号数据 |
| `DELETE /api/account` | 必须 | — | — | `200 {ok:true, message:"账户已删除"}` + 清 cookie |
| `GET /api/auth/aiping/login` · `/callback` · `GET /api/auth/me` · `POST /api/auth/logout` | — | — | OAuth | 未配置 `503`；回调失败 `400`/`502` 文本 |
| `ALL /mcp` | — | 计 | JSON-RPC | 见 1.2 |
| `GET /uploads/*` | — | — | — | 临时图静态文件（1h 缓存） |

### 1.1 `orchestrate-stream` 请求体

```jsonc
{
  "claim": "string，必填",
  "intake": { "text", "links":[{url, scrapeFailed?…}], "images":[{name, type, size, dataUrl}], "createdAt" },
  "memoryRecall": { … },            // 本机语义召回，可缺
  "modelChoice": { "<agentId>": { "provider", "model" } },
  "clientRequestId": "≤120 字",
  "followUp": true,                  // 追问轮
  "caseId": "上一轮服务端 caseId",   // 追问：登录用户
  "priorRound": { … },               // 追问：访客可见材料
  "byoKey": { "baseUrl", "apiKey", "modelName" },
  "execution": "loop"                // 遗留，服务端忽略
}
```

首轮不带 `followUp`/`caseId`/`priorRound` 时，`caseId`（若带）当本次案件坐标用；追问轮另生成新 caseId。

### 1.2 `/mcp`

- `GET` → `{name:"red-herring-and-gun", title:"红鲱鱼与枪", protocolVersion, transport:"streamable-http", tools:[red_herring_truth_check]}`。
- `POST` JSON-RPC：`initialize`、`tools/list`、`tools/call`。`tools/call` 内部请求 `POST http://127.0.0.1:$PORT/api/agent/orchestrate`（该路由不存在），当前恒返回 `{isError:true, content:[{type:"text", text:"HTTP 404"}]}`。每次 POST 都过额度闸。

## 2. SSE 帧

格式：`data: <JSON>\n\n`；每 15 秒一行注释心跳 `: keepalive\n\n`；响应头带 `X-Accel-Buffering: no`。客户端 60 秒收不到任何字节判断连接已断。

所有帧出门前经 `toPublicStreamEvent`：递归删 `latencyMs`、`systemPrompt`、`userContent`；删值为 provider 名或 `provider:model` 形的字段；删顶层 `detail`、`providerErrors`；`error` 帧除 `checks_exhausted` 与 `byo_key_failed` 外文案统一改成「这次核查没能完成，请稍后重试」；`agent_error`/`tool_error` 的 `error` 统一改成「这一步没能完成，核查会按现有材料继续」。

| type | 何时 | 客户端 |
|---|---|---|
| `run_started {runId, caseId}` | 建 run 后第一帧；重连也有 | 记 runId |
| `run_state {status, terminal}` | 取消受理、收尾、重连 | 驱动 stop 与 connection |
| `investigation_snapshot {investigation}` | 每个里程碑，第 4 节 | 唯一能让命题出现的通道 |
| `investigation_activity {activity}` | 快照差分与动作钩子 | 活动流 |
| `timeout_pending` | 总时限到、宽限开始 | 「还在查」提示 |
| `complete {claim, steps, finalReport, memoryCandidates}` | 成功或超时收尾 | 取 finalReport 与内嵌快照 |
| `error {message, code?}` | 失败收尾 | failed |
| `agent_start/thought/complete/error`、`tool_start/result/error`、`search_progress`、`consensus_debate_round/final` | 过程 | 忽略（只保留给调试与 eval） |

帧序约束：同一 revision 的活动总在该快照之后；终态 `run_state` 之后连接关闭。

## 3. 公共活动 `PublicActivity`

`{version:1, id:"<runId>:<seq>", runId, seq, kind, role, claimIds[], sourceIds[], payload, at}`。
kind 为封闭枚举（拆出问题、开始查找、带回材料、判定材料、形成判断、判断改变、发现分歧、还缺、命中知识库、上一轮复用、调查完成等），每个 kind 有固定角色与 payload 白名单，值截 160 字。源：`server/src/lib/investigation/activity.ts`。

## 4. 快照 `InvestigationSnapshotV1`

源：`server/src/lib/investigation/schema.ts`（typebox，`additionalProperties:false`，与 `packages/core` 字节镜像）。

```text
{ schemaVersion:1, originalClaim, phase, checkedAt?, preClaimWork?, scope?{includedClaimIds, deferredClaimIds},
  claims:[{ id, text, order, originalSpan?{start,end}, checkability, progress, judgment|null, boundary?,
            evidence:[{sourceId, role, finding?, limitation?, sectionTitle?, passage?, relationReason?, provenance?, originDate?}],
            gaps:[{id, claimId, description, consequence?, status, resolvedBySourceIds?}] }],
  sources:[{ id, url, title, excerpt?, publishedAt?, retrievedAt?, reachable?, provenance?, originDate? }],
  conflicts:[{ id, claimId, summary, sides:[{position, sourceIds, summary?}], reason?, reasonStatus, unresolved }],
  conclusion?:{ directAnswer, verdictLead?, judgment, rationale?, boundaries[], claimIds[], sourceIds[] } }
```

枚举：phase = received/decomposed/investigating/judging/complete/interrupted；checkability = checkable/not-applicable/trace-only；progress = pending/searching/complete/interrupted；judgment = supported/refuted/mixed/unresolved/not-applicable；role = unassessed/support/contradict/context-only。
不变量见 `state-model.md` 第 4 节。客户端对不过校验的快照一律丢弃。

## 5. 报告 `finalReport`（落库与完成帧）

`finalReport` 是没有 schema 的开放对象，但以下读者依赖这些字段，重写后必须照旧产出：

| 字段 | 读者 |
|---|---|
| `investigation`（完成态快照） | 客户端完成态、历史重开、服务端 `GET /api/case` |
| `conclusion`、`memo` | 追问拼装（`previousAnswerText`）、快照重建 |
| `credibilityScore` | 本机历史、`POST /api/case`、`/r` HTML、分享 |
| `_source`（`error-boundary` / `restored-snapshot` …） | 历史状态「中断」判断、`POST /api/case` 形状校验 |
| `checkedAt` | 分享投影、快照 |
| `investigationThread` | 客户端线程恢复（分享时剔除） |
| `imageOrigin` | 完成态原图出处卡（side-channel） |
| `rewrittenClaim.cautious/publicFacing` | `/r/:id` HTML |
| `verdictType`、`faceVerdict`、`subclaimVerdicts`、`claimItems`、`nonVerifiableAtoms`、`citationSources`、`evidenceChain`、`crossExam`、`evidencePursuit`、`causalBoundary`、`sentenceVerdict`… | 快照构建与重建、ClaimReview、eval、追问复用 |

`POST /api/case` 只接受「像报告」的对象：`_source==="error-boundary"` 或有 `conclusion`/`allowedConclusion` 字符串或 `subclaimVerdicts`/`claimAtoms` 数组。

ClaimReview JSON-LD（`claimReview.ts`）：schema.org `ClaimReview`，author「红鲱鱼与枪」，`reviewRating` 0–100。

## 6. 持久化格式

- SQLite 表与迁移版本见 `state-model.md` 1.2。新版本只能追加迁移。
- 本机历史条目 `KnowledgeBaseEntry`：`{id, claim, rumorType:"深度核查", diagnosis, finalReport, handoffSteps:[], credibilityScore, timestamp, tags:["golden-path"]}`。
- 进行中指针、BYO 存储、cookie 见 `state-model.md` 1.3。
- 访客额度 cookie 与会话 cookie 用 `AIPING_SESSION_SECRET` 签名；生产要求该密钥 ≥16 字符，否则启动退出。

## 7. 外部系统

| 系统 | 调用方 | 通道 | 用途 |
|---|---|---|---|
| MiniMax（`api.minimaxi.com/anthropic`，M2.7-highspeed 默认，M3 可选） | 服务端 | fetch，Anthropic 协议 | 拆题、自证、核查、来源审计、改写、审计、报告 |
| StepFun（`api.stepfun.com/step_plan/v1/messages` 与 `/v1`） | 服务端 | fetch | 质询第二意见、视觉解析、Step Plan 检索 |
| DeepSeek、MiMo（`token-plan-*.xiaomimimo.com`）、360（`api.360.cn/v1`）、OpenAI 兼容 | 服务端 | fetch | provider 链后备 |
| 本地 codex 可执行文件（`CODEX_BIN`） | 服务端 | `execFile` | 可选慢速兜底 |
| Anthropic 代理配置 | 服务端 | 读 env，缺省读 `~/.claude/settings.json` | 可选 provider |
| 360 mweb、Tavily、Exa、Metaso、AnySearch MCP、MiniMax coding_plan search、StepFun MCP web_search | 服务端 | fetch 并行矩阵 | 检索；有 key 才进矩阵，失败不阻断 |
| 360 以图搜图（`api.360.cn/saas/vertical`） | 服务端 | fetch，图片经 `/uploads` 公网可达 | 原图出处（需 `PUBLIC_BASE_URL`） |
| 任意来源 URL | 服务端 | fetch | 引用探活（2xx/3xx/401/403/405/429 活；404/408/410/5xx/网络失败死；超时算活） |
| r.jina.ai | **浏览器** | fetch | 链接正文抓取 |
| Resend / SMTP | 服务端 | fetch / node:net+tls | 登录验证码邮件 |
| AI Ping OAuth（`central.qc-ai.cn`） | 服务端 | fetch | 可选登录 |

## 8. 环境变量

模型：`MINIMAX_API_KEY` `MINIMAX_TOKEN_PLAN_KEY` `MINIMAX_BASE_URL` `MINIMAX_API_HOST` `MINIMAX_AUTH_HEADER` `MINIMAX_HEALTH_MODEL` `MINIMAX_M27_PROVIDER_TIMEOUT_MS` `MINIMAX_M3_PROVIDER_TIMEOUT_MS` `STEPFUN_API_KEY` `STEPFUN_BASE_URL` `STEPFUN_MODEL` `STEPFUN_VISION_MODEL` `STEPFUN_REASONING_EFFORT` `STEPFUN_3_7_*` `DEEPSEEK_*` `MIMO_*` `AI360_*` `QIHOO_360_API_KEY` `OPENAI_*` `ANTHROPIC_*` `CODEX_BIN` `CODEX_LOCAL_MODEL` `CODEX_LOCAL_TIMEOUT_MS` `ORCHESTRATE_TEXT_PROVIDER_ORDER` `ORCHESTRATE_PROVIDER_TIMEOUT_MS` `ORCHESTRATE_BYO_TIMEOUT_MS` `ORCHESTRATE_SELFPROOF_*`。
检索：`TAVILY_*` `EXA_*` `METASO_*` `ANYSEARCH_*` `SEARCH360_REF_PROM` `STEPFUN_SEARCH_SIZE` `SEARCH_FETCH_TIMEOUT_MS` `SEARCH_PROVIDER_TIMEOUT_MS`。
运行：`PORT` `NODE_ENV` `CORS_ORIGINS` `DATA_DIR` `RHG_DB_FILE` `RHG_DATA_DIR` `UPLOAD_DIR` `PUBLIC_BASE_URL` `ORCHESTRATE_TOTAL_TIMEOUT_MS`（默认 420000）`ORCHESTRATE_LATE_GRACE_MS`（默认 120000）`CHECK_QUOTA_GUEST_LIMIT` `CHECK_QUOTA_IP_LIMIT` `OPS_CHECK_BYPASS_TOKEN`。
账号与邮件：`AIPING_SESSION_SECRET` `AIPING_CLIENT_ID` `AIPING_CLIENT_SECRET` `AIPING_AUTH_BASE_URL` `AIPING_REDIRECT_URI` `AIPING_SCOPE` `RESEND_API_KEY` `MAIL_FROM` `MAIL_FROM_NAME` `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS`。
前端：`VITE_API_BASE`；Vite 代理 `/api` `/health` `/mcp` `/r` `/s`（开发 `API_ORIGIN`）。

## 9. 发布

唯一入口 `./ops.sh deploy --yes`：本机测试与构建 → 打包 `apps/` → 上传 → 远端 Docker 重建 Express → Nginx 发 `/opt/red-herring/dist` 静态、反代 `/api/` `/health` 到 `127.0.0.1:3000`。重写不改发布入口。
