# 来源抽屉 finding 区：引证角标 + 关联核验来源归属

Date: 2026-09-12
契约：`docs/evals/2026-09-12-source-finding-citations.md`
承接：cmux "agy" 会话（Gemini 3.8 Flash）中断前的未完成任务。该会话在响应「这一块的布局、文案质量以及来源，记得优化一下」时改了 `SourceDrawer.tsx` / `InvestigationCanvas.tsx` 后撞 429 配额中断，留下 5 个测试红与无样式的半成品。

## 做了什么

agy 半成品已完成的部分：finding（「为什么这条证据重要」）正文 `[n]` 裸标记渲染为可交互角标（`renderFindingWithCitations`，悬停显示来源标题、点击新开官方原文）；抽屉新增 `relatedSources` 数据通道（`buildSourceDrawerViewFromClick` / `resolveSourceDrawerView` 接受全量 sources，按命题证据归集同命题来源）。

本段接手补完：

1. **chips 去重**：关联核验来源 chips 排除当前正在查看的来源（它的完整信息就在本抽屉头部，重复出现还导致 `getByText` 撞车）；`idx` 保留在 `relatedSources` 原位置，`[n]` 角标编号与 chips 标注编号一致。
2. **补样式**：agy 只写了 TSX 没写 CSS。按 #D-005 Notion 灰阶规范补齐 `.gp-finding-cite-badge`（行内角标）、`.gp-finding-sources(-chips/-label/-chip/-index/-fav/-title/-arrow)`、`gp-source-section-tag`（核心核验洞察胶囊）、`gp-source-section-title-wrap`，含窄屏（≤600px）标题截断与 hover 细过渡（无 `transition: all`）。
3. **修红 5 个**：test 1/13/B 的 "Found multiple elements" 由修复 1 解决（当前来源不再与抽屉标题撞文本）；test 8/9 的 Tab 闭环原来写死「关闭按钮 ↔ 一个外链」两元素，改为按抽屉内实际焦点停点（与组件 `focusableIn` 同规则）走完整圈断言，闭环语义不变。

## 不做的

不动后端 finding 文本生成（`[n]` 由 LLM 产出，前端只渲染）；不碰其他模块；不部署不 commit（沿用今天工作区攒批的节奏）。

## 验证

- `cd apps && npx vitest run src/goldenPath/` 162 全绿；apps 全量 1306 过 / 1 跳过；root 83 全绿；双 build 绿。
- Playwright 走查（`scripts/qa/capture_source_finding_citations.py`，独立端口 5197 + 独立 chrome profile）：角标 `[data-gp-cite]` 渲染、chips 不含当前来源链接、编号一致。截图 `docs/reports/2026-09-12-source-finding-citations/`（drawer-full.png / finding-block.png），before 对照见 agy 会话截图 `apps/public/decision-assets/d005-drawer.png`。

## 人评待裁

角标与 chips 的具体视觉（角标大小、chip 密度、「核心核验洞察」胶囊措辞）由用户裁决。
