# 摘录说法不再宣称「原文」

日期：2026-09-11
来源：用户 2026-09-11 裁决（三个写法中选定第 2 个，理由见下）

## Change

1. **`mvp/src/goldenPath/copy.ts` 的 `sourceExcerpt` 文案改掉 overclaim。**
   - 中文：`"原文摘录"` → `"检索片段（非逐字原文）"`
   - 英文：`"Exact excerpt"` → `"Search snippet (not a verbatim quote)"`
   - 理由：抽屉里这段文字的来源是 `packages/core/src/investigation/build.ts:497` 的 `excerpt = s.snippet`，即**搜索结果片段**，不是从原文页逐字摘下来的。一个查来源的产品把它称作「原文摘录」，正是它自己要抓的那类毛病；英文的 `Exact excerpt` 更是直接宣称了「精确」。
   - 按 `AGENTS.md`「意思都要写全，不要为了短而删掉会改变含义的字」，三个候选里选把话说全的那个（第 2 个），不选最短的「检索片段」。
2. **修掉一条会变成永真断言的老测试。**
   - `mvp/src/goldenPath/goldenPath.test.tsx:1612` 现在是 `expect(drawer.textContent).not.toContain("原文摘录")`。文案一改，这个字符串在代码里彻底不存在，该断言将**永远通过**，空摘录容器若复发也不会红。
   - 改为对该节做结构性断言（`[data-gp-source-section="excerpt"]` 与 `.gp-source-excerpt` 均为 null，第 1610/1611 行已有）+ 断言不含**新**文案。
3. **新增一条正向断言**：带 `excerpt` 的来源，抽屉内 `[data-gp-source-section="excerpt"]` 的标题文本等于新文案。

## Not this

- 不改摘录的数据来源，不加逐字抓取，不改管线。让 `excerpt` 真的成为逐字原文是另一轮管线工作（需新增抓取与字段），本轮只让文案不撒谎。
- 不改证据行——行内不显示这个标签，只有抽屉显示。
- 不动 PR #85 正在改的 `.gp-source-excerpt` 样式（衬线 / 左边线 / 16px），那是它的范围。
- 不改其他任何 copy key。

## Evaluator

| # | 检查 | 命令 / 判据 |
|---|---|---|
| E1 | 新文案生效 | `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：带 excerpt 的来源打开抽屉后，`[data-gp-source-section="excerpt"]` 的 `textContent` 含「检索片段（非逐字原文）」 |
| E2 | 旧文案全仓归零 | `grep -rn "原文摘录\|Exact excerpt" mvp/src` 输出为空 |
| E3 | 无 excerpt 时该节仍不出现，且断言不再永真 | 同 E1 文件第 5 条用例：该节与 `.gp-source-excerpt` 均为 null，且不含新文案（不再是针对已消失字符串的断言） |
| E4 | 无回归 | `cd mvp && npx vitest run`；`cd mvp && npm run build` |

人评项（单独列出等人裁）：抽屉里这个说法读起来是否还像「原文引文」；若仍像，说明问题不在文案而在块样式与 `<blockquote>` 语义（另见 PR #85 评审里的相关条目）。
