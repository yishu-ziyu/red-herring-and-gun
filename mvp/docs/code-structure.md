# 代码结构说明

日期：2026-05-31

本文档说明当前 MVP 的主要代码边界，方便后续继续改 Mission Control、Agent Team、搜索证据展示和 Demo 部署。

## 项目定位

这是一个 Vite + React + TypeScript 的谣言核查 MVP。核心产品不是普通聊天，而是把一条待核查信息拆成可审计流程：

```text
用户输入
-> 中控系统分诊
-> RumorDetector 拆解命题和风险信号
-> FactChecker 调用搜索/核查工具收集支持与反驳证据
-> SourceValidator 审计来源、独立性、时效和可引用边界
-> ReportComposer 收束成最终判断、公众表达和闭环动作
-> 前端把每一步和证据同步展示
```

评分口径固定为：

- `credibilityScore`：原始信息本身的可信度，越高越可信，越低越不实。
- `判断置信度`：面向用户的判断把握。如果结论是“不实/谣言”，它通常等于 `100 - 原信息可信度`。

## 顶层目录

```text
mvp/
├── src/                    # 前端、Agent 配置、搜索、证据、运行时核心代码
├── public/                 # favicon、Logo、Agent 头像、工具图标
├── docs/                   # 产品、架构、设计和技术文档
├── tasks/                  # 当前任务和经验记录
├── server/                 # 历史 Express 服务子工程，仍保留但不是本地主链路
├── vite.config.ts          # Vite 配置，同时承载本地 API 中间件
├── package.json            # npm 脚本和依赖
├── vercel.json             # Vercel 部署配置
└── dist/                   # 构建产物，不作为源码修改入口
```

## 应用入口

### `src/main.tsx`

React 挂载入口，加载 `App` 和全局样式。

### `src/App.tsx`

应用路由和主状态切换入口。当前不是 React Router，而是直接根据 `window.location.pathname` 切页面：

- `/`：真实产品首页，进入 Dashboard。
- `/demo`：证据矩阵 Demo 页。
- `/analysis-preview`：开发环境 Mission Control 预览。
- `/model-settings-preview`：开发环境模型服务商配置预览。

真实核查从 `Dashboard` 收集输入，进入 `MissionControlView`。

## 前端主界面

### `src/components/v3/Dashboard.tsx`

首页输入和启动真实核查的入口。它负责把文本、链接、图片等输入整理成 `CaseIntake`，再交给 `App`。

注意：该文件当前有用户并行修改，后续改动前要重新读最新状态。

### `src/components/v3/phases/MissionControlView.tsx`

当前最重要的执行态界面。职责包括：

- 调用 `/api/agent/orchestrate-stream`。
- 接收 SSE 风格事件并维护当前步骤。
- 把中控过程渲染成左侧流式推演。
- 把工具调用、Agent 输出、来源卡片、最终报告渲染到右侧阅读窗。
- 保存最终 case 和 memory candidate。
- 处理开发预览数据。

继续改左侧/右侧交互时，优先从这个文件下手。不要把同一信息重复塞进多个 UI 区块；左侧负责“现在走到哪一步”，右侧负责“这一条具体查到了什么”。

### `src/components/v3/ConclusionDockV3.tsx`

旧工作台里的结论底栏，仍可能被部分 V3 页面使用。它展示原信息可信度、核查后结论，并触发导出、分享、存疑归档。

### `src/components/v3/EvidenceMatrix*.tsx`

证据矩阵和可视化 Demo。它们适合展示证据支持/反驳关系，但不是当前 Mission Control 的主执行入口。

### `src/components/v3/settings/ModelProviderSettingsPreview.tsx`

模型服务商配置预览页。用于展示 DeepSeek、360GPT 等 provider 的默认配置。

## 核心业务模块

### `src/lib/agentConfigs.ts`

Agent Team 的角色、提示词、工具能力、记忆契约和结构化输出 schema 都在这里。

主要角色：

- `rumor_detector`：立案分诊和谣言类型识别。
- `fact_checker`：支持/反驳双向核查。
- `source_validator`：信源可靠性、溯源和证据边界审计。
- `report_composer`：最终报告、公众表达和闭环动作。

需要改模型输出口径时，优先改这里。例如 `credibilityScore` 已明确为“原信息可信度”，不是“判假置信度”。

### `src/lib/agentExpansion.ts`

前端调用后端/本地 API 的客户端封装。重点接口：

- `requestOrchestrateStream()`：调用 `/api/agent/orchestrate-stream`，逐条产出事件。
- `requestOrchestrate()`：非流式 orchestrate 调用。
- `request360Search()`：导出 360 Search 调用入口。

### `src/lib/schemas.ts`

跨模块共享的数据结构定义，包括最终报告、证据、搜索来源、Agent evidence bundle 等。

### `src/lib/reportExporter.ts`

导出 Markdown 报告、生成辟谣卡片、分享文本和存疑归档。任何面向用户的结论文案出口，都要检查这里是否需要同步口径。

## Agent Runtime

目录：`src/lib/agentRuntime/`

```text
agentRuntime/
├── AgentRuntime.ts              # Agent 编排执行核心
├── agentProviders.ts            # DeepSeek、360、MiMo、StepFun 等模型 provider
├── events.ts                    # 工具和 Agent 事件构造
├── memoryCandidateGenerator.ts  # 生成可沉淀记忆候选
├── memoryCandidateStore.ts      # 本地 JSONL 记忆候选存储
├── memoryStore.ts               # 本地 case/memory 存储
├── orchestrateShared.ts         # intake、视觉、搜索 query 等共享编排函数
├── toolRegistry.ts              # 工具注册表
└── types.ts                     # Runtime 类型
```

后续要把编排逻辑从 `vite.config.ts` 继续抽干净，优先往这里迁移。目标是让 UI、Vite 中间件、Express 服务都调用同一套 Agent Runtime，而不是复制逻辑。

## 搜索、证据和评分

### 搜索与来源

- `src/lib/search360.ts`：360 Search 调用。
- `src/lib/sherlockStyleSearch.ts`：多搜索源并行检索和 Sherlock 风格状态。
- `src/lib/evidenceSearchRouter.ts`：搜索任务路由。
- `src/lib/linkScraper.ts`：链接抓取。
- `src/lib/sourceCredibility.ts`：来源类型、域名、可信度和证据角色标注。
- `src/lib/sourceIndependence.ts`：来源独立性判断。

### 证据和共识

- `src/lib/evidenceConsensus.ts`：支持/反驳证据共识判断。
- `src/lib/evidenceQuality.ts`：证据质量评分。
- `src/lib/confidenceEngine.ts`：FIRE 等置信度维度计算。
- `src/lib/causalValidation.ts`：因果边界检查。
- `src/lib/biasAudit.ts`：偏误和逻辑风险审计。

### 规则与本地检测

- `src/lib/rumorDetection.ts`：无需 LLM 的谣言特征规则检测。
- `src/lib/graderRules.ts`：评分规则辅助。

## 本地 API 和部署链路

### `vite.config.ts`

当前本地开发的 API 中间件主要在这里，包括：

- `/api/agent/orchestrate`
- `/api/agent/orchestrate-stream`
- 视觉材料预处理
- 360/AnySearch/Metaso/Tavily/Exa 等搜索编排
- Agent Runtime 调用
- SSE 事件输出

这是历史上为了快速跑 Demo 放在 Vite 插件里的后端逻辑。它能跑，但长期应该继续下沉到 `src/lib/agentRuntime/` 或 `server/src/handlers.ts` 的共享模块。

### `server/`

保留的 Express 服务子工程，含 `server/src/handlers.ts` 和构建产物。当前本地开发主链路仍以 `vite.config.ts` 为准；改 server 前要确认部署目标是否真的使用它。

### Vercel

- `vercel.json`：部署配置。
- `.vercel/project.json`：本地 Vercel 绑定信息。
- `public/logo.png`：站点 favicon 和品牌图标来源。

## 数据和 Demo

- `src/data/rumorCases/`：领域示例 case。
- `src/data/mockEvidenceConsensus.ts`：证据共识 Mock。
- `src/lib/demoData.ts`：模型不可用时的保守 fallback 数据。注意：fallback 不应该伪装成真实核查结论。
- `public/agents/`：Agent 头像。
- `public/tool-icons/`：工具调用图标。

## 状态管理

### `src/store/reasoningStore.tsx`

全局 reasoning 状态容器，基于 React Context + reducer。它管理：

- Handoff stream 状态。
- Agent steps。
- finalReport。
- Streaming reasoning stage。
- consensus report。

Mission Control 内部也有局部状态。改状态时要先判断该状态是跨页面共享，还是只属于执行态 UI。

## 样式

### `src/styles.css`

当前样式集中在一个大 CSS 文件里。主要区域包括：

- 首页和基础布局。
- V3 工作台。
- Mission Control 执行态。
- Agent Team、工具卡片、右侧阅读窗。
- 最终报告、来源卡片、评分解释。

改 UI 时建议用现有 class 继续收敛，不要新增平行设计系统。Mission Control 的清洁版样式多以 `.case-workbench-view--clean` 为作用域。

## 测试

- `src/App.test.tsx`：主要覆盖预览路由、真实核查入口、Mission Control UI 约束。
- `src/test/setup.ts`：Vitest DOM 测试 setup。
- `src/lib/caseIntake.test.ts`：case intake 相关测试，目前是未跟踪文件，改动前要确认是否属于用户并行工作。

常用命令：

```bash
npm run test
npm run build
git diff --check
```

## 修改指南

### 改 Mission Control 左侧流式过程

优先看：

- `MissionControlView.tsx` 的 `buildControllerProcessEvents()`
- `processSummaryForStep()`
- `agentStartTitle()` / `agentCompleteTitle()`
- `buildPreviewStreamItems()`

左侧只保留中控推演和关键动作，不要展示废话型解释。

### 改右侧阅读窗

优先看：

- `ControllerReadingWindow`
- `MissionFinalReportPanel`
- `ToolEvidenceSources`
- `SourceReferenceList`

右侧要展示具体证据：来源、链接、摘要、支持/反驳角色、可信度、边界。少写“为什么走到这一步”这类空泛话。

### 改 Agent 输出或模型行为

优先看：

- `agentConfigs.ts`
- `schemas.ts`
- `agentRuntime/AgentRuntime.ts`
- `vite.config.ts` 的 orchestrate stream handler

提示词和 schema 要同步改，否则模型输出会和 UI 语义冲突。

### 改搜索工具

优先看：

- `agentRuntime/toolRegistry.ts`
- `agentRuntime/orchestrateShared.ts`
- `sherlockStyleSearch.ts`
- `search360.ts`
- `sourceCredibility.ts`

搜索结果必须保留 provider 名称，例如 `360 Search`、`AnySearch`、`Metaso`、`Tavily`、`Exa`，方便 Demo 展示工具调用。

### 改最终报告、导出和分享

优先看：

- `MissionFinalReportPanel`
- `ConclusionDockV3.tsx`
- `reportExporter.ts`

任何“分数”都要写清楚是“原信息可信度”还是“判断置信度”。

## 当前风险

- `vite.config.ts` 仍然承担过多后端职责，后续应逐步迁移到 `agentRuntime`。
- `server/` 和 Vite 中间件存在历史重复，部署目标变更前需要重新核对。
- `src/styles.css` 很大，继续改 UI 时要注意作用域，避免影响旧页面。
- 工作区经常存在并行修改，提交前只 stage 本次相关文件。

