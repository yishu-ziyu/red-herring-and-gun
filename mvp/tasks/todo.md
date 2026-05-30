# Agent Reasoning Canvas v3

- [x] 确认项目目录、入口文件、数据层和文档位置。
- [x] 新增 reasoning canvas 数据模型与预置节点/边/trace。
- [x] 新增三栏 Canvas 工作台组件。
- [x] 将 App 入口切到 ReasoningWorkspace。
- [x] 重写样式为 Agent reasoning canvas 工作台。
- [x] 更新 MVP spec 和 demo script。
- [x] 运行 build 并做浏览器交互验证。

# User-directed Node Expansion v4

- [x] 拆包查看 Kimi 原型，确认其 Canvas / Trace / Inspector / Dock 结构。
- [x] 将自动展开改为前三层问题空间后暂停。
- [x] 在 Node Inspector 增加节点追问、能力选择和中控 LLM 调度入口。
- [x] 新增用户触发后的动态 Canvas 节点和边。
- [x] 调整节点尺寸和布局，避免用户发散分支重叠。
- [x] 更新 MVP spec 和 demo script。
- [x] 运行 build 和浏览器交互验证。

# Layered Canvas Design + Drag v5

- [x] 搜索并参考开源 DESIGN.md / Design System 规范，把本项目视觉规则沉淀为 `DESIGN.md`。
- [x] 将 `DESIGN.md` 扩展为 YAML tokens + Markdown rationale 的双层结构。
- [x] 将 Canvas 节点改为可拖拽，拖拽状态只覆盖前端布局，不污染原始 reasoning 数据。
- [x] 增加节点拖拽手势样式，避免拖拽时误选中文字或触发页面滚动。
- [x] 运行 build 并在 `http://127.0.0.1:4173/` 验证拖拽。

# Flowith-inspired Canvas Shell v6

- [x] 搜索 Flowith 公开产品叙事，确认其核心是 AI Canvas / Knowledge Garden / 多线程空间工作台。
- [x] 将主界面改成 Flowith-inspired shell：左侧工具 rail、顶部浮动 command bar、中央 Context Canvas、右侧 Context Inspector。
- [x] 在 Canvas 内增加 mode pills 和 selected-thread metadata，降低报告页感。
- [x] 更新 `DESIGN.md`，把 Flowith-inspired UX Direction 写入设计规范。
- [x] 运行 build 和浏览器视觉验收。

# Opus Partial Recovery

- [x] 定位 Opus / Antigravity 未完成会话日志：`.gemini/antigravity-cli/brain/b496847f-794c-404c-a4a7-1a4785de5000/.system_generated/logs/transcript.jsonl`。
- [x] 确认该会话只完成项目阅读，没有产出正式规划 artifact。
- [x] 将半截调研的可复用价值整理到 `docs/OPUS_PARTIAL_RECOVERY.md`。

# Recursive Evidence Search v7

- [x] 将 Opus 半截调研、Maigret 递归搜索和当前 v6 架构整理成 `docs/RECURSIVE_EVIDENCE_SEARCH_PLAN.md`。
- [x] 在 `docs/MVP_V3_SPEC.md` 增补 Recursive Evidence Search 的 BDD 行为和验收标准。
- [x] 在 `DESIGN.md` 增补 clue / frontier / stopped / recursive run 的视觉规范。
- [x] 在 `src/lib/agentExpansion.ts` 增加递归搜索请求、响应类型和 `requestRecursiveSearch()`。
- [x] 在 `src/store/reasoningStore.tsx` 增加递归搜索 run 状态、错误状态和 reducer action。
- [x] 在 `vite.config.ts` 增加 `/api/agent/recursive-search`，复用真实 LLM provider，失败时不生成 mock。
- [x] 在 `NodeInspectorV3.tsx` 增加节点级递归搜索入口、追问框、深度和预算控制。
- [x] 在 `ReasoningWorkspaceV3.tsx` 把 recursive search result 转成 Canvas nodes / edges / trace。
- [x] 在 `ReasoningCanvasV3.tsx`、`SuzhengNode.tsx` 和 `styles.css` 中区分 clue、frontier、stopped、controller run 的视觉层级。
- [x] 运行 `npm run build` 并用浏览器验证节点触发、frontier 等待选择、真实 Provider 调用和 Inspector 证据许可。

# Reasoning Island Navigation v8

- [x] 将 Dynamic Island TOC 交互转译为 Canvas 节点导航，而不是文章目录。
- [x] 新增 `ReasoningIslandNav.tsx`，闭合态显示当前节点、节点类型和图谱进度。
- [x] 展开态提供“节点 / Trace”双标签，支持从底部浮层快速跳转节点或 reasoning step。
- [x] 接入 `ReasoningWorkspaceV3.tsx`，点击节点项同步 Inspector，点击 trace 项复用现有 step 高亮逻辑。
- [x] 在 `styles.css` 增加 backdrop blur、闭合 pill、展开面板、层级缩进和进度环样式。
- [x] 运行 `npm run build`。
- [x] 用浏览器验证闭合、展开、节点跳转、Trace 跳转和关闭按钮收起。

# Three-State Redesign A+B

- [x] 确认 `01-语境化可核查分解/mvp` 是当前 React + TypeScript + Vite 工程，并建立 `npx tsc --noEmit` 基线。
- [x] 将 `App.tsx` 从 `analysisStarted` 布尔值切换到 `input | executing | result` 三态状态机。
- [x] 保持 `Dashboard.onStartAnalysis` 签名不变，确保 Demo 快速/深度模式能驱动不同阶段。
- [x] 新增 `MissionControlView`、`AgentCard`、`StepTimeline`、`CanvasThumbnail` 执行态组件。
- [x] 在 `styles.css` 添加 Agent 色彩变量和 Mission Control 样式。
- [x] 运行 `npx tsc --noEmit` 验证。

# Three-State Redesign C+D+E

- [x] 新增结果态报告组件：`ReportPanel`、`CredibilityBadge`、`SourceList`。
- [x] 新增 `EvidenceMap`，包装既有 `ReasoningCanvasV3` 并支持引用高亮。
- [x] 新增 `ResultWorkspace`，默认展示报告 tab，并保留旧画布作为 `画布` tab。
- [x] 将 App 结果态从 `ReasoningWorkspaceV3` 切换到 `ResultWorkspace`。
- [x] 添加阶段切换动画、结果工作台布局、引用标签、可信度色阶和证据图谱样式。
- [x] 运行 `npx tsc --noEmit`、`npm run build` 并做浏览器验收。

# StepFun P0 Hardening

- [x] 移除 `vite.config.ts` 中的 StepFun 明文 key，改为只读取 `STEPFUN_API_KEY` 环境变量。
- [x] 增加 `.env.local.example` 的 StepFun/MiMo/DeepSeek 占位配置，并用 `.gitignore` 忽略真实 `.env` 文件。
- [x] 将 orchestrate demo fallback 输出标记为 `_source: "demo-fallback"`。
- [x] MissionControl Agent 卡片在 fallback 时显示灰色虚线和“模拟模式”。
- [x] 扫描仓库明文 key，并重跑 `npx tsc --noEmit`、`npm run build`。

# Domestic Model + 360 Demo Integration

- [x] 将用户提供的 360 key 只写入本地 `.env.local`，不写入源码、README 或 example。
- [x] 增加 360 Chat Completions Agent provider，接入 `360gpt-pro` 作为国产大模型备用链路。
- [x] 快速分析进入结果态后也会后台调用 `/api/agent/orchestrate`，demo 不再只是静态结果。
- [x] `/api/search/360` 优先调用 360 AI Search，失败后回退 360 智搜 `aiso-max`。
- [x] 输入态模型展示切到 StepFun / MiMo / DeepSeek / 360 智搜等国产链路。
- [x] 结果态底部展示实际命中的模型名，避免 fallback 或自动路由不可见。
- [x] 在 `ai组件工作流` 归档模型接入目录和可复用组件配置方法。
- [x] 运行 `npx tsc --noEmit`。
- [x] 运行 `npm run build`。
- [x] 本地调用 `/api/search/360` 和 `/api/agent/orchestrate`，确认真实模型链路或可见 fallback。
- [x] 浏览器验证快速分析和深度核查主路径。

# CurioCat Evidence Audit Integration

- [x] 360 搜索来源补齐 `sourceType`、`credibilityScore`、`sourceTier`、`freshnessScore`、`domain` 和 `evidenceRole`。
- [x] 360 AI Search / 智搜 fallback 接入支持与反驳双向查询，并输出支持证据、反驳证据和未解证据缺口。
- [x] 新增 `AgentEvidenceBundle`，让 HandoffStep、Mission Control、Result Workspace 证据图谱都能消费 Agent 证据包。
- [x] 将 `biasWarnings`、`logicRisks`、`cannotInfer`、`doNotInfer` 归一为逻辑风险审计项。
- [x] 逻辑风险接入 FIRE consistency 分数，结构化模型输出和 demo fallback 走同一展示逻辑。
- [x] 运行 `npx tsc --noEmit`。
- [x] 运行 `npm run build`。

## Review

- Build: `npm run build` 通过。
- Browser QA: `http://127.0.0.1:4173/` 通过开始推理、逐步展开、点击因果节点、点击候选证据节点、底部改写检查。
- Visual QA: 最终阶段 17 个 Canvas 节点无 DOM 边界重叠，截图保存在 `/tmp/suzheng-agent-canvas-verified.png`。
- v4 Browser QA: 三层后暂停为“等待选择节点”；点击“替代解释”并选择“联网搜索”后，只在该节点附近新增“中控 LLM 调度 / Searcher 子 Agent / 新增候选证据”三类节点。
- v4 Visual QA: 用户发散后 13 个 Canvas 节点无 DOM 边界重叠，截图保存在 `/tmp/suzheng-user-directed-expansion-final-ok.png`。
- v5 Build: `npm run build` 通过。
- v5 Browser QA: 在 4173 页面展开到三层后，拖动“因果判断”节点，DOM 位置从 `left=681.17/top=750.84` 移动到 `left=850.90/top=838.00`；Inspector 仍显示该节点的因果证据不足说明。
- v6 Build: `npm run build` 通过。
- v6 Browser QA: 4173 页面出现左侧 rail、浮动 command bar、Context Canvas、mode pills、selected-thread metadata 和 Context Inspector；展开到三层后无横向溢出，拖动“因果判断”节点从 `left=758.97/top=761.05` 到 `left=898.70/top=827.86`，Inspector 仍显示因果证据不足。
- v7 Build: `npm run build` 通过。
- v7 API QA: `POST /api/agent/recursive-search` 通过本地 Anthropic-compatible proxy 返回真实结构化结果，模型标识 `anthropic-local:MiniMax-M2.7`，包含 4 条 clues、3 条 frontier、2 条 stopped，未走 mock fallback。
- v7 Browser QA: 4173 demo 进入 Canvas 后出现 Recursive Evidence Search 面板；递归搜索响应回写后节点数从 17 增至 23，新增 2 个 clue、1 个 frontier、1 个 stopped、1 个 controller 节点；Inspector 显示“不能直接说 AI 导致岗位减少”。
- v8 Build: `npm run build` 通过。
- v8 Browser QA: 4173 demo 进入 Canvas 后 Reasoning Island 闭合态显示当前节点；点击后展开为 360x430 面板，backdrop blur 生效；节点 tab 点击“因果判断”后 Inspector 同步为因果判断；Trace tab 点击第 2 步后左侧 trace 选中第 2 步并同步到“概念不明”；关闭按钮可收起。截图保存在 `/tmp/suzheng-reasoning-island-v8.png`。
- Three-state A+B TypeScript: `npx tsc --noEmit` 通过。
- Three-state A+B Build: `npm run build` 通过；Vite 仍提示单个 chunk 超过 500 kB，这是既有体积风险，不阻塞本轮接入。
- Three-state A+B Browser QA: `http://127.0.0.1:5175/` 输入态显示快速/深度按钮；快速 Demo 进入结果工作区；深度 Demo 进入 Mission Control；画布缩略图可展开；取消核查回到输入态。截图保存在 `/tmp/suzheng-three-state-input.png`、`/tmp/suzheng-three-state-mission.png`、`/tmp/suzheng-three-state-mission-expanded.png`。
- Three-state A+B QA note: Codex Browser 插件无可用 `iab` 实例，后端列表为空；本轮改用 Chrome DevTools 验证。Console 有 1 条未带 URL 的 404 资源加载错误，未见 React runtime error。
- Three-state C+D+E TypeScript: `npx tsc --noEmit` 通过。
- Three-state C+D+E Build: `npm run build` 通过；Vite 仍提示单个 chunk 超过 500 kB，这是既有体积风险，不阻塞本轮结果态接入。
- Three-state C+D+E Browser QA: `http://127.0.0.1:5175/` 健康类 Demo 点击“快速分析”后进入 Result Workspace；报告 tab 首屏显示结论、可信度、核查过程和证据来源；旧 AI 岗位样例文案未混入健康 Demo；证据图谱可见，React Flow 容器尺寸为 553x709。
- Three-state C+D+E Browser QA: 结果页 `画布` tab 保留旧 `ReasoningWorkspaceV3` 作为全屏探索降级路径；`重新核查` 可回到输入态；深度模式仍进入 Mission Control。
- Three-state C+D+E Console QA: 刷新并进入结果页后无 error/warn/issue；截图保存在 `/tmp/suzheng-result-workspace-report.png`。
- StepFun P0 Security: `vite.config.ts` 不再包含 StepFun 明文 key；`DEVELOPMENT_LOG.md` 中历史 MiMo key 已改为占位符；`rg` 扫描未发现 StepFun/MiMo 明文 key（`package-lock.json` integrity hash 为误报）。
- StepFun P0 TypeScript/Build: `npx tsc --noEmit` 通过；`npm run build` 通过，仍有既有 500 kB chunk warning。
- Domestic Model + 360 API QA: 充值后 360 Chat Completions 直连返回 HTTP 200，模型 `360gpt-pro`。
- Domestic Model + 360 Search QA: `POST /api/search/360` 返回 `model: 360-ai-search:360gpt-pro`，含 8 条真实来源。
- Domestic Model + 360 Orchestrate QA: `POST /api/agent/orchestrate` 的 4 个 Agent 全部返回 `360-chat:360gpt-pro`，并消费 `360-ai-search:360gpt-pro` 搜索结果。
- Domestic Model + 360 Browser QA: 新标签页验证快速分析会后台刷新为真实模型结果，结果页底部显示 `模型核查 4 步完成 · 360-chat:360gpt-pro`；深度模式进入执行态，显示 MISSION CONTROL 和 RumorDetector 当前任务。截图保存在 `output/playwright/domestic-dashboard.png`、`output/playwright/domestic-result-quick.png`、`output/playwright/domestic-mission.png`。
- Domestic Model + 360 Security: 扫描 `docs`、`src`、`vite.config.ts`、`.env.local.example` 和 `ai组件工作流` 接入文档，未发现真实 key 或 Bearer token；真实 key 只保留在 `.env.local`。
- CurioCat Evidence Audit TypeScript: `npx tsc --noEmit` 通过。
- CurioCat Evidence Audit Build: `npm run build` 通过；Vite 仍提示单个 chunk 超过 500 kB，这是既有体积风险，不阻塞本轮证据审计接入。
- CurioCat Evidence Audit Scope: 本轮只接通 360 搜索证据质量、支持/反驳双向搜索、Agent 证据包、逻辑风险归一和 FIRE consistency 调制；未新增依赖，未读取或写入真实密钥。
