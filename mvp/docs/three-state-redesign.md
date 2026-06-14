# 真探 Agent V3 — 三态界面重构设计文档

> 状态：待实现
> 决策：认可方向，进入详细设计阶段

---

## 1. 现状诊断

当前架构只有一个布尔值 `analysisStarted` 控制 Dashboard ↔ ReasoningWorkspaceV3 的切换。进入工作区后，**执行中、已完成、快速分析、深度核查**全部共用同一套拥挤的三栏布局。

核心痛点：
- 画布被左右栏挤压，handoff 节点不可读
- 执行 115 秒期间，用户盯着 AgentPanel 的小字和 Canvas 的小方块
- 核查结论（最重要信息）被压在底部 dock，首次进入视野需要滚动
- 快速分析（3 秒）和深度核查（115 秒）没有界面体感差异

---

## 2. 三态状态机

```
┌─────────────┐     点击"开始分析"/"深度核查"      ┌─────────────────┐
│   input     │ ─────────────────────────────────→ │   executing     │
│  (输入态)    │    快速模式直接携带结果跳转           │   (执行态)       │
└─────────────┘                                    └─────────────────┘
                                                          │
                                                          │ SSE 流完成
                                                          ↓
                                                   ┌─────────────────┐
                                                   │    result       │
                                                   │   (结果态)       │
                                                   └─────────────────┘
                                                          │
                        点击"重新核查" ←──────────────────┘
```

**快速模式**（单 LLM）：input → result（跳过 executing，3 秒出结果）
**深度模式**（多 Agent Handoff）：input → executing → result（完整三态体验）

### 2.1 状态定义

```typescript
type AppPhase = "input" | "executing" | "result";

// App.tsx 层新增状态
const [appPhase, setAppPhase] = useState<AppPhase>("input");
const [analysisMode, setAnalysisMode] = useState<"quick" | "deep">("quick");
```

### 2.2 状态流转规则

| 当前状态 | 触发事件 | 下一状态 | 说明 |
|---------|---------|---------|------|
| input | 用户点击"开始分析" | result | 快速模式，直接携带结果跳转 |
| input | 用户点击"深度核查" | executing | 进入 Mission Control |
| input | 用户点击 Demo 卡片"快速分析" | result | 同"开始分析" |
| input | 用户点击 Demo 卡片"深度核查" | executing | 同"深度核查" |
| executing | SSE 流收到 `complete` 事件 | result | 自动跳转结果态 |
| executing | 用户点击"取消" | input | 中断核查，回到 Dashboard |
| result | 用户点击"重新核查" | input | 重置并回到 Dashboard |
| result | 用户点击"再次深度核查" | executing | 同一条 claim 重新走深度模式 |

---

## 3. 各态详细设计

### 3.1 输入态（Input Phase）

**组件**：`Dashboard`（现有，改造）

**布局**：居中卡片式，最大宽度 720px

```
┌──────────────────────────────────────────────┐
│                                              │
│              真探 Agent                        │
│         信息真相猎人 — AI 驱动的谣言核查          │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  [输入框]                               │  │
│  │  输入一条你看到的疑似谣言或信息...        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [开始分析]        [深度核查（多Agent）]      │
│                                              │
│  ─────────────────────────────────────────   │
│  快速体验                                      │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ Demo 卡片 1 │ │ Demo 卡片 2 │ │ Demo 3   │ │
│  │ [快速|深度] │ │ [快速|深度] │ │ [...]    │ │
│  └────────────┘ └────────────┘ └──────────┘ │
│                                              │
└──────────────────────────────────────────────┘
```

**改造点**：
- Demo 卡片底部增加模式切换条（快速 | 深度），默认"快速"高亮
- 输入框下方的两个主按钮样式差异化："开始分析"用主色实心，"深度核查"用主色描边 + 脉冲动效
- 保持现有模型选择器（MiniMax / GPT-4 / Claude）

---

### 3.2 执行态（Executing Phase）

**组件**：新建 `MissionControlView`

**设计原则**：
- 全屏沉浸式，**无左右栏**，无底部 dock
- 信息层级：当前 Agent 卡片（最大） > 步骤时间线（中等） > 画布缩略图（最小，可展开）
- 颜色编码：RumorDetector=红，FactChecker=蓝，SourceValidator=紫，ReportComposer=绿

**布局**（100vw × 100vh）：

```
┌────────────────────────────────────────────────────────────┐
│  真探 Agent                              [取消核查] [最小化] │  ← 顶部窄栏 48px
├────────────────────────────────────────────────────────────┤
│                                                            │
│                    ┌─────────────────────┐                 │
│                    │                     │                 │
│                    │   当前 Agent 大卡片   │                 │  ← 中央区域
│                    │   (实时输出内容)      │                 │     占 50% 高度
│                    │                     │                 │
│                    └─────────────────────┘                 │
│                                                            │
│     ●────●────●────●                                       │  ← 步骤时间线
│     RD   FC   SV   RC                                      │     底部上方 80px
│    [✅] [⏳] [○]  [○]                                      │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  📍 画布缩略图 [展开▸]    预计剩余时间: 45s                  │  ← 底部栏 48px
└────────────────────────────────────────────────────────────┘
```

#### 3.2.1 当前 Agent 大卡片

- 宽度：max(480px, 40vw)，居中
- 圆角：20px，阴影：0 8px 32px rgba(0,0,0,0.12)
- 内部结构：
  ```
  ┌────────────────────────────────────┐
  │  🚨  RumorDetector                  │  ← 图标 + Agent 名
  │      谣言特征检测                    │  ← 中文职能
  ├────────────────────────────────────┤
  │  正在分析: "5G信号塔辐射..."         │  ← 当前任务描述
  │                                    │
  │  • 检测到极端比喻措辞                │  ← 实时输出列表
  │  • 发现恐惧诉求特征                  │
  │  • 信源模糊，缺乏权威机构背书        │
  │                                    │
  │  [████████░░░░░░░░░░] 65%          │  ← 进度条（模拟或真实）
  ├────────────────────────────────────┤
  │  ⏱ 已运行 12.4s  ·  model: deepseek│  ← 元数据行
  └────────────────────────────────────┘
  ```
- 卡片边框颜色随 Agent 变化（红/蓝/紫/绿）
- 运行中卡片有微妙的呼吸动画（border-color pulse）

#### 3.2.2 步骤时间线

- 水平排列，4 个圆形节点
- 已完成：实心圆 + ✅
- 进行中：实心圆 + 脉冲动画 + Agent 图标
- 未开始：空心圆
- 节点间用实线连接，当前步骤的连线有流动动画

#### 3.2.3 画布缩略图

- 固定在左下角，尺寸 200×140px
- 展示 handoff 拓扑的迷你版本（节点为小圆点，边为细线）
- 点击"展开"按钮，缩略图扩展为占据右侧 40% 的侧栏，展示完整 Canvas
- 再次点击收回

#### 3.2.4 数据流

```typescript
interface MissionControlViewProps {
  claim: string;
  steps: HandoffStep[];           // 来自 store.handoffRuns[0].steps
  currentStepIndex: number;       // 当前执行到第几步
  totalLatencyMs: number;         // 总耗时
  onCancel: () => void;
  onComplete: () => void;        // SSE 完成后回调，触发切换到 result
}
```

- 组件内部订阅 SSE：`requestOrchestrateStream(claim)`
- 收到 `streamEvent.type === "step"` 时，更新 `currentStepIndex` 和当前卡片内容
- 收到 `streamEvent.type === "complete"` 时，调用 `onComplete()`

---

### 3.3 结果态（Result Phase）

**组件**：新建 `ResultWorkspace`

**设计原则**：
- 报告是主角，画布是配角
- 报告阅读体验类似 Perplexity Pages：结构化、可滚动、内联引用
- 画布作为"证据图谱"嵌入，与报告双向链接

**布局**（100vw × 100vh）：

```
┌──────────────────────────────────────────────────────────────┐
│  真探 Agent    [画布] [报告] [设置]        [重新核查]          │  ← 顶部导航 48px
├────────────────────────────┬─────────────────────────────────┤
│                            │                                 │
│  📋 核查报告                │    🗺 证据图谱                   │
│                            │                                 │
│  ───────────────────────   │                                 │
│  原始说法                  │    ┌─────────┐    ┌─────────┐   │
│  "5G信号塔辐射导致..."      │    │ Rumor   │───→│ Fact    │   │
│                            │    │Detector │    │Checker  │   │
│  ───────────────────────   │    └─────────┘    └────┬────┘   │
│  核查结论                  │                        │        │
│  ❌ 该说法不实             │                   ┌────┴────┐   │
│  可信度: 25% (高度可疑)     │                   │ Report  │   │
│                            │                   │Composer │   │
│  ───────────────────────   │                   └─────────┘   │
│  论证过程                  │                                 │
│                            │    点击节点查看详情              │
│  1. 谣言特征检测            │                                 │
│     RumorDetector 发现该说法 │                                 │
│     包含 3 个谣言特征：      │                                 │
│     • 极端比喻 [E1]         │                                 │
│     • 恐惧诉求 [E2]         │                                 │
│     • 信源模糊 [E3]         │                                 │
│                            │                                 │
│  2. 事实核查                │                                 │
│     FactChecker 检索了      │                                 │
│     世界卫生组织、中国工信   │                                 │
│     部等权威机构资料 [E4]   │                                 │
│     ...                    │                                 │
│                            │                                 │
├────────────────────────────┴─────────────────────────────────┤
│  导出报告 [Markdown] [PDF] [分享链接]                         │  ← 底部操作栏 48px
└──────────────────────────────────────────────────────────────┘
```

#### 3.3.1 左栏：核查报告（60% 宽度）

报告结构（自上而下）：

1. **原始说法卡片**
   - 灰色背景圆角卡片
   - 显示用户输入的 claim
   - 标签：谣言类型（健康/科技/社会/财经）

2. **核查结论卡片**
   - 大字号结论（"该说法不实" / "基本属实" / "部分可信" 等）
   - 可信度评分圆环（25% 显示为红色圆环）
   - 可信度标签（高度可疑 / 基本可信 等）
   - 结论依据一句话摘要

3. **分节论证**
   - 每个 Agent 对应一节
   - 节标题：Agent 名称 + 图标
   - 正文：该 Agent 的分析过程和关键发现
   - 内联引用：`[E1]`、`[E2]` 等 superscript 标签，可点击
   - 引用标签样式：蓝色小圆角背景，hover 时显示来源 tooltip

4. **证据来源列表**
   - 折叠面板，默认折叠
   - 展开后列出所有引用的 URL/来源
   - 每个来源显示：域名、favicon、标题、可信度评分

5. **模型与耗时信息**
   - 页脚小字："由 RumorDetector + FactChecker + SourceValidator + ReportComposer 协作完成 · 总耗时 115.7s · 模型: deepseek-v3"

#### 3.3.2 右栏：证据图谱（40% 宽度）

- 继承现有 Canvas 组件，但初始只展示 handoff 相关节点
- 节点尺寸比执行态缩略图大，但比当前全屏 Canvas 小
- **双向链接**：
  - 点击报告中的 `[E1]` 引用标签 → 图谱自动定位并高亮对应的证据节点
  - 点击图谱中的节点 → 报告自动滚动到引用该节点的章节
- 提供"展开全屏"按钮，点击后图谱占据全屏，报告收缩为左侧抽屉

#### 3.3.3 顶部导航

- 品牌名（左）
- 三个 tab：画布 / 报告 / 设置
  - "报告" tab：当前视图（报告+图谱双栏）
  - "画布" tab：切换到全屏 Canvas 视图（保留现有 ReasoningWorkspaceV3 的画布体验，供高级用户探索）
  - "设置" tab：模型选择、偏好设置
- "重新核查"按钮（右）：回到 Dashboard

#### 3.3.4 底部操作栏

- 导出格式选择：Markdown / PDF / 分享链接
- 分享链接：复制当前报告到剪贴板（现有 `copyToClipboard` 复用）

---

## 4. 组件拆分与文件结构

### 4.1 新增文件

```
src/
├── components/
│   └── v3/
│       ├── phases/
│       │   ├── InputPhase.tsx           # 输入态（包装现有 Dashboard）
│       │   ├── MissionControlView.tsx   # 执行态（全屏进度面板）
│       │   ├── ResultWorkspace.tsx      # 结果态（报告+图谱双栏）
│       │   └── result/
│       │       ├── ReportPanel.tsx      # 左栏核查报告
│       │       ├── EvidenceMap.tsx      # 右栏证据图谱（包装 Canvas）
│       │       ├── CredibilityBadge.tsx # 可信度评分圆环
│       │       └── SourceList.tsx       # 证据来源折叠列表
│       └── mission/
│           ├── AgentCard.tsx            # 当前 Agent 大卡片
│           ├── StepTimeline.tsx         # 4 步水平时间线
│           └── CanvasThumbnail.tsx      # 画布缩略图/展开面板
```

### 4.2 修改文件

```
src/
├── App.tsx                              # 引入 AppPhase 状态机
├── components/v3/
│   ├── Dashboard.tsx                    # Demo 卡片增加模式选择条
│   ├── ReasoningWorkspaceV3.tsx         # 保留为"全屏画布模式"（供结果态的"画布"tab使用）
│   └── ConclusionDockV3.tsx            # 结论 dock 在结果态嵌入 ReportPanel 底部
├── store/reasoningStore.tsx            # 可能新增 action：RESET_FOR_NEW_CASE
└── styles.css                          # 三态布局样式、Mission Control 样式、报告样式
```

### 4.3 保留/复用逻辑

| 现有逻辑 | 复用方式 |
|---------|---------|
| `requestOrchestrateStream` | MissionControlView 内部直接调用 |
| `buildHandoffCanvasNodes` | EvidenceMap 和 CanvasThumbnail 复用 |
| `exportToMarkdown` | ReportPanel 底部导出按钮复用 |
| `calculateCredibilityScore` | ReportPanel 结论卡片复用 |
| `ReportModal` | 可嵌入 ReportPanel 作为"查看详情"弹窗 |

---

## 5. 数据流设计

### 5.1 App 层状态（本地 useState）

```typescript
// App.tsx
const [appPhase, setAppPhase] = useState<AppPhase>("input");
const [analysisMode, setAnalysisMode] = useState<"quick" | "deep">("quick");
```

App 层不管理具体数据，只负责相位切换。

### 5.2 Store 层状态（ReasoningProvider）

新增/调整：

```typescript
// reasoningStore.tsx — 新增 action
| { type: "RESET_FOR_NEW_CASE" }        // 清空当前 case 数据，回到初始状态
| { type: "SET_HANDOFF_CURRENT_STEP"; payload: number }  // 当前执行到第几步
```

`currentHandoffRun` 已存在，MissionControlView 通过 `selectLatestHandoffRun(state)` 读取。

### 5.3 各态数据依赖

| 组件 | 依赖数据 | 来源 |
|------|---------|------|
| InputPhase | Demo 卡片列表 | 本地常量 |
| MissionControlView | claim, steps, currentStepIndex | store.handoffRuns[0] + 本地 SSE 状态 |
| ResultWorkspace | caseData, report, handoffResult | store + runDemoPipeline |
| ReportPanel | report, handoffSteps, credibilityScore | store + 计算函数 |
| EvidenceMap | handoffNodes, handoffEdges | buildHandoffCanvasNodes(handoffResult) |

---

## 6. 关键实现决策

### 6.1 为什么 AppPhase 放在 App.tsx 而不是 store？

AppPhase 是**界面级**状态，不是**业务逻辑级**状态。它决定的是"展示哪个大页面"，而不是核查推理过程本身。放在 App.tsx 的 useState 中更轻量，也避免 store 膨胀。

### 6.2 执行态的 SSE 谁来订阅？

`MissionControlView` 内部直接调用 `requestOrchestrateStream`，不经过 ReasoningWorkspaceV3。这样执行态是一个独立的、自包含的组件，与现有 Canvas 逻辑解耦。

SSE 流完成后，`MissionControlView` 把完整结果通过 `onComplete` 回调传给 App，App 切到 result 态。同时，结果数据也需要写入 store（通过 dispatch `ADD_HANDOFF_RUN`），供 ResultWorkspace 读取。

### 6.3 快速模式如何"跳过"执行态？

快速模式（单 LLM）在 App.tsx 中处理：

```typescript
const handleStartAnalysis = (claim, caseId, orchestrate) => {
  if (!orchestrate) {
    // 快速模式：直接请求单 LLM，拿到结果后直接进入 result
    requestQuickAnalysis(claim).then(result => {
      dispatch({ type: "INIT_CASE", payload: { ... } });
      setAppPhase("result");
    });
  } else {
    // 深度模式：先进入 executing，SSE 完成后再进入 result
    setAppPhase("executing");
  }
};
```

### 6.4 现有 ReasoningWorkspaceV3 怎么办？

不完全删除，改为**"全屏画布探索模式"**。在结果态的顶部导航中增加"画布"tab，点击后切换到 `ReasoningWorkspaceV3`（传入一个 prop 如 `embedded={true}` 来隐藏顶部栏和底部 dock，使其适配作为 tab 内容）。

这样既保留了对现有画布探索功能的兼容，又不让它在所有状态都占据主界面。

---

## 7. 样式规范

### 7.1 颜色体系（新增）

```css
:root {
  /* Agent 品牌色 */
  --agent-rumor: #dc2626;        /* 红 */
  --agent-fact: #2563eb;         /* 蓝 */
  --agent-source: #7c3aed;       /* 紫 */
  --agent-report: #16a34a;       /* 绿 */

  /* 执行态背景 */
  --mission-bg: #f8f9fb;
  --mission-card-bg: #ffffff;

  /* 可信度 */
  --credibility-high: #16a34a;    /* 可信 */
  --credibility-medium: #ca8a04;  /* 部分可信 */
  --credibility-low: #dc2626;     /* 高度可疑 */
}
```

### 7.2 字体层级

| 元素 | 字号 | 字重 |
|------|------|------|
| 结论大标题 | 28px | 700 |
| 章节标题 | 18px | 600 |
| 正文 | 15px | 400 |
| 引用标签 [E1] | 12px | 600 |
| Agent 卡片标题 | 20px | 600 |
| Agent 卡片内容 | 15px | 400 |
| 时间线标签 | 13px | 500 |

---

## 8. 实现顺序与 Codex 任务包

### 任务包 A：基础状态机 + 输入态改造
**目标**：App.tsx 引入 AppPhase，Dashboard 支持 Demo 卡片模式选择
**文件**：`App.tsx`, `Dashboard.tsx`
**依赖**：无

### 任务包 B：执行态（MissionControlView）
**目标**：新建 MissionControlView + AgentCard + StepTimeline + CanvasThumbnail
**文件**：`MissionControlView.tsx`, `AgentCard.tsx`, `StepTimeline.tsx`, `CanvasThumbnail.tsx`
**依赖**：任务包 A
**关键**：内部调用 `requestOrchestrateStream`，处理 SSE 流事件

### 任务包 C：结果态 — 报告面板
**目标**：ReportPanel + CredibilityBadge + SourceList
**文件**：`ReportPanel.tsx`, `CredibilityBadge.tsx`, `SourceList.tsx`
**依赖**：任务包 A

### 任务包 D：结果态 — 证据图谱 + 整合
**目标**：EvidenceMap（包装 Canvas）+ ResultWorkspace 整合 + 双向链接
**文件**：`EvidenceMap.tsx`, `ResultWorkspace.tsx`
**依赖**：任务包 B、C

### 任务包 E：样式收尾
**目标**：所有新增组件的 CSS，三态切换动画
**文件**：`styles.css`
**依赖**：任务包 A、B、C、D

---

## 9. 风险与回退

| 风险 | 缓解方案 |
|------|---------|
| 重构范围过大，现有功能回退 | 每个任务包独立可验证；保留现有 ReasoningWorkspaceV3 作为"画布"tab |
| Canvas 双向链接实现复杂 | 第一阶段可先实现单向（报告→图谱），图谱→报告留作二期 |
| 快速模式也需要结果态 UI | 快速模式的结果数据结构和深度模式不同，需要适配 ReportPanel 的 props |
| 样式文件膨胀 | 新增组件优先使用 CSS Modules 或 styled-jsx，避免继续往 styles.css 堆 |

---

## 10. 验收标准（整体）

- [ ] 快速模式：Dashboard → 3 秒内 → 结果态报告页面
- [ ] 深度模式：Dashboard → MissionControlView（115 秒）→ 结果态报告页面
- [ ] MissionControlView 全屏无左右栏，当前 Agent 卡片清晰可读
- [ ] 4 步时间线正确反映执行进度
- [ ] 结果态报告可读性强，结论在首屏可见
- [ ] 点击报告中的 `[E1]` 引用，图谱高亮对应节点
- [ ] TypeScript 编译通过
- [ ] 现有"画布"tab 仍能进入全屏 Canvas 探索模式
