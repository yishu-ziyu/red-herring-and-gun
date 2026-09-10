# BYO Key 接管调查管线（key 真接管）验收标准

## 背景（用户裁决 2026-09-09）

已查明现状：用户在模型设置页保存的密钥只用于本地保存与 `/api/agent/test-llm` 连接探针；真实调查管线（`/api/agent/orchestrate-stream` → `runCasePipeline`）用服务端 env 密钥（主力模型 `OPENAI_API_KEY`，检索与多 provider 走 `MINIMAX_API_KEY` / `STEPFUN_API_KEY` 等）。用户裁决「key 真接管」：调查的模型调用烧用户填的 key；MiniMax/阶跃的 key 同时供该家检索额度（token plan 复用）；其他家检索仍走服务端 env 预置。

## Change

1. 前端发起调查时（orchestrate-stream 请求），携带本地保存的 BYO 配置（`baseUrl` / `apiKey` / `modelName`）；未保存密钥时请求体与现状完全一致，行为零变化。
2. 服务端在请求携带合法 BYO 配置时：调查管线的全部主力 LLM 调用（runAgent、自证、改写、交叉质询等）使用请求内凭证（request-scoped），不再读 env 主力密钥。
3. 检索凭证绑定：BYO `baseUrl` 命中 MiniMax（`api.minimaxi.com`，含别名）→ 检索的 MiniMax token plan 路径改用用户 key；命中阶跃（`api.stepfun.com`）→ 阶跃路径改用用户 key；其他 baseUrl（含自定义）→ 检索凭证仍全部来自服务端 env，与现状一致。
4. 失败语义 fail-closed：BYO 凭证调用失败（鉴权失败/网络失败）→ 调查以用户可读错误收尾（公开流事件遵守现有 `toPublicStreamEvent` 脱敏），**不静默回退**到服务端 env 密钥继续烧服务器额度。
5. 密钥不落任何持久化面：案例存档 JSON、历史记录、服务端日志输出、公开流事件，均不含 apiKey 明文或可逆编码（沿用 test-llm「永不记录 apiKey」纪律；`console.log`/`safeLabel` 同口径）。
6. 配额闸 `requireQuota` 语义不变：BYO 请求同样过配额，不为自带 key 开后门。

## Not this

- 不改模型设置页的交互与视觉（PR #83 范围，本工作包零触碰 `ApiKeySettings.*`）。
- 不改 home 输入页模型选择器交互；BYO 存在时主力模型以设置页保存的 `modelName` 为准（endpoint 与 model 是一对，忽略请求内 modelChoice 的主力模型语义并如实按此执行）。
- 不改判词/检索/评分逻辑本身：packages/core 语义逻辑零改动，只做凭证注入接线。
- 历史重开零新增模型/检索调用（现状保持），历史回放不需要 key。
- 不动 eval:gate 基线。
- 设置页内「保存后，你的调查将使用这把密钥的额度」说明句留给 #83 合入后的小改动，不混入本工作包。

## Evaluator

1. **接管测试**：服务端流水线在请求携带 BYO 配置时，主力模型调用收到用户 `baseUrl`/`apiKey`/`modelName`（mock provider 断言 `Authorization: Bearer <用户key>` 与请求 URL）；未携带时与现状一致（env 凭证）。命令：`cd mvp && npx vitest run server/src/lib/orchestrateByo.test.ts`（实现时确定的测试文件，须覆盖上述两向断言）。
2. **检索绑定测试**：BYO baseUrl=MiniMax → MiniMax 检索 provider 收到用户 key；阶跃同理；DeepSeek/自定义 → 检索凭证仍是 env。
3. **fail-closed 测试**：BYO 调用返回 401 → 流以 error 收尾、公开错误为用户可读文案、后续无任何 env 凭证回退调用。
4. **不落盘测试**：案例存档/报告 JSON 序列化结果、console 输出（spy）、公开流事件中均断言不含 apiKey 值。
5. **全量门禁**：`cd mvp && npm test` 全绿（既有 1000+ 项零回归）；根 `npm test` 全绿；根 `npm run build` 通过；`cd mvp && npm run build` 通过。
6. 人评项：无（本工作包纯接线，无新用户可见界面；UI 说明句归 #83 后续）。

## 结果（2026-09-09）

独立验收官按契约逐条复核：Evaluator 1-5 全部 PASS，结论 ACCEPT。门禁实测：mvp 1035 过 / 1 跳过 / 0 失败（main 基线 1008 + 新增 27），根 core 605 / eval 85 / server 21 / web 83 全绿（main 基线口径），根 build 与 mvp build 均 exit 0。

验收官单列三项安全观察及处置：

1. `?execution=loop` 调试路径（默认 UI 不可达，仅 URL 参数触发）绕过 BYO 仍烧服务端密钥——已知边界，登记 NOTES，另开工作包接管。
2. `http://localhost` 前缀匹配可被 `http://localhost.evil.com` 类公网域名穿透——**本 PR 内已修**：抽出共享 `isLocalHttpUrl` 按 URL hostname 精确判定，`parseByoConfig` 与 test-llm 两处同口径换用，新增回归测试（借前缀的 http 公网域名一律拒绝；https 到公网主机本就合法，不在此列）。
3. `toPublicStreamEvent` 为 `byo_key_failed` 开白名单后，该 code 的帧将来若挂 `error` 字段不会被通用分支删除——当前唯一发射点只发固定中文文案，现状安全；后续改该帧须保持不附原始错误对象。
