# 模型与 API Key 设置页面视觉重构验收标准

## Change
1. 重构 `/settings/api-key` 页面（`ApiKeySettings`）视觉设计，彻底摒弃旧版粗糙的 `--zt-*` 孤立表单样式。
2. 全面接入主站 Quiet Editorial / Golden Path 现代设计语言：
   - 采用 `--gp-*` 统一度量（`--gp-bg: #fcfcfd`, `--gp-surface: #ffffff`, `--gp-line: #e7e5e4`, `--gp-ink: #18181b`, `--gp-accent: #2563eb` 等）；
   - 结构化卡片分区：顶部导航与说明、服务商卡片组、连接与凭证表单卡片、操作与测试状态反馈、以及底部安全与存储说明 Callout。
3. 交互与质感对齐现代工具（Linear / Vercel / 21st.dev 风格）：
   - 服务商徽标药丸/卡片：清晰的微描边、悬浮反馈、激活状态沉浸色与圆润图标；
   - API Key 输入支持显隐切换（Password / Text 切换按钮），增强易用性；
   - 测试连接与保存动作区域层级分明，测试中带有清晰的 loading 反馈，测试成功/失败显示带有状态徽标（微墨水绿/红）；
   - 保持极佳的无障碍可访问性（键盘 Tab、`:focus-visible` 焦点环高清晰度）。
4. 100% 保持既有业务逻辑契约（`gun-byo-key` 本地持久化、`/api/agent/test-llm` 连通性测试、所有已有单元测试断言）。

## Not this
- 不修改 `/api/agent/test-llm` 后端接口定义与传输协议。
- 不变更现有的本地密钥编码格式（`obfuscate`/`deobfuscate`）与 storage key。
- 不影响主站其他页面及测试套件。

## Evaluator
1. `npm test`（根目录测试通过）
2. `npm run build`（根目录构建通过）
3. `cd mvp && npm test`（`mvp` 全部测试通过，且 `ApiKeySettings.test.tsx` 覆盖新增交互并保持原有契约）
4. 真实浏览器取证（cmux / 截图验证）：捕获重构后页面的完整截图，验证其视觉风格、排版、卡片阴影与主站 `ProductShell` 完全融为一体。

## 结果（2026-09-09）

1. 根测试四套件全绿：core 612 / eval 85 / server 21 / web 83。
2. 根 `npm run build` 通过（exit 0）。
3. `cd mvp && npm test`：1011 通过 / 1 跳过 / 0 失败（上次会话后台复跑中断，本结果为完整复跑）；`ApiKeySettings.test.tsx` 17 项含新增交互（服务商药丸预置与填参、Key 显隐切换、密钥不回显、测试连接请求）全过。另跑 `cd mvp && npm run build` 通过。
4. 真实浏览器（ZCode IAB，dev 5173）截图取证：桌面 1280 整页、390 手机整页、主站首页对照，归档于 `docs/design/2026-09-09-api-key-settings/`。设置页卡片分区、服务商激活态、Key 显隐、模型药丸、安全 Callout 均按 `--gp-*` 渲染，与主站同一浅底细描边衬线语言。手机整页截图底部出现的第二份页头经 DOM 核查为 fullPage 截屏对固定定位元素的伪影（`headerCount: 1`，非产品缺陷）。

CSS 解耦收尾：`styles.css` 中 `api-key` 引用归零（含 `prefers-reduced-motion` 三条规则随迁至 `ApiKeySettings.css` 专属段），组件经 `import "./ApiKeySettings.css"` 引入。

追加（2026-09-09 用户裁决后）：底部安全 Callout 文案按用户选定方案 A 换成说人话版本（密钥只存在本机浏览器、测试连接经本站后端发起一次验证且不展示密钥、共用电脑用后清除），原文「base64 不是加密……」系 2026-07-06 `a8d0987` 引入的旧披露照搬，实现层行话违反产品宪法「实现层默认隐藏」；对应单元测试断言同步改写，ApiKeySettings 17 项全绿。
