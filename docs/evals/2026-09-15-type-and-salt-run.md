# 字阶色板接到调查界面，并用盐说法实跑

Date: 2026-09-15

## Change

1. **调查界面用同一套字与色。** UI 用 SF Pro Regular/Medium，字距 -0.15px；字号只在 12 / 13 / 14 / 24px。层级用 #292929、#5D5D5D、#9E9E9E。导航圆角 8px，卡片 16px，主按钮药丸形。导航图标 14px，卡片图标 20px。衬线仍只给判断句、原句、摘录（产品文书层），不把原句改成 UI 字。
2. **盐说法再跑完整一轮并记录。** 同一条低钠盐混真假说法，从首页提交到终态。过程截图：空等、命题上屏、追查中（左栏活动流）、终态（完成或带总答的中断）。后台记下命题、判断、是否有 directAnswer、是否还有同一 finding 双挂。

## Not this

- 不另起一套视觉。不把衬线文书层改成无衬线。
- 不把 24px 铺到所有标题。
- 不为跑通而关超时。
- 不 commit。

## Evaluator

1. `:root` 含 `--gp-ink: #292929`、`--gp-ink-2: #5D5D5D`、`--gp-ink-3: #9E9E9E`、`--gp-radius-card: 16px`、`--gp-radius-sm: 8px`、`--gp-tracking: -0.15px`。【命令】
2. `golden-path.css` 的 `font-size` 不再出现 10/11/11.5/12.5/15/16/18/20 等档外值（24/14/13/12 除外）。【命令】
3. 24px 只出现在首页标语、结论第一句、首页案例标题；调查中原句与完成态节题不是 24px。【命令】
4. 调查中活动流角色标签没有黄/粉/蓝底色块（`#fef3c7` / `#fce7f3` / `#e0f2fe` 不在 `.gp-activity-role-badge`）。【命令】
5. 盐说法原句「新英格兰医学杂志…中风和死亡都明显下降」没进命题时，「这些这次没查」整句留下，不出现单独的「用含钾的低钠盐替换普通盐」。【命令】
6. 盐说法 run 有过程截图；终态有对原句的第一句或「收束时中途停了」加总答。【人评 + 命令】
7. 相关 vitest 不因 token 改动变红。【命令】

## Evidence

- Token：`:root` 含 ink `#292929` / `#5d5d5d` / `#9e9e9e`，`--gp-tracking: -0.15px`，`--gp-radius-card: 16px`，`--gp-radius-sm: 8px`。`golden-path.css` 无 10/11/15/16/18/20px 字号。
- 24px 只在首页标语与 `.gp-hero-answer`；调查中原句实测 14px；完成态节题不再 24px。
- 活动流 `.gp-activity-role-badge` 背景透明，颜色 `#9E9E9E`。
- leftover：`leftoverClaims.test.ts` 6 绿；实跑「这次没查」为 10 克、高钠危险因素、NEJM 试验整句。
- `cd apps && npx vitest run src/goldenPath/leftoverClaims.test.ts src/goldenPath/goldenPath.test.tsx` 128 绿。
- 盐说法记录 `docs/evals/2026-09-15-salt-run2/`。终态 `0d7e6619` 203 秒中断在 fact_checker（MiniMax 90s 超时），没有分条判断，黄卡「还没有写成总判断」——不假装有总答。

人评：首页 / 空等 / 追查中 / 中断是否像同一产品。
