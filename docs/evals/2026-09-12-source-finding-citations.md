# 来源抽屉 finding 区：引证角标 + 关联来源归属

Date: 2026-09-12
承接：agy 会话（cmux workspace agy）中断前的未完成任务。用户指令（16:45）：「这一块的布局、文案质量以及来源，记得优化一下」，附截图指出「直接回答 / 为什么这条证据重要」区块。

## Change

- 来源抽屉（`apps/src/goldenPath/SourceDrawer.tsx`）的 finding（「为什么这条证据重要」）正文中，`[n]` 裸标记渲染为可交互引证角标：悬停显示对应来源标题，有 URL 时点击新开官方原文标签页。
- finding 区块下方新增「关联核验来源」chips 行：列出**同一命题下其他**佐证来源（favicon + 标题 + 外链），不含当前正在查看的这一条；`[n]` 角标编号与 chips 上标注的编号一致。
- 同一 `sourceId` 在快照里存在重复条目（duplicate）时，该来源不进入 chips，避免串入其他命题的材料；角标降级为无链接的纯标记。
- 打开抽屉时焦点落在关闭按钮；Tab / Shift+Tab 在抽屉内全部焦点停点间闭环（焦点停点数量随内容变化，闭环语义不变）。

## Not this

- 不改动首页、结论页、案卷播放器、活动流等其他模块。
- 不做视觉体系改版；沿用 #D-005 Notion 灰阶规范。
- 不部署、不 commit。
- 不改动后端 `finding` 文本生成逻辑（`[n]` 标记由 LLM 产出，前端只做渲染）。

## Evaluator

1. `cd apps && npx vitest run src/goldenPath/goldenPath.test.tsx` 全绿（含更新后的 Tab 闭环与 duplicate 不串内容断言）。【命令】
2. `cd apps && npm test` 全绿；根目录 `npm test` 全绿；双 `npm run build` 零错误。【命令】
3. 真实页面（127.0.0.1:5211，隔夜菜案例）点击 cqyz.gov.cn 来源胶囊：finding 正文 `[n]` 为角标元素（`[data-gp-cite]`）；chips 行（`[data-gp-source-section="cited-sources"]`）不含当前来源 id；截图 before/after 存 `docs/reports/`。【命令（Playwright 走查）+ 人评】
4. 角标/chips 的视觉样式（大小、配色、间距）由用户人评裁决。【人评】
