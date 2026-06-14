# Codex 提示词：任务包 C / D / E

> 任务包 A 和 B 已在并行开发中。C 可以独立准备，D 建议等 C 完成后跑（因为 D 依赖 C 的组件接口）。E 最后跑。

---

## 任务包 C：结果态 — 报告面板（ReportPanel + CredibilityBadge + SourceList）

```markdown
你正在开发一个 React + TypeScript + Vite 项目。请在 `src/components/v3/phases/result/` 目录下新建以下组件：

### 1. CredibilityBadge.tsx
可信度评分圆环组件。

Props:
```typescript
interface CredibilityBadgeProps {
  score: number;        // 0-100
  label: string;        // "可信" | "基本可信" | "部分可信" | "高度可疑" | "疑似谣言"
}
```

要求：
- 使用 SVG 绘制圆环进度条（stroke-dasharray 实现）
- 颜色映射：
  - score >= 80: #16a34a (绿)
  - score >= 60: #ca8a04 (黄)
  - score >= 40: #f97316 (橙)
  - score >= 20: #dc2626 (红)
  - score < 20: #7f1d1d (深红)
- 圆环直径 80px，线宽 8px
- 中央显示分数（24px 粗体）+ 标签（12px）

### 2. SourceList.tsx
证据来源折叠列表。

Props:
```typescript
interface Source {
  id: string;
  title: string;
  url?: string;
  reliability?: "high" | "medium" | "low" | "unverified";
}

interface SourceListProps {
  sources: Source[];
}
```

要求：
- 默认折叠，标题行显示"证据来源 (N条)" + 展开/收起箭头
- 展开后显示来源列表，每项包含：序号、标题（截断40字）、可靠性标签
- 可靠性标签颜色：high=绿, medium=黄, low=红, unverified=灰
- 若来源有 url，标题可点击在新标签页打开

### 3. ReportPanel.tsx — 核心组件
核查报告主面板。

Props:
```typescript
interface ReportPanelProps {
  claim: string;
  rumorType?: "健康" | "科技" | "社会" | "财经";
  conclusion: string;
  credibilityScore: number;
  credibilityLabel: string;
  summaryForPublic: string;
  steps: Array<{
    agent: string;
    agentName: string;
    agentIcon: string;
    output: Record<string, unknown>;
    latencyMs: number;
    model: string;
  }>;
  onSourceClick?: (sourceId: string) => void;  // 点击引用标签时回调
}
```

报告结构（自上而下渲染）：

1. **原始说法卡片**
   - 灰色背景 (#f8f9fb)，圆角 12px，padding 16px
   - 显示 claim 全文
   - 若有 rumorType，右上角显示类型标签

2. **核查结论卡片**
   - 左侧 CredibilityBadge 圆环
   - 右侧：大字号结论（20px 粗体）+ 可信度标签 + 一句话摘要
   - 整体为白色卡片，带左边框（颜色根据可信度）

3. **分节论证** — 每个 step 对应一节
   - 节标题：`{agentIcon} {agentName}`（16px 粗体）
   - 正文内容从 step.output 中提取：
     - RumorDetector: `output.analysis` + `output.rumorIndicators` 列表
     - FactChecker: `output.keyFindings` 列表 + `output.factCheckResult`
     - SourceValidator: `output.verificationNotes` + `output.verifiedSources` 数量
     - ReportComposer: `output.summaryForPublic`
   - 每个关键发现后可附加引用标签 `[E{N}]`（蓝色小圆角背景，12px）
   - 引用标签点击触发 `onSourceClick`

4. **证据来源列表** — 使用 SourceList 组件
   - 从所有 steps 的 output.sources 中收集唯一来源

5. **页脚信息**
   - "由 {agentNames} 协作完成 · 总耗时 {totalLatencyMs}s"
   - 小字，灰色

要求：
- 左栏容器宽度 100%，内部最大宽度 680px，居中
- 可纵向滚动
- TypeScript 严格模式
- 运行 `npx tsc --noEmit` 验证
```

---

## 任务包 D：结果态 — 证据图谱 + 整合（EvidenceMap + ResultWorkspace）

> ⚠️ 建议等任务包 C 完成后再跑此提示词，因为需要知道 ReportPanel 的确切接口。

```markdown
你正在开发一个 React + TypeScript + Vite 项目。请在 `src/components/v3/phases/` 目录下新建以下组件：

### 1. EvidenceMap.tsx
证据图谱组件（包装现有 Canvas）。

Props:
```typescript
interface EvidenceMapProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  highlightedNodeId?: string | null;   // 高亮节点ID
  onNodeClick?: (nodeId: string) => void;
}
```

要求：
- 复用现有 `ReasoningCanvasV3` 组件（从 `src/components/v3/ReasoningCanvasV3.tsx` 导入）
- 传入 `nodes` 和 `edges`，初始只展示 handoff 相关节点
- 当 `highlightedNodeId` 变化时，调用 ReactFlow 的 `setCenter` 将该节点居中并高亮
- 提供"展开全屏"按钮，点击后通过 `onToggleFullscreen` 回调通知父组件

### 2. ResultWorkspace.tsx — 核心整合组件
结果态主工作区。

Props:
```typescript
interface ResultWorkspaceProps {
  claim: string;
  handoffResult: HandoffResult | null;
  onReset: () => void;     // 点击"重新核查"
}
```

布局（100vw × 100vh）：

```
顶部导航栏（48px）：
- 左侧：品牌名"真探 Agent"
- 中部：三个 tab [画布] [报告] [设置]
  - "报告"为默认激活态
  - "画布"切换到全屏 Canvas 探索模式（渲染现有 ReasoningWorkspaceV3 的画布部分）
  - "设置"显示偏好设置
- 右侧：[重新核查] 按钮

主体区域：
- "报告"tab：左右双栏
  - 左栏（60%）：ReportPanel（从 `src/components/v3/phases/result/ReportPanel.tsx` 导入）
  - 右栏（40%）：EvidenceMap
  - 中间有可调分隔线（draggable splitter，可选实现）
- "画布"tab：全屏 Canvas（复用现有画布逻辑）

底部操作栏（48px）：
- 左侧："导出报告"下拉菜单 [Markdown] [PDF]
- 右侧：[分享链接] 按钮
```

双向链接逻辑：
- ReportPanel 的 `onSourceClick` 回调传入 EvidenceMap 的 `highlightedNodeId`
- EvidenceMap 的 `onNodeClick` 回调需要能让 ReportPanel 滚动到对应章节（可通过 ref 或 scrollIntoView 实现）
- 第一阶段可先实现单向（报告→图谱），图谱→报告留作后续优化

要求：
- TypeScript 严格模式
- 运行 `npx tsc --noEmit` 验证
- 不修改现有 ReasoningCanvasV3 的内部逻辑，只通过 props 控制
```

---

## 任务包 E：样式收尾 + 三态切换动画

> 等 A/B/C/D 全部完成后跑。

```markdown
你正在开发一个 React + TypeScript + Vite 项目。请完善 `src/styles.css` 中的以下样式：

### 1. 三态切换动画
- `.phase-enter`：opacity 0 → 1，translateY(20px) → 0，duration 400ms，ease-out
- `.phase-exit`：opacity 1 → 0，translateY(0) → -20px，duration 300ms，ease-in
- App.tsx 中切换 phase 时，旧组件先播放 exit 动画，新组件播放 enter 动画

### 2. MissionControlView 样式
- `--mission-bg: #f8f9fb`
- `--mission-card-bg: #ffffff`
- Agent 卡片阴影：0 8px 32px rgba(0,0,0,0.12)
- 步骤时间线：已完成节点实心+白色对勾，进行中节点脉冲动画（box-shadow 呼吸），未开始节点空心灰边
- 画布缩略图展开/收起动画：width 200px → 40vw，duration 400ms，ease-out

### 3. ResultWorkspace 样式
- 左栏报告背景：#ffffff
- 右栏图谱背景：#f8f9fb
- 顶部 tab 激活态：底部 2px 蓝色边框
- 底部操作栏：上边框 1px solid rgba(0,0,0,0.08)

### 4. 引用标签 [E1] 样式
- `.source-citation`：
  - display: inline-flex
  - background: rgba(0, 113, 227, 0.1)
  - color: #0071e3
  - font-size: 12px
  - padding: 2px 6px
  - border-radius: 4px
  - cursor: pointer
  - hover: background 加深

### 5. 全局变量补充
```css
:root {
  --agent-rumor: #dc2626;
  --agent-fact: #2563eb;
  --agent-source: #7c3aed;
  --agent-report: #16a34a;
  --credibility-high: #16a34a;
  --credibility-medium: #ca8a04;
  --credibility-low: #dc2626;
}
```

要求：
- 不破坏现有 `.canvas-node` 等已有样式
- 运行 `npx tsc --noEmit` 验证（TypeScript 不改的话应该仍通过）
- 在浏览器中验证三种状态切换时动画流畅
```

---

## 验收清单（整体）

- [ ] 快速模式：Dashboard → 3秒内 → 结果态报告页面
- [ ] 深度模式：Dashboard → MissionControlView（SSE流）→ 结果态报告页面
- [ ] MissionControlView 全屏无左右栏，当前 Agent 卡片清晰可读
- [ ] 4步时间线正确反映执行进度（已完成/进行中/未开始）
- [ ] 结果态报告可读性强，结论在首屏可见
- [ ] 点击报告中的 `[E1]` 引用，图谱高亮对应节点
- [ ] 顶部"画布"tab 能进入全屏 Canvas 探索模式
- [ ] TypeScript 编译通过 `npx tsc --noEmit`
- [ ] 三种状态切换时有平滑动画
