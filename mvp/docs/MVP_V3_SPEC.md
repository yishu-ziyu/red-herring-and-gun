# MVP v3 交互规格文档

> 基于 grill-me 18 项设计决策 + UI/UX 研究报告
> 目标：替换 v2 的线性 revealStage 流程，实现节点驱动的自由探索

---

## 一、核心交互模型

### 1.1 状态机（替换 revealStage）

```
[输入观点] → [诊断横幅] → [点击进入分析] → [完整画布可见]
                                              ↓
                    [用户点击节点] → [Inspector 更新] → [Agent 建议展开方向]
                                              ↓
                    [用户确认/修改方向] → [真实 LLM 调用] → [新节点接入画布]
```

关键变化：
- **不再有 Stage 1/2/3/4/5 的线性推进**
- **所有预置节点在"进入分析"后一次性可见**
- **用户自由点击任何节点，Inspector 同步更新**
- **Agent 展开只在用户明确选择节点并确认方向后触发**

### 1.2 聚焦模式（Focus Mode）

- 点击节点 → 默认选中（不进入聚焦）
- 双击节点 / 点击聚焦按钮 → 进入聚焦模式
- 聚焦模式效果：
  - 从该节点向上追溯到根节点的路径高亮
  - 路径上的边高亮（蓝色发光）
  - 不在路径上的节点 opacity 降至 0.25
  - 不在路径上的边 opacity 降至 0.08
- 按 ESC 或点击空白处退出聚焦

---

## 二、组件规格

### 2.1 App.tsx

```tsx
<ReasoningProvider>
  <AppContainer>
    {!analysisStarted ? <DiagnosisBanner /> : <ReasoningWorkspaceV3 />}
  </AppContainer>
</ReasoningProvider>
```

### 2.2 ReasoningWorkspaceV3

**布局**：沿用 grid 布局，但顶部区域简化

```
┌─────────────────────────────────────────────┐
│  [Rail] │  Top Bar (简化)                     │
├─────────┼──────────┬────────────┬───────────┤
│         │  Trace   │   Canvas   │ Inspector │
│         │  (左)    │   (中央)   │  (右)     │
├─────────┴──────────┴────────────┴───────────┤
│  Conclusion Dock (可折叠)                    │
└─────────────────────────────────────────────┘
```

**状态来源**：全部从 `useReasoning()` store 读取

**行为**：
- 初始化时调用 `dispatch({ type: "INIT_CASE", ... })` 加载 demo 数据
- 所有子组件通过 Context 读取状态，不再通过 props drilling

### 2.3 ReasoningCanvasV3

**Props**：无（全部从 store 读取）

**行为**：
- 读取 `state.nodes`, `state.edges`
- 读取 `state.selectedNodeId`, `state.isFocusMode`, `state.focusedNodeId`
- 计算聚焦路径：`selectFocusedPath(state)`
- 节点渲染时根据是否在聚焦路径上添加 `dimmed` / `focused` 类
- 边渲染时同理

**事件**：
- 节点单击 → `dispatch({ type: "SELECT_NODE", payload: { nodeId } })`
- 节点双击 → `dispatch({ type: "ENTER_FOCUS_MODE", payload: { nodeId } })`
- 空白处单击 → `dispatch({ type: "EXIT_FOCUS_MODE" })`
- 节点拖拽 → 更新位置 override（保持局部状态，不进入全局 store）

### 2.4 AgentTraceV3

**变化**：
- 移除 `revealStage` 过滤，所有 trace steps 始终可见
- 点击 step 时高亮相关节点 + 选中第一个节点
- 显示步骤序号和文字描述

### 2.5 NodeInspectorV3

**状态来源**：`selectSelectedNode(state)`, `selectLatestRunForNode(state)`

**Agent 展开面板（关键改进）**：

旧版：固定 4 个模式按钮（search / evidence_audit / counter / rewrite）

新版：**Agent 根据节点类型动态建议展开方向**

| 节点类型 | 建议方向 |
|---------|---------|
| claim / judgment / subclaim | "拆解子命题", "寻找反证", "证据审计" |
| evidence_need | "联网搜索", "评估现有材料" |
| candidate_evidence | "证据分级", "寻找更多材料" |
| inference_license | "生成改写", "回溯证据" |

**交互流程**：
1. 用户选择节点
2. Inspector 显示该节点的上下文信息
3. Agent 建议区域显示 2-3 个推荐操作
4. 用户点击推荐 → 自动填充 prompt → 点击确认
5. 或用户直接输入自定义 prompt → 选择模式 → 确认

### 2.6 节点状态指示改进（基于 UI/UX 研究）

**新视觉规则**：
- 状态色不再填充整个节点背景
- 改为：左侧 3px 竖条 + 右上角小圆点
- 节点背景统一使用低饱和度蓝色渐变

```css
.canvas-node {
  /* 统一背景，不随状态变化 */
  background: linear-gradient(135deg, rgba(43,110,203,0.5), rgba(79,153,222,0.4));
}

.canvas-node::before {
  /* 左侧状态条 */
  position: absolute;
  left: 0; top: 12px; bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: var(--status-color);
}
```

---

## 三、数据流

### 3.1 初始化流程

```
App 挂载
  → ReasoningProvider 创建 store
  → App 检查 !analysisStarted
  → 显示 DiagnosisBanner
  → 用户点击"进入分析"
  → App 设置 analysisStarted = true
  → ReasoningWorkspaceV3 挂载
  → 调用 runDemoPipeline() 获取数据
  → dispatch INIT_CASE
  → 画布渲染所有节点
```

### 3.2 节点选择流程

```
用户点击节点 N
  → CanvasNode onSelect
  → dispatch SELECT_NODE { nodeId: N.id }
  → store.selectedNodeId = N.id
  → NodeInspectorV3 重新渲染
  → Inspector 显示 N 的上下文
  → Agent 建议区域根据 N.type 生成建议
```

### 3.3 Agent 展开流程

```
用户选择节点 N
  → 点击 Agent 建议 S（或输入自定义 prompt）
  → dispatch START_EXPANDING
  → 调用 requestAgentExpansion({ node: N, mode: S.mode, prompt })
  → LLM 返回结果
  → buildNodeExpansion() 生成新节点/边/运行记录
  → dispatch ADD_NODES { nodes, edges, run, step }
  → 新节点出现在画布上
  → 新 step 出现在 Trace 中
  → dispatch FINISH_EXPANDING
```

---

## 四、与 v2 的删除清单

| 文件/代码 | 处理方式 | 理由 |
|----------|---------|------|
| `ReasoningWorkspace.tsx` | **删除** | 核心问题是 revealStage 线性流程 |
| `revealStage` state | **删除** | 违背自由探索原则 |
| `advanceReasoning()` | **删除** | 强制线性推进 |
| `guidedRevealLimit` | **删除** | 不再需要 |
| `canvasNodes[].revealStage` | **忽略** | v3 中所有节点默认可见 |
| `canvasEdges[].revealStage` | **忽略** | v3 中所有边默认可见 |
| `reasoningSteps[].revealStage` | **忽略** | v3 中所有 steps 始终可见 |
| 固定 4 种 expansion mode | **替换** | 改为节点类型动态建议 |
| `nodePositionOverrides` (局部) | **保留机制** | 但改为 useState 而非 props drill |

---

## 五、Recursive Evidence Search v7

### 5.1 产品定位

v7 不新增独立搜索页。递归证据搜索是节点级 Agent 能力：用户先在 Canvas 中选择一个兴趣节点，再输入自然语言追问或接受系统建议，随后中控 LLM 调度子 Agent 做一轮证据搜索、线索提取、去重和推理许可判断。

本轮结果必须回写到 Canvas：

- controller run：说明中控 LLM 如何拆任务。
- search agent：说明子 Agent 做了什么搜索或审计。
- evidence clue：新增候选证据或上下文线索。
- frontier：可继续扩展、但等待用户选择的下一批线索。
- stopped：由于重复、预算、低可信或越界而停止的线索。

### 5.2 BDD 行为

#### 行为 1：用户从节点发起递归搜索

Given Canvas 上已经存在推理节点  
When 用户点击任意节点  
Then Inspector 显示“递归证据搜索”入口、自然语言追问框、深度和预算控制。

业务规则：递归搜索必须是节点级能力，用户选择兴趣点后才出现。

#### 行为 2：未触发前不调用 LLM

Given 用户只是浏览、拖拽或选择节点  
When 用户没有点击递归搜索按钮  
Then 页面不发起 `/api/agent/recursive-search` 请求，也不新增搜索节点。

业务规则：系统是用户主导的 Agent Canvas，不是自动扩散的信息流。

#### 行为 3：搜索结果回写为节点和边

Given 用户在某节点输入追问并点击递归搜索  
When 真实 LLM 返回结构化搜索结果  
Then Canvas 在该节点附近新增 controller、search agent、evidence clue、frontier 和 stopped 节点，并用边连接来源关系。

业务规则：Agent 输出必须成为可探索图谱，而不是聊天答案。

#### 行为 4：frontier 等待用户选择

Given 递归搜索发现多个可继续扩展的线索  
When 本轮搜索完成  
Then 系统只展示 frontier 节点，不自动继续搜索下一层；用户可以点击某个 frontier 再次触发搜索。

业务规则：递归搜索的控制权属于用户，AI 只提供可选路径。

#### 行为 5：重复线索被去重

Given LLM 返回的线索与现有节点、来源或本轮线索重复  
When 系统写入 Canvas  
Then 重复线索不会生成重复节点，而是在 Inspector 中显示为“已合并 / 已存在”。

业务规则：递归搜索必须防止无边界膨胀和重复噪音。

#### 行为 6：预算和深度会停止搜索

Given 用户设置了最大深度或预算  
When 搜索达到限制  
Then 系统生成 stopped 节点并说明停止原因，例如“达到本轮预算”或“可信度不足”。

业务规则：递归搜索必须有边界，不能变成失控后台任务。

#### 行为 7：每条证据都有可说 / 不可说

Given 搜索返回候选证据或线索  
When 用户点击该证据节点  
Then Inspector 显示该证据能支持什么、不能支持什么、来源角色和审计细节。

业务规则：本项目的核心不是搜索更多，而是证据许可和推理边界。

#### 行为 8：真实 Provider 失败不伪造结果

Given 本地 Codex / Anthropic proxy / OpenAI provider 都不可用或返回错误  
When 用户触发递归搜索  
Then Inspector 和 Trace 显示失败原因，Canvas 不生成模拟搜索结果。

业务规则：前端不能用 mock 结果冒充真实 Agent 能力。

### 5.3 实现边界

- API：新增 `POST /api/agent/recursive-search`。
- 前端封装：在 `agentExpansion.ts` 增加 `requestRecursiveSearch()`。
- 状态层：在 `reasoningStore.tsx` 增加 recursive run 状态，仍通过现有 `ADD_NODES` 写入图谱。
- UI：在 `NodeInspectorV3.tsx` 增加递归搜索面板，在 `ReasoningWorkspaceV3.tsx` 处理提交和节点生成。
- 视觉：在 `ReasoningCanvasV3.tsx` / `SuzhengNode.tsx` / `styles.css` 区分 clue、frontier、stopped 和 controller run。

---

## 六、Reasoning Island Navigation v8

v8 将 Dynamic Island TOC 的交互模式转译为 Agent Canvas 的底部节点导航。它不是文章目录，也不触发新的模型调用；它只帮助用户在已经展开的 reasoning graph 中快速定位节点、trace 和当前探索进度。

### 6.1 交互目标

- 闭合态：底部中央显示当前选中节点、节点类型和图谱进度。
- 展开态：以 backdrop blur 聚焦导航面板，提供“节点 / Trace”两种索引。
- 节点索引：按节点层级缩进，点击后选中对应节点并同步 Inspector。
- Trace 索引：点击后复用现有 reasoning step 高亮逻辑，帮助用户回到某一步推理。
- 关闭方式：点击遮罩、关闭按钮或 ESC，不改变当前节点选择。

### 6.2 BDD 行为

#### 行为 1：闭合态显示当前节点

Given 用户进入 Canvas 并已有选中节点  
When Reasoning Island 处于闭合态  
Then 底部浮层显示当前节点标题、节点类型和进度环。

业务规则：导航入口必须轻量，不遮挡 Canvas 主体。

#### 行为 2：点击后展开节点导航

Given Reasoning Island 处于闭合态  
When 用户点击底部浮层  
Then 页面出现 backdrop blur，浮层展开为节点 / Trace 面板。

业务规则：用户需要主动打开索引，而不是被额外信息打断。

#### 行为 3：节点跳转同步 Inspector

Given 展开态显示节点列表  
When 用户点击“因果判断”等节点项  
Then Canvas 选中该节点，右侧 Inspector 显示该节点上下文，Reasoning Island 自动收起。

业务规则：Reasoning Island 是图谱导航，不是独立信息面板。

#### 行为 4：Trace 跳转复用 reasoning 高亮

Given 展开态切到 Trace 标签  
When 用户点击任一 reasoning step  
Then 系统调用现有 step 选择逻辑，高亮对应节点并收起浮层。

业务规则：Trace 和 Canvas 必须保持同一套选择状态。

#### 行为 5：关闭不改变推理状态

Given Reasoning Island 已展开  
When 用户点击遮罩、关闭按钮或按下 ESC  
Then 浮层收起，但当前选中节点、Trace 和 Agent 状态不变。

业务规则：导航组件不能产生隐藏副作用，也不能触发 LLM。

### 6.3 实现边界

- 不新增 `motion/react`、`lucide-react` 等依赖，使用 React 状态和 CSS transition 实现。
- 不扫描 DOM heading，直接读取 Canvas nodes 和 reasoning steps。
- 不调用 `/api/agent/expand` 或 `/api/agent/recursive-search`。
- 不替代 Canvas、Inspector、Trace，只提供跨层级导航入口。

---

## 七、保留清单

| 文件 | 保留理由 |
|------|---------|
| `styles.css` | 视觉系统成熟，只需微调状态色表达 |
| `CanvasNode.tsx` | 拖拽/点击逻辑完善 |
| `CanvasEdges.tsx` | SVG 路径渲染正确 |
| `layeredLayout.ts` | 节点位置计算正确 |
| `schemas.ts` | 类型定义是产品方法论基础 |
| `demoCase.ts` | Demo 数据资产 |
| `pipeline.ts` | Demo 数据生成 |
| `agentExpansion.ts` | LLM 调用封装 |
| `reasoningStore.ts` | v3 核心状态管理 |
| `DiagnosisBanner.tsx` | v3 新组件 |

---

## 八、视觉改进（基于 UI/UX 研究）

### 6.1 节点状态色克制化

- 移除 `.status-*` 对节点背景的强覆盖
- 状态只影响左侧竖条颜色和顶部小圆点
- 节点hover/selected 效果保持不变

### 6.2 聚焦模式视觉

```css
/* 非聚焦节点 */
.canvas-node.dimmed { opacity: 0.25; filter: grayscale(0.6); }

/* 聚焦路径节点 */
.canvas-node.focused {
  box-shadow: 0 0 0 2px rgba(239,228,93,0.3), 0 20px 42px rgba(0,0,0,0.5);
}

/* 非聚焦边 */
.canvas-edges path.dimmed { stroke-opacity: 0.06; }

/* 聚焦边 */
.canvas-edges path.focused {
  stroke: rgba(121,185,255,0.7);
  stroke-width: 0.4;
  filter: drop-shadow(0 0 2px rgba(121,185,255,0.3));
}
```

### 6.3 Inspector 标题缩小

- `h2` 从 24px 降至 18px
- 增加字重保持可读性

---

## 九、验收标准

### 功能验收

- [x] 进入分析后，所有预置节点一次性可见
- [x] 点击任意节点，Inspector 同步显示该节点信息
- [x] 双击节点进入聚焦模式，路径高亮，其他淡化
- [x] ESC 退出聚焦模式
- [x] 节点选择后，Agent 建议区域显示上下文相关建议
- [x] 点击建议或输入自定义 prompt，可触发真实 LLM 调用
- [x] LLM 返回后，新节点出现在画布上，新 step 出现在 Trace
- [x] 拖拽节点改变位置，重置后恢复
- [ ] 用户可从任意节点触发递归证据搜索
- [ ] 递归搜索结果生成 clue / frontier / stopped 节点
- [ ] frontier 节点等待用户二次选择，不自动继续展开
- [ ] Provider 失败时显示错误，不生成模拟结果
- [x] 底部 Reasoning Island 闭合态显示当前节点和进度
- [x] Reasoning Island 展开态提供节点 / Trace 双索引
- [x] 点击节点索引会同步 Canvas 选中态和 Inspector
- [x] Reasoning Island 关闭不触发 LLM 或新增节点

### 视觉验收

- [x] 节点状态色不再覆盖整个背景，改为左侧竖条
- [x] 聚焦模式下视觉层次清晰
- [x] 整体风格与 DESIGN.md v0.3 一致
- [x] Reasoning Island 采用底部浮层、backdrop blur、层级缩进和进度环表达

---

*规格版本：v3.0*
*日期：2026-05-21*
