# 红鲱鱼与枪

信息真相猎人。丢进来一句话、截图或链接，去**追出处**，告诉你**能信还是不能信**。有问题就指出问题。来源能点开。

公网入口：<https://gun.yishuziyu.cn>

赛道：「词元工坊」黑客松 · AI Agent · 信息真相猎人。有技术含量的是溯源，不是话术。

```text
材料
  → 溯源（从哪来、是不是一手）
  → 对照公开材料
  → 能信 / 不能信 / 还查不清
  → 问题点 + 可点来源
```

## 它做什么

- 对着公开材料核，不靠模型编造来源或命题。
- 一句话里真假缝在一起时，分开判：哪一截能信、哪一截不能信。
- 可信度 0–100 由公式计算，不让模型直接打分。
- 查不清就说查不清；没搜到不等于假。
- 国产模型与 360 搜索可按环境接入。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Express + TypeScript
- 测试：Vitest
- 部署：Nginx + Docker + 阿里云

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

示例见 `mvp/.env.local.example`。常用：`DEEPSEEK_API_KEY`、`MIMO_API_KEY`、`STEPFUN_API_KEY`、`AIPING_*`、`PUBLIC_BASE_URL=https://gun.yishuziyu.cn`。不要把真实密钥提交进仓库。

## 部署

域名 `gun.yishuziyu.cn`。Nginx 服务静态资源，`/api/` 与 `/health` 代理到本机 Express。入口：`./ops.sh deploy --yes`。发布门禁见 `docs/PRODUCT_RELEASE_GATE.md`。
