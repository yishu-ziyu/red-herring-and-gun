# 红鲱鱼与枪

AI 驱动的信息核查 Agent。用户提交一条疑似传言、截图转写、链接或网页材料后，系统用多 Agent 流程完成立案、命题拆解、证据搜索、交叉验证和报告收束，输出可信度评分与证据链。

公网入口：<https://gun.yishuziyu.cn>

## 产品定位

红鲱鱼与枪不是一个简单的搜索总结工具。它把一条说法拆成可核查判断，再用多个 Agent 分工处理：

```text
用户材料
-> RumorDetector
-> FactChecker + SourceValidator
-> ReportComposer
-> 可信度评分 + 证据链 + can say / cannot say
```

核心原则是：先别转发，先看证据链。

## 核心能力

- 多 Agent 核查：谣言特征识别、事实核验、信源可靠性评估、报告生成。
- 证据链输出：区分“能说什么”和“不能推出什么”。
- 确定性评分：`credibilityScore` 由公式计算，不让 LLM 直接拍脑袋打分。
- 多模型 fallback：DeepSeek、MiMo、StepFun、360、Anthropic Proxy 等 provider 按可用环境自动选择。
- 公网部署：前端静态资源由 Nginx 承接，`/api/` 与 `/health` 代理到 Express 服务。

## 可信度评分

`credibilityScore` 是 0-100 分的确定性结果，由五类信号聚合：

| 分量 | 来源 | 作用 |
| --- | --- | --- |
| 事实核查信号 | FactChecker | 判断核心事实是否成立 |
| 搜索证据信号 | 外部搜索 | 检查外部证据方向和质量 |
| 信源可靠性 | SourceValidator | 评估来源可信度 |
| 谣言严重度惩罚 | RumorDetector | 识别情绪煽动、匿名信源、绝对化表述等风险 |
| 缺失来源惩罚 | SourceValidator | 处理关键证据缺口 |

分档：

| 分数 | 标签 |
| --- | --- |
| 80-100 | 高度可信 |
| 60-79 | 基本可信 |
| 40-59 | 存疑 |
| 20-39 | 低可信 |
| 0-19 | 高度可疑 |

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Express + TypeScript
- 测试：Vitest
- 部署：Nginx + Docker + 阿里云服务器

## 项目结构

```text
.
├── README.md
├── deploy-to-aliyun.sh
├── docs/
│   ├── DEPLOYMENT_INCIDENT_REVIEW_2026-06-15.md
│   ├── PRODUCT_RELEASE_GATE.md
│   └── PROJECT_MAP_2026-06-15.md
├── scripts/
│   ├── configure-aliyun-static-nginx.sh
│   └── delete-stale-gun-a-record.sh
└── mvp/
    ├── src/                 # React 前端
    ├── server/src/          # Express 后端
    ├── public/              # 静态资源
    ├── package.json
    └── server/package.json
```

## 本地运行

前端：

```bash
cd mvp
npm install
npm run dev
```

后端：

```bash
cd mvp/server
npm install
npm run dev
```

构建与测试：

```bash
cd mvp
npm test
npm run build

cd server
npm run build
```

## 环境变量

完整示例见：

```text
mvp/.env.local.example
```

常用变量包括：

- `DEEPSEEK_API_KEY`
- `MIMO_API_KEY`
- `STEPFUN_API_KEY`
- `AIPING_CLIENT_ID`
- `AIPING_CLIENT_SECRET`
- `AIPING_SESSION_SECRET`
- `PUBLIC_BASE_URL=https://gun.yishuziyu.cn`

真实密钥不应提交到仓库。

## 部署与运维

公网域名：

```text
gun.yishuziyu.cn
```

当前生产方案：

- DNS：`gun A 121.89.90.68`
- Nginx：服务 `/opt/red-herring/dist`
- API：`/api/` 与 `/health` 代理到 `127.0.0.1:3000`

部署和排障入口：

```bash
./ops.sh public
./ops.sh aliyun-domain
./ops.sh remote
./ops.sh deploy --yes
```

部署事故复盘和发布门禁见 `docs/`。
