# 验收契约：调查中活动流与来源抽屉交互打磨

- 日期：2026-09-11
- 范围：`ActivityFeed.tsx`、`SourceDrawer.tsx`、`InvestigationCanvas.tsx`、`golden-path.css`
- 阶段：Decide → Design → Build → Run → Analyze → Communicate

## Change

1. **活动流类型与点击目标精准对齐**：
   - 「带回材料」与「判定材料」活动：带 `sourceId` 与 `claimId`，点击准确打开对应命题下的 `SourceDrawer`。
   - 「发现分歧」活动：不误当成来源抽屉打开，若带冲突上下文则平滑滚动聚焦到对应命题的争点卡片（`.gp-conflict`）；若无则作为清晰信息行展示。
   - 模板文案与角色圆点：保持克制，支持绿色小点、反驳与拆题陶土红小点、判断墨色小点、材料灰色小点，无花哨动画。
2. **来源抽屉（SourceDrawer）多端下钻与焦点完整闭环**：
   - 桌面端（>768px）：右侧 440px 抽屉平滑滑入，主内容区（topbar、canvas）设为 `inert`，遮罩轻微模糊。
   - 移动端（<=768px）：底部滑出 Bottom Sheet（圆角 16px，最大高度 85vh），不溢出横向屏幕。
   - 内容层次：检索片段（blockquote）→ 针对命题（01/02 序号与完整陈述）→ 为什么重要（finding）→ 局限（limitation）→ 外部出处链接。
   - 键盘与无障碍：`Escape` 键关闭、遮罩点击关闭、`✕` 按钮关闭，关闭后焦点精准恢复到触发按钮（Trigger Button）。

## Not this

- 不是把活动流做成聊天气泡（Chat Bubbles）或大模型思考过程（CoT dump）。
- 不是在来源抽屉里自造大段 AI 综述或脱水摘要，只呈现后端给出的客观依据。
- 不是在全屏覆盖时破坏原句的上下文锚点。

## Evaluator

1. **自动化测试门禁**：
   - `cd apps && npm test` 包含 `activity.test.tsx`、`goldenPath.test.tsx` 全部通过。
   - 单元测试验证：
     - 点击活动流条目触发 `onSelectSource` 携带精确的 link、source 与 claimId。
     - 抽屉挂载时背景元素被设为 `inert`，卸载时清除。
     - 键盘 `Escape` 与焦点恢复机制有效。
2. **真实浏览器走查门禁**：
   - 桌面端（1440x900）截取 `investigating` 下的活动流与抽屉联动截图。
   - 移动端（390x844）截取 Bottom Sheet 下钻截图。
   - 检查无横向滚动条、无样式溢出。
