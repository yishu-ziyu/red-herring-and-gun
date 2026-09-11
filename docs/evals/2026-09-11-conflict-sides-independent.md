# 争议双方各自可点 · 验收

- 日期：2026-09-11
- 来源：交接包 `ACCEPTANCE.md` A15；`IMPLEMENTATION_PLAN.md` §3.4「双方名称不能被合成一个只打开左边的按钮」
- 现状：`ClaimSection.tsx` 把两侧合成一个按钮（`conflictSidesLabel(sides)` 输出「支持 N 条、反驳 M 条」），点击只取 `sides[0].sourceIds[0]`，永远打开支持侧第一条。反驳侧的材料点不开。

## Change

同一个 claim 下的争议，支持侧与反驳侧各自渲染成独立可点的材料行。点支持侧打开支持侧那一份来源；点反驳侧打开反驳侧那一份来源。某一侧有多份材料时，该侧逐个列出，不合并、不丢弃。

## Not this

- 不把两侧合成一个按钮，也不让任一侧的点击落到另一侧。
- 不合成一个「并排对照」弹层：那要对象、时间、范围、定义的对照字段，本快照里没有，编不出来。
- 不改 `build.ts` 里 reason 的推断逻辑，不知道就继续 `unknown`。
- 不改快照 schema，不加前端状态。
- 不用两模型意见不同冒充「证据冲突」。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | 争议渲染出两个侧向分组，`data-gp-conflict-side="support"` 与 `"contradict"` 同时存在 | `goldenPath.test.tsx` | 命令 |
| E2 | 点支持侧的材料行，打开的来源 `data-gp-source-id` = 支持侧来源 id | 同上 | 命令 |
| E3 | 点反驳侧的材料行，打开的来源 `data-gp-source-id` = 反驳侧来源 id（不是支持侧） | 同上 | 命令 |
| E4 | 某一侧有 N 份材料时，该侧渲染 N 个可点行（fixture 扩成 2 支持 / 1 反驳仍成立） | 同上 | 命令 |
| E5 | 某一侧来源在 `sources` 里查不到时不渲染死按钮，显示「材料暂缺」 | 同上 | 命令 |
| E6 | 既有争议断言（known reason / unknown reason / 完成态顺序）仍绿 | `goldenPath.test.tsx` | 命令 |
| E7 | 无回归 | `cd apps && npm test`；`cd apps && npm run build` | 命令 |
| E8 | 桌面 1440 与手机 390 截图：两侧并排可读，无横向溢出 | 截图 | 命令 |
| E9 | 人看真实完成态：争点下左右两边的材料都能点开，且点开的是各自那一边 | 人评 | 人评 |

## Evidence

- 先失败后通过的测试记录（E1–E5 在改前必须红）。
- 截图：`docs/design/2026-09-11-investigation-experience/preview/conflict-desktop.png`、`conflict-mobile.png`（fixture 驱动，标明 fixture）。
- 回滚：单文件组件 + CSS，`git revert` 本提交即可。
