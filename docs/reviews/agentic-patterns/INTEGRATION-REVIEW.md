# 合龙审查（2026-08-19）

21 章执行后合成读。用户会看见的错优先。

## 已修

1. 结果页不读 `claimItems`：立场条和第 7 条从清单消失。`ResultView` 现按 `claimItems` 原句序渲染；立场型显示「不适用真/假判断」。反证 URL 也能点开。
2. `split` / `merge` / 写报告入参仍先切 6：第 7 条进不了分类。展示上限改为 12，检索仍 6。
3. 无出处 true 仍写成能信：merge / bind / derive / reviewer 已收成还查不清。管线测例：7 条含「导致」→ 第 7 条进检索，未入选仍在清单，整句 `faceVerdict=还查不清`。
4. 本地 Vite 走 AgentRuntime、生产走 Case Pipeline：`vite.config.ts` 的 `/api/agent/orchestrate(-stream)` 改为 `createHandlers`，和 Express 同一条管线。

## 合龙后仍正确

- 检索上限 6，负荷：因果/导致 > 数字 > 其余。
- 未检索可核查条 unverified，gaps 含「检索预算未覆盖」。
- 立场条不检索。
- 补查 3 个名额先给 conflict。

## 不修

- `eval:gate` 基线 14 对 golden 26：第 19 章故意。要新基线必须实跑 `npm run eval`，不编数字。
- 第 13 条以上仍被 12 截：异常长拆题，不是本产品主路径。
- Vite 里旧的 AgentRuntime orchestrate 函数还在文件里，已不再挂路由。

## 浏览器

`http://127.0.0.1:5174/result-preview`：整句「只能信一部分」；4 项里有能信、立场型、还查不清；来源可点开。

缺陷数=4 其中必修=4（均已修）
