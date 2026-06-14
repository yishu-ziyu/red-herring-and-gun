# 溯证 Agent — 项目交接文档

> 面向 Codex / 后续开发者的完整技术交接。阅读时间约 15 分钟。

---

## 一、项目概述

**溯证 Agent**（Contextual Verifiable Decomposition Agent）是一个"语境化可核查分解"的交互式推理画布。用户输入一个观点，系统将其拆解为可核查的子命题网络，并通过节点级 Agent 调用来帮助用户逐步审计每个判断的证据强度。

**核心交互模型**：
```
[Dashboard 输入观点] → [ReasoningWorkspaceV3 画布]
                                ↓
              [用户点击节点] → [Inspector 显示详情]
                                ↓
              [选择展开方向] → [真实 LLM 调用] → [新节点接入画布]
```

**当前版本**：v3（已废弃 v1/v2 的 revealStage 线性流程，改为自由探索）
**用途**：黑客松 Demo / MVP

---

## 二、技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6（含自定义 dev server plugin） |
| 画布引擎 | `@xyflow/react` v12（React Flow） |
| 状态管理 | React Context + useReducer（无 Redux/Zustand） |
| 样式 | 纯 CSS（`src/styles.css`，无 Tailwind/Styled） |
| 后端 | Vite dev server inline plugin（`vite.config.ts`） |
| LLM 调用 | OpenAI Responses API → Codex CLI → Anthropic Proxy |

---

## 三、目录结构

```
mvp/
├── src/
│   ├── App.tsx                          # 根组件：Dashboard ↔ Workspace 切换
│   ├── main.tsx                         # 入口
│   ├── styles.css                       # 全部样式（~1000 行）
│   ├── vite-env.d.ts
│   │
│   ├── components/
│   │   ├── v3/                          # ★ 当前活跃版本（全部组件在此）
│   │   │   ├── Dashboard.tsx            # 首页：品牌 + 输入框 + Demo 卡片
│   │   │   ├── ReasoningWorkspaceV3.tsx # 主工作台：侧边栏 + 画布 + Inspector
│   │   │   ├── ReasoningCanvasV3.tsx    # React Flow 画布封装
│   │   │   ├── SuzhengNode.tsx          # 自定义节点渲染组件
│   │   │   ├── AgentTraceV3.tsx         # 左侧推理 trace 面板
│   │   │   ├── NodeInspectorV3.tsx      # 右侧节点详情 + Agent 展开面板
│   │   │   ├── ConclusionDockV3.tsx     # 底部结论 dock
│   │   │   ├── DiagnosisBanner.tsx      # （未使用，保留）
│   │   │   └── panels/                  # 左侧 rail 切换的面板
│   │   │       ├── AgentPanel.tsx       # 占位
│   │   │       ├── KnowledgePanel.tsx   # 占位
│   │   │       └── SettingsPanel.tsx    # 占位（主题/模型选择）
│   │   │
│   │   └── canvas/                      # 画布底层（v3 复用）
│   │       ├── layeredLayout.ts         # 4 层布局算法（source/encoder/decoder/result）
│   │       ├── CanvasNode.tsx           # （旧版，未使用）
│   │       ├── CanvasEdges.tsx          # （旧版，未使用）
│   │       └── ...                      # 其他旧版组件
│   │
│   ├── data/
│   │   ├── reasoningCanvas.ts           # CanvasNode/Edge/Step 类型 + Demo 数据
│   │   └── demoCase.ts                  # Demo 案例完整数据（断言/子命题/证据/路由）
│   │
│   ├── lib/
│   │   ├── agentExpansion.ts            # 前端调用 /api/agent/expand 的封装
│   │   ├── pipeline.ts                  # Demo 数据管道（gradeAll → composeReport）
│   │   ├── graderRules.ts               # 证据评分规则（ relevance / methodFit / role / usage ）
│   │   ├── reportComposer.ts            # 最终报告生成器
│   │   └── schemas.ts                   # 全部 TypeScript 类型定义
│   │
│   └── store/
│       └── reasoningStore.tsx           # 全局状态管理（Context + Reducer）
│
├── vite.config.ts                       # ★ Vite 配置 + 内联 dev server API
├── .env.local.example                   # 环境变量模板
├── DESIGN.md                            # 设计系统文档（颜色/字体/组件规则）
├── docs/
│   ├── MVP_V3_SPEC.md                   # v3 交互规格（含验收标准）
│   ├── flowith-ux-analysis.md           # Flowith UX 研究
│   └── UIUX_RESEARCH.md                 # UI/UX 研究报告
├── package.json
└── index.html
```

---

## 四、核心架构详解

### 4.1 前端状态管理（`store/reasoningStore.tsx`）

使用 React Context + useReducer，**不引入外部状态库**。

**State Shape**：
```typescript
interface ReasoningState {
  diagnosis: ClaimDiagnosis | null;      // 断言诊断
  originalClaim: string;                  // 原始观点
  nodes: CanvasNode[];                    // 画布节点树
  edges: CanvasEdge[];                    // 边
  expandedNodeIds: Set<string>;           // 已展开节点（v3 未充分使用）
  selectedNodeId: string | null;          // 当前选中节点
  focusedNodeId: string | null;           // 聚焦模式目标
  isFocusMode: boolean;                   // 是否聚焦模式
  agentRuns: AgentRun[];                  // Agent 调用历史
  isExpanding: boolean;                   // 是否正在调用 LLM
  agentError: string;                     // 错误信息
  expansionPrompt: string;                // 展开输入框内容
  expansionMode: ExpansionMode;           // 展开模式
  traceSteps: ReasoningStep[];            // 左侧 trace 步骤
  activeStepId: string | null;            // 当前活跃 trace
  report: FinalReport | null;             // 最终报告
  exploredSubclaimCount: number;          // 已探索计数
  totalSubclaimCount: number;             // 总子命题数
  comments: NodeComment[];                // 节点评论（LocalStorage 持久化）
  followUps: FollowUpEntry[];             // 追加输入历史（LocalStorage 持久化）
}
```

**关键 Actions**：
| Action | 触发时机 |
|---|---|
| `INIT_CASE` | App/Workspace 挂载时，加载 Demo 数据 |
| `SELECT_NODE` | 点击画布节点 |
| `ENTER_FOCUS_MODE` / `EXIT_FOCUS_MODE` | 双击节点 / 点击空白 / ESC |
| `ADD_NODES` | LLM 返回后，新节点接入画布 |
| `START_EXPANDING` / `FINISH_EXPANDING` | Agent 调用开始/结束 |
| `RESET` | 重置画布（保留评论） |

**Selectors**（纯函数派生状态）：
- `selectFocusedPath(state)` — BFS 向上追溯聚焦路径
- `selectLatestRunForNode(state, nodeId)` — 某节点的最近一次 Agent 调用
- `selectConclusionProgress(state)` — 探索进度百分比

### 4.2 画布系统

**坐标系统**：百分比坐标（0-100），在 `ReasoningCanvasV3` 中转换为像素：
```typescript
const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 900;
// pct → pixel: (pct / 100) * dimension
```

**4 层布局**（`layeredLayout.ts`）：
| 层 | Y 坐标 | 节点类型 |
|---|---|---|
| source | 12% | claim（中心观点） |
| encoder | 30% | judgment / subclaim（判断层） |
| decoder | 54% | evidence_need / inference_license（证据需求） |
| result | 80% | candidate_evidence / rewrite / agent_task（结果层） |

**拖拽持久化**：拖拽后通过 `onNodeMove` 回调将百分比坐标写入 `nodePositionOverrides`（React 局部 state，非 store），重置时清空。

**聚焦模式**：
- 双击节点 → BFS 向上追溯父节点 → 路径上的节点/边高亮，其他淡化（opacity 0.25）
- 按 ESC 或点击空白处退出

### 4.3 节点类型与视觉

**节点类型**（`CanvasNodeType`）：
```typescript
type CanvasNodeType =
  | "claim"        // 中心观点（白色卡片）
  | "judgment"     // 判断节点
  | "subclaim"     // 子命题
  | "evidence_need"    // 证据需求
  | "candidate_evidence" // 候选证据
  | "agent_task"   // Agent 任务（用户触发后生成）
  | "inference_license"  // 推理许可
  | "rewrite";     // 降强度改写
```

**状态色**（`CanvasNodeStatus`）：`risk` | `active` | `supported` | `limited` | `blocked` | `rewrite` | `clue` | `frontier` | `stopped` | `controller`

**视觉表达**（v3 简化版）：
- 节点背景统一为白色卡片（`background: #fff`）
- 状态通过**左侧 3px 竖条** + **右上角小圆点**表达
- 层级通过 `layer-*` CSS 类区分左侧竖条颜色（蓝/绿/橙）

### 4.4 LLM 调用链（`vite.config.ts`）

**API 端点**：

- `POST /api/agent/expand`
- `POST /api/agent/recursive-search`

**调用流程**（`agentApiPlugin`）：
```
requestAgentExpansion() → POST /api/agent/expand
    ↓
vite.config.ts handler()
    ↓
apiKey 存在？
    ├── 是 → callOpenAI() → OpenAI Responses API
    └── 否 → callLocalProvider()
                 ↓
            1. callAnthropicProxy() → ~/.claude/settings.json 中的本地代理（优先）
            2. callLocalCodex() → Codex CLI exec（回退）
	                 ↓
	            任一成功 → normalizeExpansionResult()
	            全部失败 → 502 错误，不生成 mock 分支
```

**请求 Payload**（`AgentExpansionRequest`）：
```typescript
{
  claim: string;           // 原始观点
  node: { id, type, title, subtitle, status }; // 当前选中节点
  mode: "search" | "evidence_audit" | "counter" | "rewrite";
  prompt: string;          // 用户输入/选择的 prompt
  visibleNodeTitles: string[]; // 当前画布上所有节点标题（给 LLM 上下文）
}
```

**返回 Schema**（严格 JSON Schema）：
```typescript
{
  controllerNote: string;  // 中控为什么选择这个方向
  agentTitle: string;      // 子 Agent 名称
  agentSubtitle: string;   // 子 Agent 职责
  resultTitle: string;     // 结果节点标题
  resultSubtitle: string;  // 结果节点副标题
  resultStatus: "risk" | "active" | "supported" | "limited" | "blocked" | "rewrite";
  traceText: string;       // Trace 中显示的一句话
  inspectorSummary: string; // Inspector 总结
  canSay: string[];        // 当前节点允许表达
  cannotSay: string[];     // 当前节点禁止表达
  sources: string[];       // 来源
}
```

**OpenAI 调用细节**：
- 使用 OpenAI Responses API（非 Chat Completions）
- `text.format.type = "json_schema"`，strict mode
- search 模式附加 `tools: [{ type: "web_search" }]`
- max_output_tokens: 900

**递归搜索调用细节**：
- `requestRecursiveSearch()` 调用 `/api/agent/recursive-search`
- 返回 `clues`、`frontier`、`stopped`、`canSay`、`cannotSay`
- `frontier` 只作为用户下一步选择，不自动继续展开
- 本地 provider 优先走 `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`，当前可使用 `http://127.0.0.1:18765`

**Codex CLI 调用细节**：
- 命令：`codex exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules -s read-only -C <cwd> -m <model> --output-schema <schema.json> -o <output.json> <prompt>`
- 临时目录写入 schema 和 output 文件
- 超时：180s（可配 `CODEX_LOCAL_TIMEOUT_MS`）

### 4.5 节点展开算法（`ReasoningWorkspaceV3.tsx` 中的 `buildNodeExpansion`）

用户触发展开后，系统生成 3 个新节点 + 3 条边：

```
[原节点] ──"用户触发"──→ [中控 LLM] ──"派单"──→ [子 Agent] ──"局部结果"──→ [结果节点]
```

- 方向：根据原节点 x 坐标决定向左/右展开（`dir = x > 70 ? -1 : 1`）
- 位置：基于原节点位置计算偏移， clamp 到 8%-92%
- 结果节点类型：`rewrite` → rewrite，`search` → candidate_evidence，其他 → evidence_need

---

## 五、关键文件速查

### 5.1 类型定义（`lib/schemas.ts`）

这是产品的**方法论基础**。所有类型名都用中文语义命名：

- `ClaimType` — 断言类型（概念/数量事实/机制/因果/反证...）
- `ClaimDiagnosis` — 断言诊断（混合判断/模糊术语/风险）
- `Subclaim` — 子命题
- `EvidenceRoute` — 证据路由（需要什么/不能用什么/最低输出规则）
- `CandidateMaterial` — 候选材料（来源类型/匹配需求/限制）
- `GradedEvidence` — 评分后的证据（ relevance / methodFit / role / usage ）
- `FinalReport` — 最终报告（允许结论/禁止推断/改写版本）

### 5.2 Demo 数据（`data/demoCase.ts`）

**案例**："AI 导致初级内容岗位减少"

结构：
- `originalClaim` — 原始观点
- `diagnosis` — 诊断结果（混合了数量事实/机制/因果）
- `subclaims` — 5 个子命题（C1-C5：概念/数量/机制/因果/反证）
- `routes` — 每个子命题的证据路由
- `searchPlans` — 搜索计划（含 querySets）
- `candidates` — 5 份候选材料（E1-E5：论文/数据/案例/评论/报告）

### 5.3 评分规则（`lib/graderRules.ts`）

`gradeCandidate(candidate, subclaim)` 的评分逻辑：

1. `scoreRelevance()` — 相关度（候选材料是否匹配子命题）
2. `scoreMethodFit()` — 方法适配度（材料类型是否适合子命题类型）
3. `roleFor()` — 证据角色（支持/反驳/限定/背景/线索/不可用）
4. `usageFor()` — 使用级别（主证据/辅助证据/背景材料/仅作线索/不可用/反证）
5. `allowed()` / `blocked()` — 允许和禁止的推断

### 5.4 报告生成器（`lib/reportComposer.ts`）

`composeReport(caseData, grades)`：
- 遍历每个子命题，调用 `statusFor()` 判定状态
- 因果类子命题默认返回"证据不足"
- 组装 `FinalReport`（含 cautious/publicFacing/researchMemo 三版改写）

---

## 六、页面路由与组件层级

```
App.tsx
├── ReasoningProvider
│   └── AppContent
│       ├── analysisStarted === false
│       │   └── Dashboard                    # 首页
│       │       ├── 品牌区 + 中央输入框
│       │       ├── 模型选择器（GPT-4 / Claude）
│       │       └── Demo 卡片（点击直接进入）
│       │
│       └── analysisStarted === true
│           └── ReasoningWorkspaceV3         # 工作台
│               ├── Flow Rail（左侧工具栏）
│               ├── Top Bar（品牌 + 中心观点 + 状态）
│               ├── Workspace Grid（3 列）
│               │   ├── AgentTraceV3（左）
│               │   ├── ReasoningCanvasV3（中）
│               │   │   └── ReactFlow
│               │   │       └── SuzhengNode（自定义节点）
│               │   └── NodeInspectorV3（右）
│               │       └── NodeExpansionPanelV3（Agent 展开面板）
│               ├── FloatingInputBar（底部悬浮输入）
│               └── ConclusionDockV3（底部结论）
```

---

## 七、开发指南

### 7.1 环境配置

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（可选）
cp .env.local.example .env.local
# 编辑 .env.local：
# - 有 OPENAI_API_KEY → 走 OpenAI Responses API（最优先）
# - 无 OPENAI_API_KEY → 优先走 ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 本地代理
# - 本地代理不可用 → 回退 Codex CLI

# 3. 启动开发服务器
npm run dev
# 默认 http://127.0.0.1:5173
```

### 7.2 添加新的展开模式

1. 在 `lib/agentExpansion.ts` 的 `ExpansionMode` 中添加新类型
2. 在 `vite.config.ts` 的 `modeInstruction` 对象中添加 prompt 指令
3. 在 `ReasoningWorkspaceV3.tsx` 的 `expansionModeMeta` 中添加元数据
4. 在 `NodeInspectorV3.tsx` 的 `getSuggestionsForNodeType()` 中调整建议
5. 在 `buildNodeExpansion()` 中调整新节点生成逻辑

### 7.3 修改节点视觉

样式集中在 `styles.css`：
- `.canvas-node` — 节点基础样式
- `.node-{type}` — 按类型微调
- `.status-{status}` — 状态指示（左侧竖条 + 右上角圆点）
- `.layer-{encoder|decoder|result}` — 层级左侧竖条颜色

### 7.4 添加 Demo 案例

在 `Dashboard.tsx` 的 `DEMO_CASES` 数组中添加新卡片：
```typescript
{
  id: "your-case-id",
  title: "案例标题",
  description: "案例描述",
  tags: ["因果", "数量事实"],
}
```

然后需要在 `data/demoCase.ts` 中准备对应的 caseData（或使用动态生成）。

---

## 八、已知问题与待办

### 8.1 当前状态（已完成）

- [x] Dashboard 首页（品牌 + 输入 + Demo 卡片）
- [x] 左侧 Flow Rail 导航（canvas/agent/knowledge/settings）
- [x] 底部悬浮输入栏（FloatingInputBar）
- [x] 节点样式简化（白色卡片 + 左侧竖条 + 右上角圆点）
- [x] 聚焦模式（双击节点高亮路径）
- [x] 空画布启动（非 Demo 模式只显示根节点）
- [x] LLM 调用链（OpenAI → Codex CLI → Anthropic Proxy → Demo Fallback）
- [x] Codex CLI 本地测试优先

### 8.2 待办事项（P0-P2）

**P0 — 功能完善**：
- [ ] **画布缩放/平移优化**：当前 fitView 在节点增多后可能拥挤，需调整 fitView padding 或支持手动缩放重置
- [ ] **节点碰撞避免**：新增节点可能与已有节点重叠（`buildNodeExpansion` 的位置计算是启发式的）
- [ ] **Agent 展开后的自动选中**：新节点接入后是否自动选中新结果节点？

**P1 — 体验优化**：
- [ ] **左侧 Agent/Knowledge/Settings 面板内容**：当前是占位符，需要填充真实功能
- [ ] **Inspector 动态建议更智能**：当前基于节点类型的硬编码建议，可考虑让 LLM 生成建议
- [ ] **Trace 点击后画布聚焦**：点击 trace step 时，画布应自动聚焦到对应节点
- [ ] **评论系统 UI**：评论数据已持久化到 LocalStorage，但缺少 UI 展示

**P2 — 扩展**：
- [ ] **多案例切换**：当前只有一个 Demo 案例，需要支持多个案例的切换
- [ ] **导出功能**：导出画布为图片 / PDF / Markdown 报告
- [ ] **历史记录**：保存和加载推理历史
- [ ] **真实 LLM 的 streaming 响应**：当前是整段返回，可改为流式展示 Agent trace

### 8.3 技术债务

1. **旧版组件未清理**：`components/canvas/` 下的 `AgentTrace.tsx`、`CanvasNode.tsx`、`CanvasEdges.tsx`、`ConclusionDock.tsx`、`NodeInspector.tsx`、`ReasoningCanvas.tsx`、`ReasoningWorkspace.tsx` 是 v1/v2 遗留，可安全删除
2. **TypeScript 严格性**：部分文件有 `any` 类型（如 `vite.config.ts` 中的 req/res）
3. **styles.css 过大**：所有样式集中在一个文件，超过 800 行，可按组件拆分
4. **Design.md 与实际样式不同步**：DESIGN.md v0.3 描述的是深色主题/2.5D 节点，实际已实现为白色卡片浅色主题

---

## 九、快速上手：修改示例

### 示例 1：调整节点默认展开位置

编辑 `ReasoningWorkspaceV3.tsx` 中 `buildNodeExpansion()` 的坐标偏移：
```typescript
const dir = node.x > 70 ? -1 : 1;     // 展开方向（左/右）
const upperY = node.y > 72 ? -30 : -14; // 中控节点纵向偏移
// 调整这些数值可改变新节点生成位置
```

### 示例 2：修改 LLM System Prompt

编辑 `vite.config.ts` 中 `callOpenAI()` 的 `systemPrompt` 数组或 `callAnthropicProxy()` 的 prompt。

### 示例 3：添加新节点类型

1. `data/reasoningCanvas.ts`：`CanvasNodeType` 添加新类型
2. `styles.css`：`.node-{新类型}` 添加样式
3. `SuzhengNode.tsx`：`labelForType()` 添加标签
4. `layeredLayout.ts`：`inferLayer()` 添加层级判断
5. `NodeInspectorV3.tsx`：`renderBody()` 添加 Inspector 内容

---

## 十、联系与资源

- **设计系统**：`DESIGN.md`
- **交互规格**：`docs/MVP_V3_SPEC.md`
- **UX 研究**：`docs/flowith-ux-analysis.md`、`docs/UIUX_RESEARCH.md`
- **项目路径**：`/Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp/`

---

*文档版本：v1.0 | 交接日期：2026-05-22*
*如有疑问，优先查阅 `docs/MVP_V3_SPEC.md` 和 `DESIGN.md`*
