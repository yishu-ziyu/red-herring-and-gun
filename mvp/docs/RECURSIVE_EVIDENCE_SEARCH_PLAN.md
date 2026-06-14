# Recursive Evidence Search v7 Plan

## 1. Opus 半截工作的参考价值

Opus 没有产出最终规划，但它的读取路径本身是有价值的。它没有从“新增搜索页”或“重做 UI”开始，而是依次读了项目交接、设计规范、V3 规格、Flowith UX、状态层、Canvas 数据、LLM 调用、V3 组件和样式。这说明下一步真正应该做的是：在现有 Flowith-inspired Agent Reasoning Canvas 上，补一个节点级递归证据搜索能力。

因此它的参考价值不是“可复制的文本”，而是三条方向判断：

1. 递归搜索必须嵌入当前 Canvas 节点体系，不能做成孤立搜索页。
2. 用户必须选择从哪个节点继续发散，不能让 AI 自主把整张图自动展开。
3. LLM / 子 Agent 的输出必须回到节点、边、Trace、Inspector 和 Evidence Permission，而不是只返回一段答案。

这和 Maigret 的递归搜索给我们的启发一致：搜索不是一次性查询，而是 `seed -> search -> extract -> normalize -> dedupe -> score -> frontier -> user chooses next seed` 的线索生长过程。

## 2. 对接下来开发的指导意义

当前项目已经完成 v6：Flowith 风格 shell、三层推理空间、节点拖拽、Inspector、真实 LLM 调用入口和动态节点回写。下一步不应该继续做静态视觉堆叠，而应该让 Canvas 具备真正的 Agent 工作流能力。

v7 的核心产品定义：

> 用户在任意节点上发起自然语言追问或递归证据搜索；中控 LLM 只负责调度和拆任务；子 Agent 负责搜索、提取、审计和生成局部节点；系统把结果以可继续选择的 frontier 回写到 Canvas。

关键约束：

- 只在用户点击节点并触发后调用真实模型。
- 默认只扩一层递归 frontier，不自动继续跑到底。
- 每次搜索必须显示来源、可说、不可说、停止原因和下一步可扩线索。
- Provider 失败时显示失败状态，不生成假节点。
- 前端可以模拟调度 UI，但不可再模拟 LLM 结果。
- 新能力必须复用 `reasoningStore.tsx`、`agentExpansion.ts`、`vite.config.ts` 和 V3 组件，不重开架构。

## 3. BDD 行为验收

### 行为 1：用户从节点发起递归搜索

Given Canvas 上已经存在推理节点  
When 用户点击任意节点  
Then Inspector 显示“递归证据搜索”入口、自然语言追问框、深度和预算控制。

业务规则：递归搜索必须是节点级能力，用户选择兴趣点后才出现。

### 行为 2：未触发前不调用 LLM

Given 用户只是浏览、拖拽或选择节点  
When 用户没有点击递归搜索按钮  
Then 页面不发起 `/api/agent/recursive-search` 请求，也不新增搜索节点。

业务规则：系统是用户主导的 Agent Canvas，不是自动扩散的信息流。

### 行为 3：搜索结果回写为节点和边

Given 用户在某节点输入追问并点击递归搜索  
When 真实 LLM 返回结构化搜索结果  
Then Canvas 在该节点附近新增 controller、search agent、evidence clue、frontier 和 stopped 节点，并用边连接来源关系。

业务规则：Agent 输出必须成为可探索图谱，而不是聊天答案。

### 行为 4：frontier 等待用户选择

Given 递归搜索发现多个可继续扩展的线索  
When 本轮搜索完成  
Then 系统只展示 frontier 节点，不自动继续搜索下一层；用户可以点击某个 frontier 再次触发搜索。

业务规则：递归搜索的控制权属于用户，AI 只提供可选路径。

### 行为 5：重复线索被去重

Given LLM 返回的线索与现有节点、来源或本轮线索重复  
When 系统写入 Canvas  
Then 重复线索不会生成重复节点，而是在 Inspector 中显示为“已合并 / 已存在”。

业务规则：递归搜索必须防止无边界膨胀和重复噪音。

### 行为 6：预算和深度会停止搜索

Given 用户设置了最大深度或预算  
When 搜索达到限制  
Then 系统生成 stopped 节点并说明停止原因，例如“达到本轮预算”或“可信度不足”。

业务规则：递归搜索必须有边界，不能变成失控后台任务。

### 行为 7：每条证据都有可说 / 不可说

Given 搜索返回候选证据或线索  
When 用户点击该证据节点  
Then Inspector 显示该证据能支持什么、不能支持什么、来源角色和审计细节。

业务规则：本项目的核心不是搜索更多，而是证据许可和推理边界。

### 行为 8：真实 Provider 失败不伪造结果

Given 本地 Codex / Anthropic proxy / OpenAI provider 都不可用或返回错误  
When 用户触发递归搜索  
Then Inspector 和 Trace 显示失败原因，Canvas 不生成模拟搜索结果。

业务规则：前端不能用 mock 结果冒充真实 Agent 能力。

## 4. 数据与 API 契约

### 前端请求

```ts
export interface RecursiveSearchRequest {
  claim: string;
  seedNode: {
    id: string;
    type: string;
    title: string;
    subtitle?: string;
    status?: string;
  };
  question: string;
  depthLimit: number;
  budgetLimit: number;
  visibleNodeTitles: string[];
  existingSources: string[];
}
```

### 后端响应

```ts
export interface RecursiveSearchResponse {
  controllerNote: string;
  runTitle: string;
  traceText: string;
  clues: EvidenceClue[];
  frontier: SearchFrontierItem[];
  stopped: SearchStoppedItem[];
  canSay: string[];
  cannotSay: string[];
  model: string;
}

export interface EvidenceClue {
  id: string;
  title: string;
  summary: string;
  source: string;
  role: "support" | "limit" | "counter" | "context" | "lead";
  confidence: "low" | "medium" | "high";
}

export interface SearchFrontierItem {
  id: string;
  title: string;
  reasonToContinue: string;
  nextQuestion: string;
  estimatedValue: "low" | "medium" | "high";
}

export interface SearchStoppedItem {
  id: string;
  title: string;
  reason: "duplicate" | "budget" | "low_confidence" | "out_of_scope";
}
```

API endpoint:

```text
POST /api/agent/recursive-search
```

Provider 顺序沿用当前项目约束：

1. OpenAI Responses API。
2. 本地 Anthropic-compatible proxy，例如 `http://127.0.0.1:18765`。
3. Codex CLI 本地执行。

## 5. 实施任务清单

### P0：规格和行为锁定

- 将本文档作为 v7 规格来源。
- 在 `docs/MVP_V3_SPEC.md` 增补 Recursive Evidence Search 行为。
- 在 `DESIGN.md` 增补 clue / frontier / stopped / recursive run 视觉 token。

### P1：类型和状态层

- 在 `src/lib/agentExpansion.ts` 增加递归搜索请求/响应类型和 `requestRecursiveSearch()`。
- 在 `src/store/reasoningStore.tsx` 增加 `recursiveSearchRuns`、`activeRecursiveRunId`、错误状态和动作。
- 保持动态节点仍通过现有 `ADD_NODES` 写入。

### P2：后端 API

- 在 `vite.config.ts` 增加 `/api/agent/recursive-search`。
- 复用当前 provider 调用工具，但使用新的 strict JSON schema。
- 明确失败时返回错误，不做 mock fallback。

### P3：Inspector 交互

- 在 `NodeInspectorV3.tsx` 增加递归搜索面板。
- 用户可输入追问、设置深度和预算。
- 点击 frontier 节点时，追问框自动带入该 frontier 的 `nextQuestion`。

### P4：Canvas 回写

- 在 `ReasoningWorkspaceV3.tsx` 增加递归搜索 submit handler。
- 把返回的 clues / frontier / stopped 转成 Canvas nodes / edges。
- 新节点围绕 seed node 分层布局，避免铺成同一平面。

### P5：视觉与探索体验

- 在 `ReasoningCanvasV3.tsx` 和 `SuzhengNode.tsx` 中区分 evidence clue、frontier、stopped、controller run。
- frontier 节点必须明显可继续点击。
- stopped 节点必须视觉上低优先级，但能解释停止原因。

### P6：验证

- 运行 `npm run build`。
- 用浏览器验证 `http://127.0.0.1:4173/`。
- 验证点击节点、触发递归搜索、失败状态、frontier 二次选择、拖拽和 Inspector 详情。

## 6. 非目标

- 不做真实无限画布缩放。
- 不做后台自动递归多层搜索。
- 不做独立搜索结果页。
- 不做多案例系统。
- 不把所有子 Agent UI 一次性做全。
- 不引入新的图数据库或重型状态库。

## 7. 成功标准

v7 完成后，用户应该能感知到：

1. 中央 Canvas 像思维网络一样继续生长。
2. 生长方向由用户选择，不由 AI 强行决定。
3. 每次生长都有真实模型参与。
4. 搜索结果不是答案，而是新的证据线索和可继续探索的 frontier。
5. 证据边界始终可见：能说什么、不能说什么、为什么停止。
