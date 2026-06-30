# 红鲱鱼与枪项目地图

日期：2026-06-15

## 一句话定位

「红鲱鱼与枪」是一个面向热点传言、截图、链接和网页材料的 AI 核查 Agent。用户提交待核查材料后，系统用多 Agent 流程完成立案、命题拆解、溯源、交叉验证和报告收束。

当前产品叙事：

> 先别转发，先看证据链。

长期方法论底座仍是 argument-checking：不是简单搜索总结，而是把一个说法拆成可审查判断，再按证据许可给出 can say / cannot say。

## 当前代码结构

```text
.
├── README.md                         # 产品和技术总览
├── DEPLOYMENT_CHECKLIST.md           # 部署与建联检查清单
├── docs/
│   ├── PRODUCT_RELEASE_GATE.md       # 产品级公开发布门禁
│   ├── DEPLOYMENT_INCIDENT_REVIEW_2026-06-15.md
│   └── PROJECT_MAP_2026-06-15.md     # 本文件
├── ops.sh                            # 本地/公网/远端/部署统一入口
├── scripts/
│   └── configure-aliyun-static-nginx.sh
└── mvp/
    ├── src/                          # React 前端
    ├── server/src/                   # Express 后端
    ├── public/                       # logo 等静态资源
    ├── package.json                  # 前端脚本
    └── server/package.json           # 后端脚本
```

## 前端是什么

入口：

- `mvp/src/main.tsx`
- `mvp/src/App.tsx`

当前前端只有两个主阶段：

1. `input`：首页材料输入，组件是 `mvp/src/components/v3/Dashboard.tsx`。
2. `executing`：Mission Control 办案台，组件是 `mvp/src/components/v3/phases/MissionControlView.tsx`。

首页支持：

- 输入文字。
- 粘贴链接。
- 上传图片。
- 从 `/api/models/list` 拉取可用模型。
- 用户可为 4 个 Agent 选择模型；不选则走服务端 fallback chain。

注意：`mvp/src/lib/agentRuntime/*` 和部分 Canvas/证据矩阵组件保留了较多演示和历史迭代逻辑。当前线上主链路不要从这些文件判断后端是否可用，优先看 `server/src`。

## 后端是什么

入口：

- `mvp/server/src/index.ts`
- `mvp/server/src/handlers.ts`

线上后端是 Express + TypeScript，默认监听 `0.0.0.0:3000`。

主要接口：

```text
GET  /health
GET  /api/models/list
POST /api/agent/orchestrate
POST /api/agent/orchestrate-stream
POST /api/search/360
POST /api/search/provider
POST /api/agent/expand
POST /api/agent/recursive-search
POST /api/agent/sherlock-search
```

当前公开产品的核心接口是：

- `/api/models/list`
- `/api/agent/orchestrate`
- `/api/agent/orchestrate-stream`

## Agent 主链路

当前核心 Agent：

```text
RumorDetector
→ FactChecker
→ SourceValidator
→ ReportComposer
```

辅助链路：

- 图片材料先走 StepFun vision 预处理。
- 外部证据走搜索聚合：360 / AnySearch / Metaso / Tavily / Exa 等实现痕迹在代码中存在，当前可用性取决于服务端 env。
- 可信度分数由 `mvp/server/src/lib/credibilityScore.ts` 计算，不让 LLM 直接拍脑袋打分。

Provider fallback 在：

- `mvp/server/src/lib/providerRouter.ts`

模型可用列表在：

- `mvp/server/src/lib/availableModels.ts`

可用模型不是前端写死决定的，而是服务端根据 env key 过滤后返回。

## 前后端关系

本地开发：

```text
浏览器
→ Vite dev server
→ Vite 插件 / Express 风格 handler
→ LLM / 搜索 provider
```

线上生产：

```text
浏览器
→ https://gun.yishuziyu.cn
→ Aliyun Nginx
  ├─ /          静态文件：/opt/red-herring/dist
  ├─ /logo.png  静态资源
  ├─ /assets/*  静态 JS/CSS
  └─ /api/* 和 /health 反代到 127.0.0.1:3000
       → Express 后端
       → 模型 / 搜索 / Agent 编排
```

关键理解：

- 前端只是用户界面和材料收集。
- 后端才持有 provider key，负责模型调用、搜索调用和 Agent 编排。
- 线上域名现在应直接走阿里云，不再依赖 Vercel 国内链路。

## 当前线上拓扑

域名：

- `gun.yishuziyu.cn`

DNS 目标：

- `gun A 121.89.90.68`

服务器：

- Aliyun：`121.89.90.68`

Nginx：

- `/` → `/opt/red-herring/dist`
- `/api/` → `127.0.0.1:3000`
- `/health` → `127.0.0.1:3000`

部署/验证入口：

```bash
./ops.sh check
./ops.sh public
./ops.sh aliyun-domain
./ops.sh remote
./ops.sh deploy --yes
```

`deploy --yes` 会重启远端服务；只在确认发布时运行。

## 建联前验收

对外接平台、发给评委或给用户试用前，至少确认：

```bash
./ops.sh check
./ops.sh public
./ops.sh aliyun-domain
```

然后手动或脚本验证核心 Agent：

```bash
curl --noproxy '*' --resolve gun.yishuziyu.cn:443:121.89.90.68 \
  -sS -m 180 \
  -X POST https://gun.yishuziyu.cn/api/agent/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"claim":"隔夜菜会致癌是真的吗？","mode":"quick"}'
```

成功标准：

- HTTP 200。
- `steps.length` 为 4。
- 返回 `finalReport`。
- 即使 ReportComposer 走 deterministic fallback，也不能 502、空白页或无限 loading。
- `/logo.png`、主 JS/CSS 和首页都能返回 200。

## 已知风险

1. 当前工作区有大量未提交改动和新增文件。后续做代码修改前必须先看 `git status`，不要误删用户或其他 Agent 的成果。
2. `DEPLOYMENT_CHECKLIST.md` 同时保留了 Vercel 旧路线和 Aliyun 新路线，读的时候以“国内直连方案”和事故复盘为准。
3. 前端历史组件较多，容易把旧 Canvas / Result Workspace / mock runtime 和当前 Mission Control 主线混淆。
4. 模型链路依赖远端 `.env.local`；`/api/models/list` 有模型不代表每个模型余额和限流都稳定。
5. ReportComposer 曾出现模型超时后走确定性 fallback，这是可用性兜底，但会影响报告质量。
6. 国内访问问题不能只看本机 `dig`；`198.18.x.x` 是代理 fake-ip，`/etc/hosts` 也可能覆盖真实 DNS。

## 2026-06-15 当前验证

本轮验证结果：

- `./ops.sh check` 通过。
  - Vitest：5 个测试文件、47 个测试通过。
  - 前端 `npm run build` 通过。
  - 后端 `npm --prefix server run build` 通过。
  - 本地独立后端 `/health` 正常。
  - 本地 `/api/models/list` 返回空数组，因为本机没有加载真实 provider key；这不代表线上无模型。
- `./ops.sh remote` 通过。
  - 远端目录：`/opt/red-herring`。
  - Docker 服务：`red-herring-api` healthy。
  - 远端 `/health` 正常。
  - 远端 `/api/models/list` 返回 DeepSeek / StepFun / 360 / MiMo 候选。
- `./ops.sh aliyun-domain` 通过。
  - `https://gun.yishuziyu.cn/` 经 `121.89.90.68` 返回 200。
  - `/health` 经 `121.89.90.68` 返回 200。
  - `/api/models/list` 经 `121.89.90.68` 返回 200。
- 静态资源验证通过。
  - `/` 返回 200。
  - `/logo.png?v=20260615` 返回 200。
  - `/assets/index-T5_ejhWg.js` 返回 200。
- Agent 主链路可跑通，但耗时偏长。
  - `POST http://121.89.90.68/api/agent/orchestrate` 最终返回 200。
  - `steps.length = 4`。
  - 前三步模型：`stepfun:step-2-mini`。
  - ReportComposer：`fallback:deterministic-report`。
  - 本次可信度分数：54。

需要注意：

- macOS `curl` 直连 `https://gun.yishuziyu.cn` 仍可能报 LibreSSL `SSL_ERROR_SYSCALL`。
- 同一目标用 `openssl s_client` 和 Python TLS/SNI 可以握手成功，证书为 Let's Encrypt，CN 为 `gun.yishuziyu.cn`。
- 因此当前不要把 Apple curl 这条失败路径单独当成线上证书或 Nginx 故障。

## 下一步优先级

P0：保持公开访问稳定。

- 固化 Aliyun 直连部署路线。
- 保证图片、JS、CSS、API、Agent 主流程每次发布后都验收。
- 保留 `ops.sh` 作为唯一部署入口。

P1：让用户完整享用 Agent 服务。

- 确认 `orchestrate-stream` 在公网浏览器里不会中断。
- 把搜索失败、模型失败、fallback 状态清楚展示给用户。
- 最终报告稳定输出 can say / cannot say / evidence chain。

P2：平台建联。

- 对接平台前先确认需要 iframe、普通链接、API、还是 webhook。
- 若平台需要嵌入，检查 CSP、跨域、HTTPS、移动端适配。
- 若平台需要 API，补正式 API 文档和限流策略。

P3：商业化。

- 暂不启动。
- 真要收费时再按 Claude/Codex memory 中的“用户系统、余额表、成本模型、预扣结算、充值入口”推进。
