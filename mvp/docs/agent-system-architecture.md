# Agent 化系统架构记录

日期：2026-05-30

## 目标

把产品从“固定流程调用 LLM”升级为“可审计的 Agent Team”：

```text
Agent = 大模型 + 身份/任务指令 + 工具能力 + 状态/记忆 + 结构化输出 + 可观察轨迹 + 可交接/协作机制
```

当前实现不重写主链路，保留：

```text
RumorDetector -> FactChecker + SourceValidator -> ReportComposer
```

但每个 Agent 都必须有明确的 Agent Contract，并在执行态 UI 中展示它的身份、工具、记忆、边界和交接规则。

## 本轮代码落点

- `src/lib/agentConfigs.ts`
  - 新增 `AgentContract`、`AgentToolCapability`、`AgentMemoryContract`、`AgentUiTraceContract`。
  - `AGENT_CONFIGS` 每个 Agent 绑定一个 `contract`。
  - `systemPrompt` 自动拼接 Agent Contract，让模型知道自身身份、工具、记忆、交接边界和失败策略。
  - `buildAgentInput()` 把 runtime contract 放入 Agent 输入。

- `vite.config.ts`
  - `/api/agent/orchestrate` 与 `/api/agent/orchestrate-stream` 返回 `agentContract`。
  - SSE 的 `agent_start` 和 `agent_complete` 都带 Agent Contract。

- `src/components/v3/phases/mission/AgentCard.tsx`
  - Mission Control 大卡片展示 Agent 使命、工具、记忆写入。

- `src/components/v3/phases/MissionControlView.tsx`
  - 流式过程优先使用 `agentContract.uiTrace`，不再只靠硬编码过程文案。

- `src/components/v3/panels/AgentPanel.tsx`
  - Agent 面板从 `AGENT_CONTRACTS` 生成卡片，展示工具、边界、使命。

## 当前 Agent 角色

### RumorDetector

角色：声明分诊与谣言类型路由 Agent。

任务：

- 拆分可核查原子命题。
- 判断谣言类型。
- 识别语言风险和传播风险。
- 生成后续证据需求。

边界：

- 不直接判断真假。
- 不把语言风险等同于事实为假。
- 不补充没有证据的背景解释。

### FactChecker

角色：多源事实交叉验证 Agent。

任务：

- 生成支持和反驳 query。
- 调用 360 搜索等工具。
- 对比多源结果一致性。
- 输出事实状态、支持证据、反驳证据和证据缺口。

边界：

- 不把单一搜索摘要当作最终事实。
- 不把“未找到反证”当作“真实”。

### SourceValidator

角色：溯源与信源可靠性 Agent。

任务：

- 区分原始来源、媒体转述、聚合搜索和社交传播。
- 审计来源权威性、时效性、独立性和可追溯性。
- 承载递归证据搜索工具。

边界：

- 不自动无限展开 frontier。
- 不把聚合结果包装成原始出处。

### ReportComposer

角色：证据边界报告与闭环 Agent。

任务：

- 只基于前序 Agent 输出生成报告。
- 计算 FIRE 五维置信度。
- 生成公众表达和闭环动作建议。
- 写入可复用 Agent Memory。

边界：

- 不新增未经验证的事实。
- 证据不足时必须输出“未出结论”。

## Sherlock 对递归搜索的启发

来源：`sherlock-project/sherlock`。

Sherlock 的关键不是“搜索很多网站”，而是它把一次查询拆成了稳定的结构：

```text
seed identity
-> site manifest
-> per-site probe
-> per-site classifier
-> result status
-> export / notify
```

对我们有用的结构：

1. Manifest 驱动  
   Sherlock 用 `resources/data.json` 描述每个平台怎么查、URL 怎么构造、用什么规则判断命中。我们可以迁移成 `SearchSourceManifest`：每个搜索源、平台、知识库都有自己的 query 模板、可信度规则、超时规则。

2. 并行 fan-out  
   `sherlock.py` 先为所有 site 创建 future，再统一收集结果。我们可以在 FactChecker / SourceValidator 中采用同样模式：支持 query、反驳 query、权威来源 query、社交传播 query 并行发出，结果再汇总。

3. 明确结果状态  
   `result.py` 的 `QueryStatus` 包含 Claimed / Available / Unknown / Illegal / WAF。我们应该为证据搜索引入类似状态：

   ```text
   supported / contradicted / unverified / invalid_query / blocked / timeout
   ```

4. 站点级检测规则  
   Sherlock 的 `errorType` 包含 status_code、message、response_url。迁移到事实核查里，对应：

   ```text
   status_code -> 直接可验证来源
   message -> 页面文本命中
   response_url -> 溯源链路 / 跳转链路
   ```

5. 失败显式化  
   Sherlock 会记录 timeout、连接错误、WAF 等 context。我们的系统也必须把搜索失败、模型失败、来源不可达显示为状态，而不是补写解释。

## 递归搜索在本产品中的定位

递归搜索不是主流程里的独立大 Agent，而是 SourceValidator / Traceback 能力中的工具：

```text
selected canvas node
-> recursive_evidence_search tool
-> clues / frontier / stopped
-> user chooses next frontier
-> next round
```

保持三条规则：

- 只从用户选择的节点开始。
- 每次只展开一层。
- frontier 等用户选择，不自动继续。

## 下一步建议

1. 把 `recursive_evidence_search` 的返回状态扩展为 Sherlock 风格的 `status/context/query_time`。
2. 为 360、metaso、anysearch、普通 web search 建一个 `SearchSourceManifest`。
3. 把 FactChecker 的支持/反驳 query 变成并行 fan-out。
4. 把 Agent Memory 写入从结果态补到每个 Agent 完成事件。

## 参考

- Sherlock main search flow: https://github.com/sherlock-project/sherlock/blob/master/sherlock_project/sherlock.py
- Sherlock site manifest loader: https://github.com/sherlock-project/sherlock/blob/master/sherlock_project/sites.py
- Sherlock result status model: https://github.com/sherlock-project/sherlock/blob/master/sherlock_project/result.py
- Sherlock site manifest: https://github.com/sherlock-project/sherlock/blob/master/sherlock_project/resources/data.json
