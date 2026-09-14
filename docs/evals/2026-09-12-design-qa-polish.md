# 验收标准：UI / 动效规范与体验细节清障（2026-09-12）

## Change（可观察变更）
1. 来源 Popover 徽标修除文案叠词：当来源类型为 `context-only` 时，浮层徽标显示「相关材料」，不再出现「相关材料材料」叠字。
2. 移动端来源 Popover 防溢出自适应：在窄屏/手机端（<=600px）点击或悬浮来源药丸，Popover 浮层自适应父级容器居中对齐，不超出视口右边界，彻底消除横向滚动。
3. 调查中文本与控制栏防挤压折行：`.gp-original-meta` 与 `.gp-original-side` 开启 `flex-wrap: wrap`，在 320px–390px 窄屏下「你调查的说法」与状态徽标/操作按钮合理换行，无文字挤压与截断。
4. 调查中网格层叠加固：桌面端（>=769px）在 `investigating` 与 `judging` 阶段，为 `.gp-thinking-box` 和 `.gp-activity` 显式锚定 `grid-column: 2`，杜绝浏览器网格自动流排布导致的潜在错位。
5. 中断态按钮清理：`.gp-interrupted` 警示大卡已提供主操作按钮「重新调查」与「返回首页」时，下方原说法控制区不再重复渲染同名的「重新调查」按钮。
6. 活动流徽标样式匹配修复：修复 `.gp-activity-role-badge.is-judgment` 的颜色映射（原本仅写了 `.is-judge` 导致作判断徽标未命中专用色）。
7. 思考流移动端内边距与换行优化：`.gp-thinking-head` 在窄屏下支持平滑换行与自适应内边距，保障打字光标与计时器完整展示。

## Not this（不算数的替代）
- 不重新引入 Card Stack / Bento / Dashboard。
- 不引入 `transition: all`。
- 不改动既有 1303 个测试用例的业务逻辑。

## Evaluator（验收方式）
1. 单元与集成测试：
   `cd /Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/apps && npm test` -> 全量通过（1303 passed）。
   `cd /Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪 && npm test` -> packages 全量通过（816 passed）。
2. 构建检查：
   `npm run build` 与 `cd apps && npm run build` -> 双 build 零报错。
3. 真实浏览器走查（Playwright）：
   - 320px、375px、1280px 视口无横溢、无文字碰撞叠字、无重复按钮。
