# PRD：真探 Agent V3 — Handoff 链路交互与体验优化

## 1. 背景与现状

真探 Agent V3 的多 Agent Handoff 架构已完成核心开发：
- 后端：`/api/agent/orchestrate` SSE 流式端点，支持 RumorDetector → [FactChecker ∥ SourceValidator] → ReportComposer 的 3 阶段编排
- 前端：AgentPanel 展示真实 handoff 状态，Canvas 渲染 handoff 节点链路，ConclusionDock 显示核查结论
- Dashboard：已提供"开始分析"（快速单 LLM）和"深度核查（多Agent）"两个入口

**当前体验问题（已验证）**：
1. Canvas 上 handoff 节点尺寸过小（约 60×30px），Agent 名称和输出摘要完全不可读
2. Demo 卡片点击后固定走"快速分析"模式，无法一键触发深度核查
3. AgentPanel 的 handoff 条目点击展开后，仅展示耗时和模型，缺少各 Agent 的输入/输出摘要、上下文传递详情

## 2. 目标

在不影响现有 SSE 编排逻辑的前提下，完成 3 项体验优化，使多 Agent Handoff 链路真正具备可演示性。

## 3. 需求详情

### 3.1 Canvas Handoff 节点可读性优化

**现状**：`buildHandoffCanvasNodes` 生成的节点使用默认 `specialist` 类型样式，在 Canvas 上显示为极小的矩形，文字无法辨认。

**需求**：
- 节点宽度从当前约 60px 扩展至 **160px**，高度从约 30px 扩展至 **80px**
- 节点内垂直布局：顶部为 Agent 名称（加粗，14px），中部为 2 行输出摘要（截断，11px，灰色），底部为耗时标签（10px，绿色）
- 节点边框颜色根据状态变化：运行中 = 蓝色脉冲，完成 = 绿色实线，失败 = 红色实线
- 节点间 handoff 边（虚线箭头）需标注传递的上下文 key（如 "rumorIndicators"、"factCheckResult"）
- Canvas 初始化 handoff 节点后，自动调用 `fitView` 将节点区域居中并适当缩放

**验收标准**：
- [ ] 截图验证：单个 handoff 节点内容（Agent 名称 + 输出摘要 + 耗时）清晰可读
- [ ] 4 个 Agent 节点 + 3 条 handoff 边在 1400×900 画布内完整展示，无重叠
- [ ] 节点状态颜色与运行状态同步（运行中蓝色，完成绿色）

### 3.2 Demo 卡片支持深度核查模式

**现状**：`Dashboard.tsx` 中 `handleDemoClick` 只传 `(claim, caseId)`，未传 `orchestrate` 参数，导致点击 Demo 卡片永远走快速单 LLM 模式。

**需求**：
- Demo 卡片增加模式选择交互：点击卡片后弹出一个小型浮层（或卡片翻转），提供两个选项：
  - "快速分析" — 单 LLM 调用，3-5 秒出结果
  - "深度核查（多Agent）" — 走 `/api/agent/orchestrate` SSE 流式编排
- 默认选中"快速分析"，用户可切换
- 选择后点击"开始"进入工作区
- 浮层/翻转动画时长 200ms，使用 CSS transition

**验收标准**：
- [ ] 点击任意 Demo 卡片后，用户可明确选择快速或深度模式
- [ ] 选择"深度核查"后，进入工作区触发 SSE 流式 handoff，AgentPanel 显示实时状态
- [ ] 选择"快速分析"后，行为与当前一致

### 3.3 AgentPanel Handoff 详情展开优化

**现状**：AgentPanel 中 handoff 条目展开后，仅展示一个扁平列表，各 Agent 的输入/输出、上下文传递不可见。

**需求**：
- 展开 handoff 条目后，以时间线（Timeline）形式展示每个 Agent 的执行过程：
  - 第 1 行：Agent 名称 + 状态图标（✅/⏳/❌）+ 模型名 + 耗时
  - 第 2 行：输入摘要（截断至 80 字）
  - 第 3 行：输出摘要（截断至 120 字）
  - 第 4 行：传递给下一 Agent 的上下文 key 列表（如 `rumorIndicators`, `severity`）
- Agent 间用细线分隔，整体呈垂直时间线布局
- 若 Agent 输出包含 `sources` 数组，额外展示"引用来源数：N"

**验收标准**：
- [ ] 展开 handoff 条目后，4 个 Agent 的时间线信息完整展示
- [ ] 每个 Agent 的输入/输出摘要可阅读，无截断导致的语义丢失
- [ ] 上下文传递 key 正确显示（与 orchestrateHandler 中实际传递的 key 一致）

## 4. 技术方案

### 4.1 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/handoffCanvasBuilder.ts` | 修改 | 增大节点尺寸，添加状态颜色、内容布局 |
| `src/components/v3/ReasoningWorkspaceV3.tsx` | 修改 | 添加 `fitView` 调用，确保 handoff 节点居中 |
| `src/components/v3/Dashboard.tsx` | 修改 | Demo 卡片添加模式选择浮层/翻转交互 |
| `src/components/v3/panels/AgentPanel.tsx` | 修改 | handoff 详情展开改为时间线布局，展示输入/输出/上下文 |
| `src/styles.css` | 修改（可能新增 class） | handoff 节点样式、Demo 卡片浮层样式、时间线样式 |

### 4.2 关键实现提示

**Handoff 节点尺寸**：
- Canvas 使用百分比坐标系（CANVAS_WIDTH=1400, CANVAS_HEIGHT=900）
- 节点宽度 160px → 百分比宽度 `160/1400*100 ≈ 11.4%`
- 但当前 `buildHandoffCanvasNodes` 返回的节点数据是否包含 width/height 需要确认；若 ReactFlow 节点未显式设置 `style.width`，则需在节点 data 或 style 中指定

**Demo 卡片模式选择**：
- 可用简单方案：卡片 hover 时显示两个叠加按钮（"快速分析" / "深度核查"），避免复杂浮层动画
- 或：点击卡片后，在卡片原位展开一个小面板，包含两个选项 + 确认按钮

**AgentPanel 时间线**：
- `HandoffStep` 类型（定义在 `src/lib/agentConfigs.ts` 或 vite.config.ts 中）包含 `input`, `output`, `agent`, `latencyMs` 等字段
- 需从 `output` 中提取摘要文本：优先取 `output.summary` 或 `output.conclusion`，若无则取 `output` 的 JSON 字符串前 120 字
- 上下文传递 key：从 `output` 对象的 key 中筛选，排除 `timestamp`, `latencyMs`, `model` 等元数据 key

### 4.3 依赖与约束

- 不修改 `vite.config.ts` 中的 `orchestrateStreamHandler` SSE 逻辑
- 不修改 `src/lib/agentConfigs.ts` 中的 Agent system prompt 定义
- 保持 TypeScript 严格模式编译通过
- 保持现有快速分析流程完全不变

## 5. 验收流程

1. **编译检查**：`npx tsc --noEmit` 无错误
2. **浏览器验证**：
   - 打开 Dashboard → 点击 Demo 卡片 "5G信号塔辐射..." → 选择"深度核查"
   - 观察 Canvas：4 个 handoff 节点清晰可读，带标签虚线边连接，自动居中
   - 观察 AgentPanel：展开 handoff 条目，4 个 Agent 时间线信息完整
   - 观察结论区域：正确显示 handoff 最终结果
3. **截图留存**：Canvas 节点、AgentPanel 展开态各一张截图
