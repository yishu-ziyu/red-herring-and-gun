# 360 模型与搜索接入

校验日期：2026-05-30

## 本项目使用方式

- Agent 大模型：`POST https://api.360.cn/v1/chat/completions`，默认模型 `360gpt-pro`。
- 搜索增强：优先 `POST https://api.360.cn/v1/search/aisearch`，失败后回退 `GET https://api.360.cn/v2/mwebsearch`。
- 智搜套餐：默认 `SEARCH360_REF_PROM=aiso-max`，用于 query 改写、多 query 并行检索和来源重排。
- 浏览器只请求本项目 `/api/agent/orchestrate`、`/api/agent/orchestrate-stream`、`/api/search/360`，不直连 360。

## 环境变量

```env
QIHOO_360_API_KEY=
# ZHINAO_API_KEY=
# AI360_API_KEY=
AI360_BASE_URL=https://api.360.cn/v1
AI360_CHAT_MODEL=360gpt-pro
SEARCH360_MODEL=360gpt-pro
SEARCH360_REF_PROM=aiso-max
```

真实 key 只放 `.env.local` 或部署平台 Secret。不要写入源码、文档、`VITE_*` 变量或浏览器 bundle。

## Fallback 顺序

```text
StepFun
  -> 360 ChatCompletions
  -> MiMo
  -> DeepSeek
  -> Anthropic-compatible local proxy
  -> Codex CLI
  -> demo fallback
```

搜索链路：

```text
360 AI Search
  -> 360 mwebsearch aiso-max
  -> demo fallback
```

Fallback 必须在 UI 中可见：模型名以 `demo-fallback:*` 开头时，不能伪装成真实模型结果。

## 验收命令

```bash
npx tsc --noEmit
npm run build
curl -s -X POST http://127.0.0.1:5175/api/search/360 -H 'Content-Type: application/json' -d '{"query":"隔夜菜会致癌，吃了等于吃毒药","refProm":"aiso-max"}'
curl -s -X POST http://127.0.0.1:5175/api/agent/orchestrate -H 'Content-Type: application/json' -d '{"claim":"隔夜菜会致癌，吃了等于吃毒药"}'
```

合格标准：

- `/api/search/360` 返回 `model: "360-ai-search:360gpt-pro"` 或明确的 `demo-fallback:360`。
- `/api/agent/orchestrate` 的 `steps[].model` 至少命中一个国产 provider。
- 结果态底部展示真实模型名，例如 `360-chat:360gpt-pro`。
- 推云前扫描真实 key，确认 `.env.local` 未进入 Git。

## 官方依据

- 360 API 认证：https://ai.360.com/docs/quick-start
- 360 Chat Completions：https://ai.360.com/docs/413291990e0
- 360 搜索增强总览：https://ai.360.com/docs/77655138f0
- 360 AI Search：https://ai.360.com/docs/429775575e0
