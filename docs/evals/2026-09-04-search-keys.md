# 2026-09-04 · 免费源预置，收费源用户自己填密钥

一句话：不配收费密钥也能搜；收费源在产品里写明去哪开通/充值，用户把密钥自己贴上即生效。

## Change

- 不填任何收费密钥时，一次查询仍能拿到可引用 URL（预置源，当前是 AnySearch；若配了 SearXNG 地址也算预置）。
- 设置页列出收费源：开通链接、充值链接、密钥输入、保存。保存后新案件用上这些密钥。
- 设置页列出已预置源，标明不用填。

## Not this

- 让用户在聊天里贴密钥
- 只改文档不改产品
- 用户可填任意 URL（会变成 SSRF）
- 本轮改 `mvp/`、切生产、自建 SearXNG 容器
- 把密钥写进 git

## Evaluator

机器：

```bash
npx vitest run --workspace @rhg/core src/search/searchCatalog.test.ts src/search/searchQuota.test.ts src/search/searchAll.test.ts
npx vitest run --workspace @rhg/server src/app.test.ts src/server.test.ts
npx vitest run --workspace @rhg/web src/pages/SearchSettings.test.tsx src/pages/HomePage.test.tsx
```

- 空 env 的 `defaultSearchProviders` 仍含 `any_search`，不含 360/Tavily/Exa/Metaso
- `GET /api/search-providers` 里 AnySearch `configured: true` 且 `billing: "included"`；Tavily `billing: "byo"`，有 signup/recharge URL
- 设置页有「需要你的密钥」分组和「去充值」链接；保存后 `createCase` 请求带上 `searchKeys`

活测：空 env `searchAll` 只打 `api.anysearch.com`，6 条，`http://www.nhsa.gov.cn/`。设置页截图 `packages/web/output/acceptance/search-settings-desktop.png`。

人评：设置页分组是否一眼能分清「已预置」和「要你自己的密钥」。

## Goal / Hard bar / Improve

- Goal: 免费源开箱能搜；收费源用户可在产品里自己配
- Hard bar: 上列命令绿；设置页走一遍保存
- Improve: 无密钥时仍能命中的源数量（至少 1）
