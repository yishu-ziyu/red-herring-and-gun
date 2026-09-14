# 清掉会污染判断的旧上下文 · 验收

- 日期：2026-09-11
- 用户原话：留下这种垃圾上下文，只会让整个项目被污染得极其严重。

## Change

会当现行规则被搜到的旧文从仓库里拿掉，不归档、不盖横幅。

删除：`apps/docs/`、`apps/DEVELOPMENT_LOG.md`、`apps/DESIGN-GALLERY.md`、`apps/tasks/`、`docs/archive/`、`docs/reviews/agentic-patterns/`。
`docs/NOTES.md` 只留现在仍成立的当前状态。入口文档不再指向已删路径。

## Not this

- 不删 `docs/evals/`（验收契约）、`docs/qa/`（取证）、`docs/design/` 里现行对照、`docs/devlog/`、产品代码。
- 不把旧文搬去 archive 继续被搜到。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | 上列路径不存在 | `test ! -e` | 命令 |
| E2 | `docs/README.md` / `PRODUCT_SPEC.md` 不再把 `apps/docs` 或 agentic-patterns 当入口 | `rg` | 命令 |
| E3 | `NOTES.md` 行数明显短于旧日记，且头部是今天的清上下文 | `wc -l` | 命令 |
| E4 | 产品测试不依赖被删文件 | `cd apps && npx vitest run src/goldenPath/goldenPath.test.tsx --reporter=dot` | 命令 |
