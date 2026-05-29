---
name: "溯证 Agent Design System"
version: "0.4"
scope: "Agent Reasoning Canvas MVP"
description: "A Flowith-inspired layered reasoning canvas where users decide which node should continue expanding."
colors:
  stageBg: "#070807"
  stagePanel: "#0e0f0d"
  layerRing: "#efe45d"
  nodeBlue: "#4f99de"
  nodeBlueDeep: "#233d65"
  nodeActive: "#efe45d"
  nodeRisk: "#f59e0b"
  nodeSupported: "#83e6b0"
  nodeBlocked: "#ef4444"
  nodeRewrite: "#a855f7"
  nodeClaim: "#f7f4ec"
  nodeClue: "#79b9ff"
  nodeFrontier: "#facc15"
  nodeStopped: "#64748b"
  nodeController: "#c084fc"
  textPrimary: "#f3f0e9"
  textInverse: "#0a0c0b"
typography:
  canvasNode:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13px"
    lineHeight: "1.24"
    letterSpacing: "0"
  inspectorBody:
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    lineHeight: "1.6"
    letterSpacing: "0"
rounded:
  node: "16px"
  panel: "24px"
  control: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  canvasNode:
    backgroundColor: "{colors.nodeBlue}"
    textColor: "{colors.textPrimary}"
    rounded: "{rounded.node}"
    padding: "9px 10px"
  claimNode:
    backgroundColor: "{colors.nodeClaim}"
    textColor: "{colors.textInverse}"
    rounded: "{rounded.node}"
  layerRing:
    stroke: "{colors.layerRing}"
    strokeWidth: "3px"
---

# 溯证 Agent Design System

## Reference Inputs

This project uses the DESIGN.md convention as a compact design contract: machine-readable tokens in YAML front matter plus human-readable rationale in Markdown. The canvas also borrows the discipline of mature open-source design systems: tokens, component rules, accessibility, and repeatable interaction behavior should live in one durable spec instead of scattered comments.

References:

- Google Labs `design.md`: a DESIGN.md file combines YAML design tokens with Markdown rationale for coding agents.
- IBM Carbon Design System: useful precedent for tokenized components and consistent interface rules.
- U.S. Web Design System: useful precedent for accessibility-first, repeatable interaction standards.

## Flowith-Inspired UX Direction

Flowith-style interaction is a spatial AI workspace, not a report surface. The user should feel that they are inside a reasoning canvas where multiple thinking threads can coexist.

Adopt:

- Floating command bar instead of a heavy page header.
- Persistent left tool rail for canvas / agent / knowledge / settings modes.
- Main canvas as the visual center, with side panels as supporting context.
- Small metadata chips and mode pills inside the canvas, so controls feel local to the workspace.
- Node-first expansion: the user selects where the next agent call happens.

Avoid:

- Copying Flowith branding, logos, or exact commercial styling.
- Turning the product into a generic mind-map; evidence permission and inference blocking must remain visible.

## Product Feeling

溯证 Agent 的界面不是报告页，也不是普通流程图。它应该像一个可被用户调度的推理机器：

- 中心观点先进入系统。
- 判断层把观点拆成不同推理通道。
- 证据 / Agent 层承接用户选择后的继续发散。
- 每个节点都可以被点击、追问、拖拽和重新组织。

视觉目标：黑色舞台、清晰层级、发光连接、可移动的推理模块。

## Layout Rules

### Workspace

- 顶部保留输入观点和 Agent 状态。
- 左侧只放 reasoning trace，强调“Agent 做了什么判断”。
- 中央 Canvas 是主视觉，占据最大面积。
- 右侧 Inspector 解释当前节点，不和 Canvas 抢主层级。
- 底部 Conclusion Dock 只做结论收束，不承载探索。

### Canvas Layers

Canvas 必须呈现纵向层级，而不是平铺白板：

1. Source Layer：中心观点 / 输入标签。
2. Encoder Layer：判断编码层，包括概念、数量、机制、因果、反证。
3. Decoder Layer：证据需求、候选证据、子 Agent、局部改写。

每一层应该有清楚的视觉边界。当前 MVP 使用黄色椭圆环表示层级范围。

## Visual Tokens

### Color

- Page background：`#050706` 到 `#090d10` 的黑色舞台。
- Layer ring：`#fff219`，只用于层级边界。
- Primary node：蓝色发光块，用于普通判断和证据节点。
- Active node：黄色块，用于当前正在展开的节点。
- Risk node：橙色块，用于强断言、高风险因果或需警惕节点。
- Supported node：绿色块，用于局部支持。
- Blocked node：红色块，用于推理阻断。
- Rewrite node：紫色块，用于降强度表达。
- Claim node：白色标签，表示外部输入进入系统。
- Evidence clue node：亮蓝色块，用于递归搜索发现的证据线索。
- Frontier node：黄色块，用于可继续扩展、但等待用户选择的下一步线索。
- Stopped node：灰蓝色低优先级块，用于预算、重复、低可信或越界而停止的线索。
- Controller run node：浅紫色块，用于中控 LLM 的调度说明。

### Shape

- 节点使用 2.5D 块状视觉，有顶面、厚度和阴影。
- 不使用大面积卡片堆叠表现推理。
- 层级边界用椭圆环，不用普通 section 卡片。
- 连线使用曲线，表现从上层向下层传导。

### Typography

- Canvas 节点标题短而硬，优先 2-8 个汉字。
- Inspector 可以承载较长解释。
- Canvas 上避免大段说明文字。

## Component Rules

### Canvas Node

节点必须支持：

- Click：选中节点并同步 Inspector。
- Drag：允许用户重新组织节点位置。
- Highlight：点击 Trace 时高亮相关节点。
- Status color：使用 status 表达风险、支持、阻断、改写。

拖拽规则：

- 拖拽只改变当前前端布局，不改变原始 reasoning 数据。
- 重置推理时清空拖拽位置。
- 拖拽后仍保持节点可点击、Inspector 可读、Agent 可调用。

### Edges

- 使用 SVG 曲线连接节点。
- 高亮节点相关边时使用蓝色发光。
- 边标签必须小，不应抢过节点标题。

### Inspector

Inspector 负责解释，不负责展示全图。

必须展示：

- 节点含义。
- 当前节点需要什么证据。
- 可以说什么。
- 不能说什么。
- 用户在该节点上触发 Agent 的入口。

### Node-triggered Agent

真实模型调用只能在用户选择节点并点击触发后发生。

Provider 顺序：

1. OpenAI Responses API。
2. 本机 Anthropic-compatible proxy。
3. Codex CLI。

不得在真实 provider 失败时生成模拟分支。

### Recursive Evidence Search

递归证据搜索是节点级能力，不是全局自动任务。

必须遵守：

- 用户点击节点后，Inspector 才显示递归搜索入口。
- 用户没有点击触发按钮时，不调用模型。
- 每轮搜索只生成本轮 clues、frontier 和 stopped，不自动继续展开 frontier。
- frontier 是可点击的下一步选择，视觉上必须比普通 clue 更像“待决策入口”。
- stopped 节点必须低优先级显示，但 Inspector 必须说明停止原因。
- 搜索结果必须保留 can say / cannot say，不允许只有摘要。
- Provider 失败时显示错误状态，不生成 mock 分支。

节点层级建议：

1. Seed node：用户选择的原始兴趣点。
2. Controller run：中控 LLM 拆任务。
3. Search agent：执行搜索、提取、审计。
4. Evidence clue：本轮发现。
5. Frontier / stopped：下一步选择或停止原因。

### Reasoning Island

Reasoning Island 是 Canvas 的轻量导航入口，借鉴 Dynamic Island 的闭合 / 展开手势，但语义必须服务于推理图谱。

必须遵守：

- 闭合态只显示当前节点、节点类型和图谱进度，不能变成第二个 Inspector。
- 展开态使用 backdrop blur，把用户注意力临时收束到导航选择。
- 节点列表必须体现层级缩进，让用户感知 claim、judgment、evidence、frontier 的不同深度。
- Trace 标签只用于回放 reasoning step，并复用现有 step 高亮逻辑。
- 点击节点或 trace 后应立即收起，让用户回到 Canvas。
- 关闭浮层不能改变选中节点、不能触发 Agent、不能新增节点。

视觉规则：

- 闭合 pill 固定在底部中央，尺寸小于输入栏，避免抢占主要操作。
- 展开面板高度受限，内部滚动，不能推动 Canvas 布局。
- 进度环表达当前节点在已展开图谱中的相对位置，不表达“任务完成度”。
- 运行中的 Agent 状态只用小圆点脉冲表达，不出现大面积动效。

## Accessibility

- 所有节点继续使用 button 语义。
- 视觉拖拽不能破坏点击选择。
- 颜色只表达状态，不作为唯一信息来源；Inspector 必须用文字解释状态。
- 文本必须保持可读对比度。

## Do Not

- 不把 Canvas 做回线性长页。
- 不把所有节点铺在同一平面。
- 不让 AI 自动展开整张图。
- 不在浏览器端暴露模型凭证。
- 不为了装饰加入与推理无关的图形元素。
