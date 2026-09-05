# 红鲱鱼与枪

可检查的信息调查工具。丢进来一句话、截图或链接，系统把说法拆成可核查命题，追查公开证据，并展示每个判断如何从证据与证据缺口中形成：哪些站得住、哪些有问题、哪些还查不清。来源能点开。

产品定义、产品宪法与唯一主路径：`docs/PRODUCT_SPEC.md`。

公网入口：<https://gun.yishuziyu.cn>

赛道：「词元工坊」黑客松 · AI Agent · 信息真相猎人。有技术含量的是溯源，不是话术。

```text
输入一句话 / 截图 / 链接
  → 拆成要分别核查的命题
  → 证据汇入（支持 / 反驳 / 仅相关 / 尚缺）
  → 冲突与缺口
  → 判断（第一句直接回答原句）
  → 来源下钻
```

白盒展示的是判断为什么成立（命题 / 证据 / 判断三层透明），不是 Agent 日志。Agent、provider、工具调用、管线状态属实现层，默认不出现。

## 它做什么

- 对着公开材料核，不靠模型编造来源或命题。
- 一句话里真假缝在一起时，分开判：哪一截站得住、哪一截站不住。
- 查不清就说查不清；没搜到不等于假。
- 可信度 0–100 由公式计算，不让模型直接打分；只是辅助信号，不替代证据解释。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Express + TypeScript
- 测试：Vitest
- 部署：Nginx + Docker + 阿里云
- 模型与搜索源：国产模型、360 搜索等按环境接入，属实现层，provider 名字不出现在用户界面。

## 项目结构

```text
.
├── README.md
├── docs/PRODUCT_SPEC.md     # 产品真相
├── docs/adr/                # 架构决策
├── mvp/src/                 # React 前端
└── mvp/server/src/          # Express 后端
```

## 本地运行

一次起前端和 API（Vite 把 `/api` 代理到 Express）：

```bash
cd mvp
npm install
npm --prefix server install
npm run dev
```

只要 API：`cd mvp/server && npm run dev`（默认 `http://127.0.0.1:3000`）。只要前端、自己已经起了 API：`cd mvp && npm run dev:web`。

构建与测试：

```bash
cd mvp
npm test
npm run build

cd server
npm run build
```

## 环境变量

示例见 `mvp/.env.local.example`。常用：`DEEPSEEK_API_KEY`、`MIMO_API_KEY`、`STEPFUN_API_KEY`、`AIPING_*`、`PUBLIC_BASE_URL=https://gun.yishuziyu.cn`。不要把真实密钥提交进仓库。

## 部署

域名 `gun.yishuziyu.cn`。Nginx 服务静态资源，`/api/` 与 `/health` 代理到本机 Express。唯一发布入口：`./ops.sh deploy --yes`（不要跑 `deploy-to-aliyun.sh` 或 `mvp/deploy.sh`）。发布门禁见 `docs/PRODUCT_RELEASE_GATE.md`。
