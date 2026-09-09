# 输入卡片双重焦点环消除验收标准

## Change
消除在 `.gp-input-card` 内聚焦输入框（`#claim-input` / `[contenteditable="true"]`）时产生的嵌套双重蓝框。由外层 `.gp-input-card:focus-within` 承担唯一的输入卡片激活反馈，内层可编辑区域在 `:focus-visible` 时消除冗余的 `box-shadow` 与 `outline`。

## Not this
- 不消除卡片内其它独立可交互控件（如添加附件按钮、提交按钮）的键盘无障碍 `:focus-visible` 焦点环。
- 不破坏 `.gp-shell` 其它全局元素（顶部导航、示例按钮等）的全局 `:focus-visible` 表现。
- 不修改 `PromptInput.module.css` 的通用组件契约，由 `golden-path.css` 嵌入契约统一收口。

## Evaluator
1. `npm test`（根目录测试全绿）
2. `npm run build`（根目录构建通过）
3. `cd mvp && npm test`（生产壳测试全绿，包含新增的 CSS 规则断言）
4. 真实浏览器取证（cmux / 截图分析）：聚焦 `#claim-input` 后截图，像素分析判定蓝色像素连通块仅为 1 个（外层卡片），内部矩形蓝色边框像素消除（连通块数从 2 降为 1）。
