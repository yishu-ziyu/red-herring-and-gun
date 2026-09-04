# 2026-09-04 · 搜索配额：先测现象，再停打死人

一句话：死掉的搜索源在同一进程里不再被反复调用；活着的源仍能给出可引用 URL。

## Change

用户能观察到：一次真实查询仍能拿到来源（当前是 AnySearch）；360 / Metaso / Tavily / Exa 这类额度错误发生一次之后，同进程后续查询不再打它们。

## Not this

- 假装门禁过了
- 新接一个搜索厂商
- 让用户在聊天里贴 key
- 未确认 AnySearch 余额就跑 26 例全量 eval

## Evaluator

机器：

```bash
cd packages/core && npx vitest run src/search/searchQuota.test.ts src/search/searchAll.test.ts src/search/searchProviders.progress.test.ts
```

- `额度错误后同进程不再打该源，活着的源继续` 过：第一次五源，第二次只打 AnySearch
- `Tavily 432 的 detail.error 写进错误并触发跳过` 过
- 根目录 `npx vitest run --workspace packages/core` 中 search 相关不过红

活探测（本标准的证据，2026-09-04）：

| 源 | 现象 |
| --- | --- |
| AnySearch | 成功，6 条，样例 `http://www.nhsa.gov.cn/`，2165ms |
| 360 | `余额不足`，1440ms |
| Metaso | `余额不足`，1747ms |
| Tavily | HTTP 432 usage limit |
| Exa | credits limit |

落地后活测第二次 `searchAll`：外呼从五家变成只打 `api.anysearch.com`，仍 6 条命中。

## 人评

- 要不要给 360 / Metaso / Tavily / Exa 充值（换检索多样性）
- 要不要现在用只剩 AnySearch 的矩阵跑全量 eval 写 baseline（会烧 AnySearch 与 LLM）

## Goal / Hard bar / Improve

- Goal: 活源能搜；死源同进程跳过
- Hard bar: `searchQuota.test.ts` 全绿
- Improve: 额度耗尽后，第二次 `searchAll` 的外呼次数（5 → 1）
