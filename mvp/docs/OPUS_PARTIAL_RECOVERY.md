# Opus Partial Planning Recovery

> 来源：`/Users/mahaoxuan/.gemini/antigravity-cli/brain/b496847f-794c-404c-a4a7-1a4785de5000/.system_generated/logs/transcript.jsonl`
> 时间：2026-05-23 17:37 左右
> 状态：Opus 只完成了项目阅读，没有产出最终规划正文。

## 1. 这次半截工作的实际价值

Opus 没有写出 `Recursive Evidence Search` 的正式规划，但它的读取路径本身有参考价值：它先读项目状态和交接文档，再读设计规范和 UX 研究，之后进入状态层、数据层、LLM 接入层、Canvas 组件层和样式层。这说明下一步规划不应该从“新增一个搜索功能”开始，而应该把递归证据搜索嵌入现有 Agent Reasoning Canvas 架构。

换句话说，它已经帮我们确认了规划入口：

- `tasks/todo.md`：判断 v3-v6 已完成到哪里。
- `HANDOVER.md`：确认当前架构、真实 LLM 接入和已知技术债。
- `DESIGN.md`：确认 Flowith-inspired、层级 Canvas、用户主导展开、真实模型调用约束。
- `docs/MVP_V3_SPEC.md`：确认产品已经从 revealStage 线性流程转为用户点击节点后的自由探索。
- `docs/flowith-ux-analysis.md` 与 `docs/UIUX_RESEARCH.md`：确认 UX 借鉴对象和不能照搬自动展开。
- `src/store/reasoningStore.tsx`：确认状态机和动态节点写入方式。
- `src/data/reasoningCanvas.ts` 与 `src/data/demoCase.ts`：确认预置图谱和 demo 证据结构。
- `src/lib/agentExpansion.ts` 与 `vite.config.ts`：确认用户触发后的 LLM 调度和 fallback 位置。
- `src/components/v3/*`：确认现有 Canvas、Inspector、Trace、Dock 的真实交互入口。
- `src/styles.css`：确认视觉实现仍是最大集中面。

## 2. 从半截调研能推导出的项目现状

当前项目已经不是 v1/v2 的线性报告页，也不是简单白板 demo，而是一个 Flowith-inspired 的节点探索型 Agent Reasoning Canvas。

已完成能力包括：

- 三层问题空间先展开，之后等待用户选择节点。
- 用户点击节点后，Inspector 显示该节点的证据需求、可说/不可说和 Agent 调用入口。
- 用户选择能力后，前端会调用中控 LLM，并把子 Agent 结果接回 Canvas。
- 已有拖拽、聚焦、Trace、Conclusion Dock、右侧 Inspector 和 Flowith shell。
- `vite.config.ts` 已经包含真实 LLM 接入路径，不能再退回纯模拟。

所以 `Recursive Evidence Search` 的定位应是：

> 在用户选中的节点上，沿证据线索递归生长新的证据需求、候选证据、反证路径和推理许可节点；它不是全局自动搜索，也不是聊天答案。

## 3. 对下一步规划最有用的判断

### 3.1 不要新建孤立搜索页

递归搜索必须接入 Canvas 节点，而不是做成独立 Search 页面或聊天框。否则会破坏当前产品最核心的交互模型：用户在节点上选择下一步。

### 3.2 状态机要扩展，不要重写

`reasoningStore.tsx` 已经是当前动态节点、选择状态、展开状态的核心。下一步应该在这里增加递归搜索任务状态，例如：

- `recursiveSearchRuns`
- `expandedFromNodeId`
- `frontierQueue`
- `visitedEvidenceIds`
- `searchDepth`
- `budget`
- `status`

不应该另起一个全局搜索 store。

### 3.3 数据模型要补线索图谱

`reasoningCanvas.ts` 已有节点和边，但递归搜索需要补充“线索”概念：

- seed：用户选中的节点或自然语言追问。
- clue：从证据、网页、摘要、实体中提取的新线索。
- expansion：一次子 Agent 执行产生的局部扩展。
- provenance：每个新增节点从哪里来。
- permission：这条线索目前允许推出什么、禁止推出什么。

这比只增加 `candidate_evidence` 节点更重要。

### 3.4 API 边界应该是节点级，而不是全局级

现有 LLM 调用入口在 `vite.config.ts`，用户从 Inspector 发起请求。递归搜索 API 也应该保持这个形状：

```text
POST /api/agent/expand-node
POST /api/agent/recursive-search
```

请求里必须带：

- `nodeId`
- `claim`
- `question`
- `mode`
- `depth`
- `budget`
- `existingGraphSummary`

返回必须是可接回 Canvas 的结构化节点/边/trace，而不是一段自然语言答案。

### 3.5 UI 要显示“递归前沿”，不是显示搜索结果列表

Maigret 的价值不是 OSINT 用户名搜索，而是 `seed -> search -> extract -> dedupe -> score -> recurse` 的线索扩展过程。放到溯证 Agent 里，应该可视化为：

- 当前节点上的搜索种子。
- 已发现线索。
- 可继续递归的 frontier。
- 已停止的线索及停止原因。
- 用户选择“继续扩哪一个线索”。

这样才能符合用户对“像人脑一样从某一点继续发散”的要求。

## 4. 可直接交给后续规划的文件级方向

优先修改：

- `src/store/reasoningStore.tsx`：增加递归搜索任务状态和动作。
- `src/data/reasoningCanvas.ts`：增加 clue / search frontier / provenance 相关类型。
- `src/components/v3/NodeInspectorV3.tsx`：增加“从此节点递归搜索”的入口、深度和预算控制。
- `src/components/v3/ReasoningWorkspaceV3.tsx`：把递归搜索返回的新节点/边接入当前 Canvas。
- `src/components/v3/ReasoningCanvasV3.tsx`：显示 frontier 节点、递归层级、停止节点。
- `vite.config.ts`：增加或扩展节点级 API，确保真实 LLM 调用返回结构化 JSON。
- `docs/MVP_V3_SPEC.md`：补充 Recursive Evidence Search 的 BDD 验收。
- `DESIGN.md`：补充 frontier / clue / stopped / verified 等视觉 token。

暂时不要动：

- 不要恢复旧 `src/components/canvas/*` 流程组件。
- 不要把 `demoCase.ts` 改成复杂证据库。
- 不要把递归搜索做成全自动后台任务。
- 不要让 Report Composer 绕过 Grader 或证据许可直接总结。

## 5. 半截工作留下的缺口

Opus 没有完成这些关键部分，需要我们继续补：

- Recursive Evidence Search 的正式产品定义。
- 递归搜索数据结构。
- 递归搜索状态机。
- 前端节点类型和边类型。
- API 请求/响应契约。
- 5-8 条 BDD 验收行为。
- 分阶段实施计划。

因此这次半截工作不是完全白做，它至少帮我们确认：后续规划应该围绕当前 v3/v6 架构做增量扩展，而不是重写产品形态。

