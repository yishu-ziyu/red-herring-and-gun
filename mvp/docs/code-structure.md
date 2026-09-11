# 代码结构说明

> **历史文档（2026-06 ～ 2026-08）。** 本目录的产品口径已被 `docs/PRODUCT_SPEC.md` 取代：
> 例如「结论只许用能信 / 不能信 / 只能信一部分 / 还查不清」「Mission Control 是产品脸 / 多 Agent 角色上前台」
> 这些说法现在都不成立。实现细节以代码为准，产品规则以 `docs/PRODUCT_SPEC.md` 为准。
> 保留本目录只为追溯当时的工程记录，不要照它写新东西。


本文已过期（写于 2026-05-31，当时误称 Express 不是本地主链路）。

当前以仓库根目录为准：

- 产品：`docs/PRODUCT_SPEC.md`
- 运行时：`docs/ARCHITECTURE.md`
- 领域词：`CONTEXT.md`

生产编排在 `mvp/server/src/lib/casePipeline`。前端入口是 `mvp/src/App.tsx`。
