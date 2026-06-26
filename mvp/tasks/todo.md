# Agent Reasoning Canvas v3

# Product Flow Acceptance Checklist 2026-06-15

目标：公网用户访问 `gun.yishuziyu.cn` 后，能完整使用“红鲱鱼与枪”的 Agent 核查服务；每一环都要有可观察证据，不能只靠 UI 文案或 demo 状态。

## AI Ping 账号体系建联 2026-06-15

建联资料：

- 产品名称：红鲱鱼与枪
- 正式域名：`https://gun.yishuziyu.cn`
- OAuth2 回调地址：`https://gun.yishuziyu.cn/api/auth/aiping/callback`
- 授权范围：`profile phone`
- grant_type：`authorization_code`

验收表：

| 模块 | 成功标准 | 当前状态 | 验收方法 | 结论 |
| --- | --- | --- | --- | --- |
| 对外注册资料 | AI Ping 运营/R&D 能据此创建 OAuth 应用并返回 client_id/client_secret | 已从 PDF 梳理固定字段并写入本清单 | 把上方 5 项发给 AI Ping；等待对方回传 client_id/client_secret | [x] 待对方开通 |
| 后端 OAuth 路由 | 未配置密钥时不影响主站；配置后可跳转授权、回调换 token、读取 userinfo | 已实现并部署 `/api/auth/aiping/login`、`/api/auth/aiping/callback`、`/api/auth/me`、`/api/auth/logout`、`/api/auth/aiping/apikeys`；当前线上未配置凭据，`/api/auth/me` 返回 `enabled:false` | `GET /api/auth/me`；配置密钥后走完整登录回调 | [x] 代码通过 |
| Cookie 与 state 安全 | OAuth state 和 session cookie 不能被篡改；callback 过期/错 state 会拒绝 | 已用 HMAC 签名 cookie，无新增中间件依赖 | `aipingAuth.test.ts` 覆盖 state/session 篡改、next redirect 清洗 | [x] 通过 |
| 前端账号入口 | 配置 AI Ping 后首页显示登录/已登录/余额/退出；未配置时不扰乱现有产品 | Dashboard 已接 `/api/auth/me`，未配置时隐藏账号条；当前线上主站 200 | 配置凭据后登录成功显示账号和点数 | [ ] 待线上凭据 |
| API Key 列表 | 登录后可拉取 AI Ping 用户 API Key 列表，用于后续平台代理/计费扩展 | 已有后端端点，返回前会脱敏 `apikey` 字段，暂不在前端展示原始 API key | 登录后请求 `/api/auth/aiping/apikeys`，确认返回结构 | [ ] 待线上凭据 |

环境变量：

```bash
PUBLIC_BASE_URL=https://gun.yishuziyu.cn
AIPING_CLIENT_ID=
AIPING_CLIENT_SECRET=
AIPING_SESSION_SECRET=
AIPING_REDIRECT_URI=https://gun.yishuziyu.cn/api/auth/aiping/callback
AIPING_AUTH_BASE_URL=https://central.qc-ai.cn
AIPING_SCOPE=profile phone
```

## MiXer Agent 入驻 2026-06-15

入驻资料：

- Agent 名称：红鲱鱼与枪
- Agent URL / Streamable MCP URL：`https://gun.yishuziyu.cn/mcp`
- MiXer 代码分析包：`exports/red-herring-and-gun-mixer-full-20260615-2050.zip`，758K，226 files；按旧包尺度保留源码/配置/文档，排除 node_modules、dist、运行日志、密钥和大图。
- 认证配置：无认证
- 传输模式：Streamable HTTP / Streamble
- 简介：面向大众用户的信息真实性核查 Agent。输入传闻、营销话术、社媒文本或网页材料后，由多 Agent 链路完成风险识别、事实核验、信源评估和最终报告。

验收表：

| 模块 | 成功标准 | 当前状态 | 验收方法 | 结论 |
| --- | --- | --- | --- | --- |
| MCP 服务入口 | MiXer 能访问一个公开 MCP URL | 已新增 `/mcp`，无鉴权；本地测试通过；公网部署被 ECS 应用层无响应阻断 | `GET https://gun.yishuziyu.cn/mcp` 返回服务信息 | [ ] ECS 恢复后部署 |
| MCP 初始化 | MiXer/客户端能完成 `initialize` 握手 | 已实现 JSON-RPC `initialize`，返回 protocolVersion、serverInfo、tools capability；本地测试通过 | POST `/mcp` 调用 `initialize` | [ ] ECS 恢复后验证 |
| 工具发现 | MiXer 能发现红鲱鱼与枪的标准工具 | 已实现 `tools/list`，工具名 `red_herring_truth_check`；本地测试通过 | POST `/mcp` 调用 `tools/list` | [ ] ECS 恢复后验证 |
| 工具调用 | 用户在 MiXer 中输入待核查材料后，能触发真实 Agent 链路 | `tools/call` 会调用本服务 `/api/agent/orchestrate` 并返回 structuredContent；本地协议测试通过，未跑公网真实调用 | POST `/mcp` 调用 `tools/call`，检查 conclusion、score、models | [ ] ECS 恢复后验证 |
| 平台注册 | Agent 出现在 MiXer 小程序 | 代码侧 URL 已准备；平台侧需手动登录小程序/开发者平台注册 | 在 MiXer 小程序“上传 Agent”粘贴 MCP URL | [ ] 待注册 |

当前阻断：2026-06-15 20:31 起，`121.89.90.68` TCP 22/80/443/3000 可建立连接，但 SSH 不返回 banner，HTTP 不返回响应；`ops.sh deploy --yes` 在 SSH banner exchange 阶段超时，说明新 MCP 代码尚未部署到公网。需要先在阿里云控制台重启或排查 ECS 负载/sshd/nginx/docker。

| 模块 | 用户视角成功标准 | 当前状态 | 验收方法 | 结论 |
| --- | --- | --- | --- | --- |
| 公网访问 | 国内普通网络打开 `https://gun.yishuziyu.cn/`，首页可见，静态资源不丢失 | 已验证域名、TLS/SNI、Nginx、前端资源、后端 API 均可用；图片资源已恢复 | 浏览器打开公网域名；检查首页 logo、输入框、模型选择、按钮；接口 `/health`、`/api/models/list` 返回 200 | [x] 通过 |
| 模型清单 | 用户能看到当前平台托管的可选模型，不需要自己填 key 才能开始 | 线上 `/api/models/list` 返回 9 个 server-managed 模型，包含 StepFun 3.7 Flash、MiniMax M3、MiniMax M2.7 Highspeed、DeepSeek、360、MiMo | 打开模型选择面板；确认 4 个 Agent 都能选择服务端已配置模型 | [x] 通过 |
| MiniMax 接入 | MiniMax 作为真实产品模型出现在可选列表，并能被 4-Agent 指定调用 | 代码已补齐并部署 `minimax` provider；线上已配置本机复用的 MiniMax key；`/api/models/list` 已出现 `MiniMax M3` 和 `MiniMax M2.7 Highspeed`；真实调用被上游返回 `rate_limit_error`：Token Plan 用量上限 `(2056)` | 充值/升级 MiniMax Token Plan 后，重新指定 `minimax:MiniMax-M3` 跑一次真实 Agent；若短期不充值，应隐藏 MiniMax 以免用户选到不可用模型 | [ ] 额度阻断 |
| 用户自配 API | 如果产品宣称支持用户自带 API key，则用户应能安全填写、验证、保存/仅会话使用，并不会写入日志 | 生产版未支持；只有 dev-only preview，且不保存密钥 | 不应对外宣称已支持 BYO API；如要做，需要补加密存储/会话密钥/后端校验/日志脱敏 | [ ] 未做 |
| 文本输入 | 用户输入一段待核查材料后，按钮状态、运行状态和错误态清晰 | 已有主输入、运行状态条和长耗时提示 | 输入普通谣言文本，点击启动真实核查；等待期间页面不能空白 | [x] 初步通过 |
| 图片输入 | 用户上传截图后，系统能解析图片或给出可见失败态 | 代码有 vision 分支；线上未完整验收 | 上传一张聊天截图/网页截图；观察 StepFun Vision 事件、提取文本、失败态 | [ ] 待验收 |
| 链接输入 | 用户粘贴链接后，链接能作为案件材料进入后续搜索/证据步骤 | case intake 有链接抽取；线上未完整验收 | 粘贴网页链接并启动；检查后续 Agent 输入、来源列表或 evidence bundle 是否包含该链接 | [ ] 待验收 |
| 4-Agent 执行 | 4 个 Agent 都有执行记录，前三步至少走真实模型，不是假 demo | 真实接口已验证 `steps=4`；默认链路前三步为 `stepfun:step-2-mini`；强制 `rumor_detector=stepfun:step-3.7-flash` 的公网请求返回 200，第一步命中 `stepfun:step-3.7-flash`，后续可自动接到 360，最终报告成功；最后一步有时超时走确定性报告兜底 | 线上 POST `/api/agent/orchestrate`；检查 steps、model、finalReport、fallback 来源 | [x] 通过 |
| 搜索与证据传递 | 搜索/证据/信源信息能进入后续 Agent，不只是前端展示 | 代码有 searchResult/evidenceBundle 传递；本轮未逐项验收线上证据进入每步 prompt/output | 用一个需要实时信源的问题跑完整链路；检查 search tool event、sources、后续 Agent evidenceBundle | [ ] 待验收 |
| 报告输出 | 成功时有最终报告；模型超时时也不能白屏 | 已修复 deterministic report fallback 可见，测试覆盖已加 | 人为制造 report composer 超时或观察线上自然超时；确认页面显示收束报告和兜底说明 | [x] 通过 |
| 失败态 | 任一步失败时，用户看到明确失败原因和下一步，而不是白屏/卡死 | 前端有 errorMessage 和 run status；未完成全场景故障注入 | 断开模型 key、断开搜索、传超大图片、模拟 500；逐项截图 | [ ] 待验收 |
| 本地案件写入 | 每次完整核查后，本案进入历史案件库 | 服务端 `JsonlAgentMemoryStore` 会写 `.agent-memory/cases.jsonl`；前端也会写 local knowledge base；线上未验收写入文件与 UI 历史一致 | 跑完线上案件后 SSH 查看 `/opt/red-herring/.../.agent-memory/cases.jsonl`；刷新页面检查历史/知识库状态 | [ ] 待验收 |
| 相似问题召回 | 第二次输入相似问题时，系统能召回第一次案件 | 服务端 `memory_search` 会读历史 case 并注入 Agent 输入；线上未完整验收二次召回 | 第一次跑“隔夜菜会致癌吗”；第二次跑“剩菜放一夜会不会致癌”；检查 memory_search hitCount > 0 和 Agent 输入包含 memoryRecall | [ ] 待验收 |
| 候选记忆确认 | 候选记忆默认只是 proposed；用户确认后才参与后续案件 | Store 支持 `proposed/accepted/rejected`，召回只搜索 accepted；但生产 Express 未注册 `/api/agent/memory-candidates` endpoint，前端确认按钮会调用缺失接口 | 点击“写入知识库”；若接口 404/失败则修服务端路由和 handler；再确认 accepted candidate 能被下一案召回 | [ ] 阻断 |
| 候选记忆不污染结论 | proposed 候选不能直接参与新案件结论；accepted 也只能作为线索/边界，不可当证据 | 代码层面 `searchAccepted` 只取 accepted；handler 有 policy 文案；但未做线上断言测试 | 构造 proposed 候选后跑相似案，确认 acceptedCandidateCount=0；确认后再跑，acceptedCandidateCount>0 且报告仍引用真实证据 | [ ] 待验收 |
| 移动端 | 手机尺寸下主要流程可用，按钮/文字不重叠 | 已做部分响应式验证；未跑完整线上 Agent 流程 | Playwright mobile 打开公网，输入、模型选择、运行、结果、候选记忆面板截图 | [ ] 待验收 |
| 性能 | 用户知道长耗时不是卡死；关键接口不会无限挂起 | 强制 `stepfun:step-3.7-flash` 的真实 orchestrate 多次通过，耗时约 110s、123s、128s；已将 3.7 reasoning effort 默认压到 `low`，并用 `STEPFUN_3_7_PROVIDER_TIMEOUT_MS=135000` 避免被全局 25s 误杀；状态条已加；report composer 有兜底；3.7 Flash 可用但不适合作为默认快速链路 | 记录 3 次线上完整运行耗时；设定 SLA：首个状态 <3s，完整报告目标 <120s，超时有兜底 | [ ] 待验收 |

## 当前 P0 阻断

- [ ] MiniMax 已接入并出现在模型列表，但 Token Plan 用量耗尽；充值前不能算真实可用。
- [ ] 补齐并验收 `/api/agent/memory-candidates` 服务端接口，否则“候选记忆确认后才参与召回”在生产链路上不成立。
- [ ] 完成一次线上二次召回验收：首次写入 case，第二次相似问题 `memory_search.hitCount > 0`。
- [ ] 完成一次候选记忆门禁验收：`proposed` 不参与，`accepted` 才进入 `acceptedCandidateCount`。

## Review

- 已确认：公网访问、服务端托管模型清单、文本主流程、4-Agent 真实执行、`stepfun:step-3.7-flash` 强制指定调用、报告兜底可见。
- 已修复：用户指定模型失败/超时不再直接中断全流程；会先记录该模型失败，再继续切换到 fallback 模型/供应商接上。
- 未确认：MiniMax 额度恢复后的真实调用、图片/链接输入、证据跨步传递、失败注入、线上 memory write/read/recall 闭环、移动端完整流程、性能 SLA。
- 关键产品口径：当前生产版是“平台托管多模型 + 用户选择模型”，不是“用户自带 API key”。

# Public Agent UX Hardening 2026-06-15

- [x] 确认公网主路径不再只看 DNS，改为同时检查域名解析、TLS/SNI、Nginx、前端静态资源、后端 `/api` 和真实 Agent 调用。
- [x] 修复前端把 `fallback:deterministic-report` 误判为非真实 demo fallback 的问题，允许模型超时后展示确定性收束报告。
- [x] Mission Control 增加运行状态条，明确展示运行状态、已用时间、当前模型链路、进度、长耗时提示和报告兜底提示。
- [x] 增加自动测试覆盖：确定性报告兜底必须可见，且不能触发“拒绝展示非真实结论”。
- [x] 跑完本轮 `npm test`、前端 build、后端 build 和浏览器级 UI 验证。

# Deployment Ops Automation

- [x] 新增根目录 `ops.sh`，统一本地检查、公网探测、远端只读检查、日志查看和受控部署入口。
- [x] 将 Docker / setup / deploy 健康检查统一为 `/health`。
- [x] 记录 `DEPLOYMENT_CHECKLIST.md`，保留最短执行路径和当前线上诊断状态。
- [x] 运行 `./ops.sh check`、`./ops.sh public`、`./ops.sh remote` 验证脚本可用。
- [x] `./ops.sh public` 增加 Google DoH 与 `--resolve` 探测，避免被本机旧 DNS / 代理 fake IP 误导。
- [x] 阿里云 Nginx 切换为 `/opt/red-herring/dist` 静态前端 + `/api/` 后端代理，并新增 `./ops.sh aliyun-domain` 验证国内直连承接路径。

## Review

- Changed files: `ops.sh`, `DEPLOYMENT_CHECKLIST.md`, `setup-server.sh`，以及后端/部署修复文件。
- Verification: `npm test` 通过 5 个测试文件、47 个测试；`npm run build` 通过；`npm --prefix server run build` 通过；`./ops.sh deploy --yes` 已部署到阿里云；`http://121.89.90.68/health` 和 `/api/models/list` 返回 200。
- Agent QA: `POST http://121.89.90.68/api/agent/orchestrate` 返回 200，4 个步骤完成；前三个 Agent 为 `stepfun:step-2-mini`，最终报告在模型超时时走 `fallback:deterministic-report`，避免 502/长时间挂起。
- DNS QA: Google / Cloudflare DoH 返回 `gun.yishuziyu.cn CNAME ba0744552526ea06.vercel-dns-017.com`，A 记录为 Vercel 边缘 IP；阿里云控制台未显示隐藏的 `gun A 76.76.21.21`。
- Vercel QA: 使用 DoH 返回的 Vercel 真实边缘 IP 强制解析后，`https://gun.yishuziyu.cn/` 返回 200，`/api/models/list` 返回 200，`/api/agent/orchestrate` 返回 4 个 Agent steps 与 `finalReport`。
- Aliyun QA: 使用 Python TLS/SNI 强制解析到 `121.89.90.68` 后，`https://gun.yishuziyu.cn/`、`/health`、`/api/models/list` 均返回 200；`/api/agent/orchestrate` 返回 4 个 Agent steps 与 `finalReport`。
- Remaining risk: 本机系统 DNS / 代理路径仍把 `gun.yishuziyu.cn` 解析到旧 `76.76.21.21` 并导致普通 curl TLS 失败；这是本机解析缓存/代理拦截问题，不是公网 DNS 配置问题。

# Mock Streaming Reasoning Data Generator

- [x] 阅读 `docs/TECH-SPEC-streaming-reasoning.md` 和 `src/lib/streamingTypes.ts`。
- [x] 建立临时契约测试并确认 RED：`streamingMock.ts` 缺失导致测试失败。
- [x] 实现 `src/lib/streamingMock.ts` 的会话创建、完整会话生成、流式事件和取消机制。
- [x] 运行契约测试、TypeScript 检查和 build。

## Review

- Changed files: `src/lib/streamingMock.ts`, `tasks/todo.md`。
- Verification: 临时运行时契约检查通过；`npx tsc --noEmit` 通过；`npm run build` 通过。
- Remaining risk: 未接入前端组件，本轮只实现数据层。

- [x] 确认项目目录、入口文件、数据层和文档位置。
- [x] 新增 reasoning canvas 数据模型与预置节点/边/trace。
- [x] 新增三栏 Canvas 工作台组件。
- [x] 将 App 入口切到 ReasoningWorkspace。
- [x] 重写样式为 Agent reasoning canvas 工作台。
- [x] 更新 MVP spec 和 demo script。
- [x] 运行 build 并做浏览器交互验证。

# User-directed Node Expansion v4

- [x] 拆包查看 Kimi 原型，确认其 Canvas / Trace / Inspector / Dock 结构。
- [x] 将自动展开改为前三层问题空间后暂停。
- [x] 在 Node Inspector 增加节点追问、能力选择和中控 LLM 调度入口。
- [x] 新增用户触发后的动态 Canvas 节点和边。
- [x] 调整节点尺寸和布局，避免用户发散分支重叠。
- [x] 更新 MVP spec 和 demo script。
- [x] 运行 build 和浏览器交互验证。

# Layered Canvas Design + Drag v5

- [x] 搜索并参考开源 DESIGN.md / Design System 规范，把本项目视觉规则沉淀为 `DESIGN.md`。
- [x] 将 `DESIGN.md` 扩展为 YAML tokens + Markdown rationale 的双层结构。
- [x] 将 Canvas 节点改为可拖拽，拖拽状态只覆盖前端布局，不污染原始 reasoning 数据。
- [x] 增加节点拖拽手势样式，避免拖拽时误选中文字或触发页面滚动。
- [x] 运行 build 并在 `http://127.0.0.1:4173/` 验证拖拽。

# Flowith-inspired Canvas Shell v6

- [x] 搜索 Flowith 公开产品叙事，确认其核心是 AI Canvas / Knowledge Garden / 多线程空间工作台。
- [x] 将主界面改成 Flowith-inspired shell：左侧工具 rail、顶部浮动 command bar、中央 Context Canvas、右侧 Context Inspector。
- [x] 在 Canvas 内增加 mode pills 和 selected-thread metadata，降低报告页感。
- [x] 更新 `DESIGN.md`，把 Flowith-inspired UX Direction 写入设计规范。
- [x] 运行 build 和浏览器视觉验收。

# Opus Partial Recovery

- [x] 定位 Opus / Antigravity 未完成会话日志：`.gemini/antigravity-cli/brain/b496847f-794c-404c-a4a7-1a4785de5000/.system_generated/logs/transcript.jsonl`。
- [x] 确认该会话只完成项目阅读，没有产出正式规划 artifact。
- [x] 将半截调研的可复用价值整理到 `docs/OPUS_PARTIAL_RECOVERY.md`。

# Recursive Evidence Search v7

- [x] 将 Opus 半截调研、Maigret 递归搜索和当前 v6 架构整理成 `docs/RECURSIVE_EVIDENCE_SEARCH_PLAN.md`。
- [x] 在 `docs/MVP_V3_SPEC.md` 增补 Recursive Evidence Search 的 BDD 行为和验收标准。
- [x] 在 `DESIGN.md` 增补 clue / frontier / stopped / recursive run 的视觉规范。
- [x] 在 `src/lib/agentExpansion.ts` 增加递归搜索请求、响应类型和 `requestRecursiveSearch()`。
- [x] 在 `src/store/reasoningStore.tsx` 增加递归搜索 run 状态、错误状态和 reducer action。
- [x] 在 `vite.config.ts` 增加 `/api/agent/recursive-search`，复用真实 LLM provider，失败时不生成 mock。
- [x] 在 `NodeInspectorV3.tsx` 增加节点级递归搜索入口、追问框、深度和预算控制。
- [x] 在 `ReasoningWorkspaceV3.tsx` 把 recursive search result 转成 Canvas nodes / edges / trace。
- [x] 在 `ReasoningCanvasV3.tsx`、`SuzhengNode.tsx` 和 `styles.css` 中区分 clue、frontier、stopped、controller run 的视觉层级。
- [x] 运行 `npm run build` 并用浏览器验证节点触发、frontier 等待选择、真实 Provider 调用和 Inspector 证据许可。

# Reasoning Island Navigation v8

- [x] 将 Dynamic Island TOC 交互转译为 Canvas 节点导航，而不是文章目录。
- [x] 新增 `ReasoningIslandNav.tsx`，闭合态显示当前节点、节点类型和图谱进度。
- [x] 展开态提供“节点 / Trace”双标签，支持从底部浮层快速跳转节点或 reasoning step。
- [x] 接入 `ReasoningWorkspaceV3.tsx`，点击节点项同步 Inspector，点击 trace 项复用现有 step 高亮逻辑。
- [x] 在 `styles.css` 增加 backdrop blur、闭合 pill、展开面板、层级缩进和进度环样式。
- [x] 运行 `npm run build`。
- [x] 用浏览器验证闭合、展开、节点跳转、Trace 跳转和关闭按钮收起。

# Three-State Redesign A+B

- [x] 确认 `01-语境化可核查分解/mvp` 是当前 React + TypeScript + Vite 工程，并建立 `npx tsc --noEmit` 基线。
- [x] 将 `App.tsx` 从 `analysisStarted` 布尔值切换到 `input | executing | result` 三态状态机。
- [x] 保持 `Dashboard.onStartAnalysis` 签名不变，确保 Demo 快速/深度模式能驱动不同阶段。
- [x] 新增 `MissionControlView`、`AgentCard`、`StepTimeline`、`CanvasThumbnail` 执行态组件。
- [x] 在 `styles.css` 添加 Agent 色彩变量和 Mission Control 样式。
- [x] 运行 `npx tsc --noEmit` 验证。

# Three-State Redesign C+D+E

- [x] 新增结果态报告组件：`ReportPanel`、`CredibilityBadge`、`SourceList`。
- [x] 新增 `EvidenceMap`，包装既有 `ReasoningCanvasV3` 并支持引用高亮。
- [x] 新增 `ResultWorkspace`，默认展示报告 tab，并保留旧画布作为 `画布` tab。
- [x] 将 App 结果态从 `ReasoningWorkspaceV3` 切换到 `ResultWorkspace`。
- [x] 添加阶段切换动画、结果工作台布局、引用标签、可信度色阶和证据图谱样式。
- [x] 运行 `npx tsc --noEmit`、`npm run build` 并做浏览器验收。

# StepFun P0 Hardening

- [x] 移除 `vite.config.ts` 中的 StepFun 明文 key，改为只读取 `STEPFUN_API_KEY` 环境变量。
- [x] 增加 `.env.local.example` 的 StepFun/MiMo/DeepSeek 占位配置，并用 `.gitignore` 忽略真实 `.env` 文件。
- [x] 将 orchestrate demo fallback 输出标记为 `_source: "demo-fallback"`。
- [x] MissionControl Agent 卡片在 fallback 时显示灰色虚线和“模拟模式”。
- [x] 扫描仓库明文 key，并重跑 `npx tsc --noEmit`、`npm run build`。

# Domestic Model + 360 Demo Integration

- [x] 将用户提供的 360 key 只写入本地 `.env.local`，不写入源码、README 或 example。
- [x] 增加 360 Chat Completions Agent provider，接入 `360gpt-pro` 作为国产大模型备用链路。
- [x] 快速分析进入结果态后也会后台调用 `/api/agent/orchestrate`，demo 不再只是静态结果。
- [x] `/api/search/360` 优先调用 360 AI Search，失败后回退 360 智搜 `aiso-max`。
- [x] 输入态模型展示切到 StepFun / MiMo / DeepSeek / 360 智搜等国产链路。
- [x] 结果态底部展示实际命中的模型名，避免 fallback 或自动路由不可见。
- [x] 在 `ai组件工作流` 归档模型接入目录和可复用组件配置方法。
- [x] 运行 `npx tsc --noEmit`。
- [x] 运行 `npm run build`。
- [x] 本地调用 `/api/search/360` 和 `/api/agent/orchestrate`，确认真实模型链路或可见 fallback。
- [x] 浏览器验证快速分析和深度核查主路径。

# CurioCat Evidence Audit Integration

- [x] 360 搜索来源补齐 `sourceType`、`credibilityScore`、`sourceTier`、`freshnessScore`、`domain` 和 `evidenceRole`。
- [x] 360 AI Search / 智搜 fallback 接入支持与反驳双向查询，并输出支持证据、反驳证据和未解证据缺口。
- [x] 新增 `AgentEvidenceBundle`，让 HandoffStep、Mission Control、Result Workspace 证据图谱都能消费 Agent 证据包。
- [x] 将 `biasWarnings`、`logicRisks`、`cannotInfer`、`doNotInfer` 归一为逻辑风险审计项。
- [x] 逻辑风险接入 FIRE consistency 分数，结构化模型输出和 demo fallback 走同一展示逻辑。
- [x] 运行 `npx tsc --noEmit`。
- [x] 运行 `npm run build`。

# Streaming Agent Process UX

- [x] 移除 App 的直接结果态，不再从快速分析自动跳到报告页。
- [x] Mission Control 改为所有核查路径的主工作台。
- [x] 增加 Agent Stream 面板，以流式方式展示每个 Agent 的开始、完成、失败和最终收束。
- [x] 将 Agent Stream 从“结果字段流”改为“思考过程流”，不直接展开模型输出字段。
- [x] 最终结论只作为流式过程内的收束摘要展示，不再独立切换到 Result Workspace。
- [x] 删除旧结果工作区、证据图谱、报告面板、可信度徽章和来源列表组件。
- [x] 清理旧结果页样式，避免保留无效 UI 入口。
- [x] 运行 `npx tsc --noEmit`。
- [x] 运行 `npm run build`。

# Agent Contract System

- [x] 将每个核心 Agent 定义升级为 `AgentContract`：身份、使命、边界、工具、记忆、输出、交接、UI trace、失败策略。
- [x] `systemPrompt` 自动拼接 Agent Contract，避免 Agent 退化成普通聊天模型。
- [x] `buildAgentInput()` 写入 runtime contract，确保每步模型调用都能看到自身工具、记忆和边界。
- [x] `/api/agent/orchestrate` 与 `/api/agent/orchestrate-stream` 返回 `agentContract`。
- [x] Mission Control 大卡片展示 Agent 使命、工具和记忆写入。
- [x] Agent 面板改为从 `AGENT_CONTRACTS` 生成，并展示使命、工具和边界。
- [x] Sherlock 项目研究结论写入 `docs/agent-system-architecture.md`。
- [x] 可复用组件工作流写入 `/Users/mahaoxuan/Desktop/黑客松/AI组件工作流/agent-contract-workflow.md`。
- [x] 运行 `npx tsc --noEmit`。

## Review

- Build: `npm run build` 通过。
- Browser QA: `http://127.0.0.1:4173/` 通过开始推理、逐步展开、点击因果节点、点击候选证据节点、底部改写检查。
- Visual QA: 最终阶段 17 个 Canvas 节点无 DOM 边界重叠，截图保存在 `/tmp/suzheng-agent-canvas-verified.png`。
- v4 Browser QA: 三层后暂停为“等待选择节点”；点击“替代解释”并选择“联网搜索”后，只在该节点附近新增“中控 LLM 调度 / Searcher 子 Agent / 新增候选证据”三类节点。
- v4 Visual QA: 用户发散后 13 个 Canvas 节点无 DOM 边界重叠，截图保存在 `/tmp/suzheng-user-directed-expansion-final-ok.png`。
- v5 Build: `npm run build` 通过。
- v5 Browser QA: 在 4173 页面展开到三层后，拖动“因果判断”节点，DOM 位置从 `left=681.17/top=750.84` 移动到 `left=850.90/top=838.00`；Inspector 仍显示该节点的因果证据不足说明。
- v6 Build: `npm run build` 通过。
- v6 Browser QA: 4173 页面出现左侧 rail、浮动 command bar、Context Canvas、mode pills、selected-thread metadata 和 Context Inspector；展开到三层后无横向溢出，拖动“因果判断”节点从 `left=758.97/top=761.05` 到 `left=898.70/top=827.86`，Inspector 仍显示因果证据不足。
- v7 Build: `npm run build` 通过。
- v7 API QA: `POST /api/agent/recursive-search` 通过本地 Anthropic-compatible proxy 返回真实结构化结果，模型标识 `anthropic-local:MiniMax-M2.7`，包含 4 条 clues、3 条 frontier、2 条 stopped，未走 mock fallback。
- v7 Browser QA: 4173 demo 进入 Canvas 后出现 Recursive Evidence Search 面板；递归搜索响应回写后节点数从 17 增至 23，新增 2 个 clue、1 个 frontier、1 个 stopped、1 个 controller 节点；Inspector 显示“不能直接说 AI 导致岗位减少”。
- v8 Build: `npm run build` 通过。
- v8 Browser QA: 4173 demo 进入 Canvas 后 Reasoning Island 闭合态显示当前节点；点击后展开为 360x430 面板，backdrop blur 生效；节点 tab 点击“因果判断”后 Inspector 同步为因果判断；Trace tab 点击第 2 步后左侧 trace 选中第 2 步并同步到“概念不明”；关闭按钮可收起。截图保存在 `/tmp/suzheng-reasoning-island-v8.png`。
- Three-state A+B TypeScript: `npx tsc --noEmit` 通过。
- Three-state A+B Build: `npm run build` 通过；Vite 仍提示单个 chunk 超过 500 kB，这是既有体积风险，不阻塞本轮接入。
- Three-state A+B Browser QA: `http://127.0.0.1:5175/` 输入态显示快速/深度按钮；快速 Demo 进入结果工作区；深度 Demo 进入 Mission Control；画布缩略图可展开；取消核查回到输入态。截图保存在 `/tmp/suzheng-three-state-input.png`、`/tmp/suzheng-three-state-mission.png`、`/tmp/suzheng-three-state-mission-expanded.png`。
- Three-state A+B QA note: Codex Browser 插件无可用 `iab` 实例，后端列表为空；本轮改用 Chrome DevTools 验证。Console 有 1 条未带 URL 的 404 资源加载错误，未见 React runtime error。
- Three-state C+D+E TypeScript: `npx tsc --noEmit` 通过。
- Three-state C+D+E Build: `npm run build` 通过；Vite 仍提示单个 chunk 超过 500 kB，这是既有体积风险，不阻塞本轮结果态接入。
- Three-state C+D+E Browser QA: `http://127.0.0.1:5175/` 健康类 Demo 点击“快速分析”后进入 Result Workspace；报告 tab 首屏显示结论、可信度、核查过程和证据来源；旧 AI 岗位样例文案未混入健康 Demo；证据图谱可见，React Flow 容器尺寸为 553x709。
- Three-state C+D+E Browser QA: 结果页 `画布` tab 保留旧 `ReasoningWorkspaceV3` 作为全屏探索降级路径；`重新核查` 可回到输入态；深度模式仍进入 Mission Control。
- Three-state C+D+E Console QA: 刷新并进入结果页后无 error/warn/issue；截图保存在 `/tmp/suzheng-result-workspace-report.png`。
- StepFun P0 Security: `vite.config.ts` 不再包含 StepFun 明文 key；`DEVELOPMENT_LOG.md` 中历史 MiMo key 已改为占位符；`rg` 扫描未发现 StepFun/MiMo 明文 key（`package-lock.json` integrity hash 为误报）。
- StepFun P0 TypeScript/Build: `npx tsc --noEmit` 通过；`npm run build` 通过，仍有既有 500 kB chunk warning。
- Domestic Model + 360 API QA: 充值后 360 Chat Completions 直连返回 HTTP 200，模型 `360gpt-pro`。
- Domestic Model + 360 Search QA: `POST /api/search/360` 返回 `model: 360-ai-search:360gpt-pro`，含 8 条真实来源。
- Domestic Model + 360 Orchestrate QA: `POST /api/agent/orchestrate` 的 4 个 Agent 全部返回 `360-chat:360gpt-pro`，并消费 `360-ai-search:360gpt-pro` 搜索结果。
- Domestic Model + 360 Browser QA: 新标签页验证快速分析会后台刷新为真实模型结果，结果页底部显示 `模型核查 4 步完成 · 360-chat:360gpt-pro`；深度模式进入执行态，显示 MISSION CONTROL 和 RumorDetector 当前任务。截图保存在 `output/playwright/domestic-dashboard.png`、`output/playwright/domestic-result-quick.png`、`output/playwright/domestic-mission.png`。
- Domestic Model + 360 Security: 扫描 `docs`、`src`、`vite.config.ts`、`.env.local.example` 和 `ai组件工作流` 接入文档，未发现真实 key 或 Bearer token；真实 key 只保留在 `.env.local`。
- CurioCat Evidence Audit TypeScript: `npx tsc --noEmit` 通过。
- CurioCat Evidence Audit Build: `npm run build` 通过；Vite 仍提示单个 chunk 超过 500 kB，这是既有体积风险，不阻塞本轮证据审计接入。
- CurioCat Evidence Audit Scope: 本轮只接通 360 搜索证据质量、支持/反驳双向搜索、Agent 证据包、逻辑风险归一和 FIRE consistency 调制；未新增依赖，未读取或写入真实密钥。
- Streaming Agent Process TypeScript: `npx tsc --noEmit` 通过。
- Streaming Agent Process Build: `npm run build` 通过。
- Streaming Agent Process Browser QA: `http://127.0.0.1:5176/` 快速分析进入 Mission Control；Agent Stream 显示“扫描原句高风险词 / 改写成可验证问题 / 支持反驳核查”等思考动作；未出现 `Result Workspace`、`结果工作区`、`谣言特征:`、`factCheckResult:`、`sourceReliability:` 等直接结果字段。
