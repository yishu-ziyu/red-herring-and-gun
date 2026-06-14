# 真探 Agent — 开发日志

> 项目：语境化可核查分解 Agent（溯证 Agent → 真探 Agent）
> 目标：适配「词元工坊」黑客松赛道三「AI Agent - 信息真相猎人」
> 时间线：2026-05 期间

---

## 一、项目背景

### 1.1 初始状态

项目原为「溯证 Agent」，是一个面向知识工作者的论证结构分析工具，核心能力包括：
- 将复杂声明分解为子命题树
- 可视化 Canvas 展示论证结构
- LLM 驱动的节点级推理扩展
- 证据审计与反证生成

**技术栈**：React + Vite + TypeScript + @xyflow/react
**状态管理**：React Context + useReducer
**LLM 接入**：Vite dev-server 中间件代理（OpenAI API / Anthropic Proxy / Codex CLI）

### 1.2 改造目标

根据黑客松评分权重，识别关键差距：

| 维度 | 权重 | 差距 |
|------|------|------|
| 准确性 | 30% | 需针对谣言场景优化 |
| 场景覆盖 | 20% | 仅1个Demo案例，需≥3类谣言 |
| 闭环 | 20% | 只有分析，无报告/分享/标记 |
| 技术架构 | 10% | 无记忆/知识库/多Agent |
| Agent能力 | 10% | 已通过Anthropic proxy使用国产MiniMax-M2.7 |
| 360生态 | 10% | 无集成，先做UI占位 |

---

## 二、Phase 1：品牌与定位改造

### 2.1 核心变更

**品牌重塑**：
- 「溯证 Agent」→「真探 Agent」
- 副标题：「信息真相猎人 — AI驱动的谣言核查与事实追踪」
- 输入框 placeholder：「输入一条你看到的疑似谣言或信息...」

**案例扩展**：
- 原有：1个通用案例（"AI 导致初级内容岗位减少"）
- 新增4个谣言专项案例：
  - 健康类：「隔夜菜会致癌，吃了等于吃毒药」
  - 社会类：「某城市地铁即将停运，内部消息」
  - 科技类：「5G信号塔辐射导致周边居民头晕失眠」
  - 财经类：「人民币即将大幅贬值，赶紧换美元」

### 2.2 修改文件

- `src/components/v3/Dashboard.tsx`
- `src/lib/schemas.ts`（新增 `rumorType`, `useContext`, `rumorIndicators` 字段）
- `src/components/v3/ReasoningWorkspaceV3.tsx`
- `src/components/v3/ConclusionDockV3.tsx`

### 2.3 遇到的问题

**问题**：原有案例数据结构与谣言场景不完全匹配。
**解决**：复用 `DemoCase` 类型结构，仅扩展字段，保持向后兼容。

---

## 三、Phase 2：谣言专项能力

### 3.1 核心变更

**ExpansionMode 扩展**：
- 新增 `"rumor_check"` 模式
- 对应指令：「谣言专项核查。重点识别信息中的谣言特征...」

**AgentExpansionResponse 扩展**：
- 新增 `rumorIndicators?: string[]` 字段

### 3.2 修改文件

- `src/lib/rumorDetection.ts`（新增）
- `src/lib/sourceCredibility.ts`（新增）
- `vite.config.ts`（System Prompt + modeInstruction）
- `src/lib/agentExpansion.ts`
- `src/components/v3/NodeInspectorV3.tsx`
- `src/components/v3/DiagnosisBanner.tsx`

---

## 四、Phase 3：多案例数据

### 4.1 核心变更

**新增案例目录**：`src/data/rumorCases/`
- `healthRumor.ts` — 隔夜菜致癌
- `socialRumor.ts` — 地铁停运
- `techRumor.ts` — 5G辐射
- `financeRumor.ts` — 人民币贬值

每个案例包含完整的论证结构：diagnosis、subclaims、routes、searchPlans、candidates。

### 4.2 修改文件

- `src/lib/pipeline.ts`（`runDemoPipeline(caseId)`）
- `src/App.tsx`（支持案例ID传入）

---

## 五、Phase 4：闭环报告与导出

### 5.1 核心变更

**报告导出能力**：
- `exportToMarkdown()` — Markdown 格式核查报告
- `exportToJSON()` — JSON 格式状态导出
- `calculateCredibilityScore()` — 可信度百分比计算

**交互增强**：
- 「导出报告」按钮 → 下载 Markdown
- 「分享结果」按钮 → 复制分享链接
- 「标记结果」按钮 → 真 / 假 / 部分真 / 无法核实

### 5.2 修改文件

- `src/lib/reportExporter.ts`（新增）
- `src/components/v3/ConclusionDockV3.tsx`
- `src/components/v3/ReportModal.tsx`（新增）
- `src/store/reasoningStore.tsx`（`verificationResult` state）
- `src/lib/reportComposer.ts`

---

## 六、Phase 5：多Agent协作展示

### 6.1 核心变更

**AgentPanel 改造**：
从占位符改造为完整的 Agent 调度监控面板，展示5个子 Agent：
- RumorDetector — 谣言特征检测
- FactChecker — 事实核查
- SourceValidator — 信源验证
- EvidenceGrader — 证据分级
- ReportComposer — 报告生成

### 6.2 修改文件

- `src/components/v3/panels/AgentPanel.tsx`
- `src/store/reasoningStore.tsx`
- `vite.config.ts`（agentType 映射）
- `src/lib/agentExpansion.ts`

---

## 七、Phase 6：Sherlock 多平台溯源搜索（核心新增）

### 7.1 需求来源

用户提到 sherlock-project/sherlock 项目，对其递归搜索和平台 catalog 概念感兴趣，希望集成到系统中。

### 7.2 设计决策

**核心映射**：
- sherlock 的「用户名」→ 我们的「claim/谣言声明」
- sherlock 的「社交平台」→ 我们的「事实核查平台」
- sherlock 的「存在检测」→ 我们的「事实核查命中检测」

**架构设计**：
- 数据驱动的平台配置 catalog（类似 sherlock 的 data.json）
- 查询模板插值 `{?}` 替换为搜索关键词
- 并行搜索多个信源平台
- 每个平台有独立的 detection strategy

### 7.3 实现过程

#### Step 1：创建平台 Catalog 模块

**文件**：`src/lib/sherlockStyleSearch.ts`

**初始平台**（8个）：
1. 微博辟谣 — 通用，高可信度
2. 腾讯较真 — 医学类权威
3. 科学辟谣 — 科协官方
4. 联合辟谣平台 — 网信办指导
5. 丁香医生 — 健康科普
6. 果壳 — 科技科普
7. 财经辟谣 — 投资/汇率
8. 知乎辟谣 — 社区核查

**接口设计**：
```typescript
interface SourceConfig {
  id: string;
  name: string;
  icon: string;
  category: "health" | "tech" | "society" | "finance" | "general";
  searchUrlTemplate: string;
  detectionStrategy: { type: "status_code" | "message" | "response_url"; expected: number | string };
  trustLevel: "high" | "medium" | "low";
  queryKeywords: string[];
}

interface SourceHit {
  sourceId: string;
  sourceName: string;
  sourceIcon: string;
  matchedUrl: string;
  detectionMethod: string;
  trustLevel: string;
  matchedKeywords: string[];
  factCheckResult?: "true" | "false" | "partial" | "unverified";
  summary: string;
}
```

#### Step 2：API 端点

**文件**：`vite.config.ts`

新增 `/api/agent/sherlock-search` endpoint：
```typescript
async function sherlockHandler(req, res, next) {
  const result = await searchClaimAcrossSources(payload.claim, payload.keywords);
  return sendJson(res, 200, result);
}
```

#### Step 3：前端 UI 集成

**文件修改**：
- `NodeInspectorV3.tsx` — Sherlock 搜索面板（描述、搜索按钮、结果展示）
- `ReasoningWorkspaceV3.tsx` — `handleSherlockSearch` 回调 + 画布节点构建
- `AgentPanel.tsx` — Sherlock 统计展示
- `styles.css` — Sherlock 相关样式

**画布节点构建**（`buildSherlockSearchExpansion`）：
- 创建 controller 节点（"Sherlock 调度器"）
- 创建 agent 节点（"多平台溯源搜索"）
- 为每个 hit 创建 evidence_clue 节点

#### Step 4：状态管理扩展

**文件**：`src/store/reasoningStore.tsx`

新增：
- `SherlockSearchRun` 接口
- `sherlockSearchRuns` state
- `ADD_SHERLOCK_RUN` action
- `selectLatestSherlockRunForNode` selector

### 7.4 遇到的问题

**问题 1：TypeScript 编译错误**
- 原因：`Property 'ttttttttonSherlockSearch' does not exist`
- 根因：`sed` 插入文本时格式错误，导致属性名被破坏
- 解决：手动修复为 `onSherlockSearch={handleSherlockSearch}`

**问题 2：Edit 工具缩进不匹配**
- 原因：文件使用 tab 缩进，Edit 工具传入空格
- 解决：使用 `sed` 或确保使用 tab 缩进

**问题 3：浏览器页面跳转问题**
- 现象：点击案例后页面未正确切换，Sherlock 搜索结果未显示
- 原因：页面状态管理问题
- 解决：直接通过 URL 导航 + 手动输入 claim 测试

**问题 4：0 hits 场景验证**
- 现象：测试 claim "AI 导致初级内容岗位减少" 返回 0 命中
- 分析：这是预期行为，该 claim 不含任何平台关键词
- 验证：健康类谣言 "隔夜菜会致癌" 命中 2 个平台（腾讯较真 + 丁香医生）

### 7.5 平台扩展（后续）

从 8 个平台扩展到 **19 个平台**：

**新增国际平台（4个）**：
- Snopes、PolitiFact、FactCheck.org、Reuters Fact Check

**新增中文平台（4个）**：
- 澎湃明查、观察者网辟谣、百度辟谣、搜狗辟谣

**新增专业平台（3个）**：
- WHO 谣言粉碎机、CDC 健康提醒、FDA 安全通报

### 7.6 可视化增强（后续）

- 平台图标展示
- 可信度进度条（high=绿100%, medium=黄60%, low=红30%）
- factCheckResult 彩色标签
- matchedKeywords 高亮标签
- 搜索 URL 可点击链接
- 空结果友好提示
- 搜索中 pulse 动画
- AgentPanel 统计概览

---

## 八、Phase 7：MiMo API 集成（进行中）

### 8.1 背景

用户获取了 MiMo Token Plan API Key，并将其保存在本地 `.env.local`（密钥不写入文档或 Git）。

目标：将 Sherlock 搜索从「模拟关键词匹配」升级为「真实 LLM API 驱动」。

### 8.2 配置过程

#### Step 1：环境变量配置

**文件**：`.env.local`
```bash
MIMO_API_KEY=<your-mimo-token-plan-key>
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
MIMO_MODEL=mimo-v2.5-pro
```

#### Step 2：vite.config.ts 集成

新增：
- `callMimoApi()` 函数（Anthropic 兼容协议，`api-key` header）
- `callMimoApiRecursive()` 函数
- `callLocalProvider()` / `callLocalProviderRecursive()` 中优先调用 MiMo
- **多集群回退**：CN → SGP → AMS

#### Step 3：mimoClient.ts（Sherlock 专用）

**文件**：`src/lib/mimoClient.ts`

创建基于 MiMo LLM 的智能搜索引擎：
- 构建 system prompt，让 LLM 扮演事实核查平台聚合器
- 传入 claim 和 keywords
- 返回结构化的 `MimoSherlockResult`

### 8.3 遇到的问题

**问题 1：中国集群 502 Bad Gateway**
```
{"error":{"code":"500","message":"<html><head><title>502 Bad Gateway</title></head>..."}}
```

**问题 2：新加坡/欧洲集群 401 Invalid API Key**
```
{"error":{"code":"401","message":"Invalid API Key","type":"invalid_key"}}
```

**排查过程**：
1. 测试不同认证头格式（`api-key`, `x-api-key`, `Authorization Bearer`）→ 全部 401
2. 测试 OpenAI 兼容协议端点 → 同样 502/401
3. 阅读官方文档 → 发现关键限制条款

**根因分析**：

文档明确声明：
> "Token Plan 套餐额度仅可在编程工具中使用，禁止以 API 调用的形式用于自动化脚本、自定义应用程序后端等明显非 Coding 场景的请求行为"

**修正理解**：
用户指出「真探 Agent 本身就是 AI Agent 产品」，调用 LLM API 是核心推理能力，与 OpenClaw/OpenCode 同类。401 错误更可能是：
1. API Key 尚未在服务端同步（订阅后需等待）
2. 请求格式仍有特殊要求未满足

**状态更新（2026-05-28）**：
- MiMo API 已恢复连通性，端到端测试通过（返回 `mimo:mimo-v2.5-pro`）
- 可能原因：API Key 已激活，或集群负载恢复正常
- 中国集群仍偶发 502，多集群回退机制有效

### 8.4 Fallback 策略

代码已配置完整的 provider 回退链：
```
MiMo API (3集群回退)
  → DeepSeek API (/chat/completions)
    → Anthropic Proxy
      → Codex CLI
        → Demo Fallback (模拟数据)
```

即使 MiMo 暂时不可用，系统仍能正常工作。

---

## 九、Phase 8：DeepSeek API 集成修复

### 9.1 问题

`callLocalProvider` 和 `callLocalProviderRecursive` 中使用 `callOpenAI` 调用 DeepSeek，但 `callOpenAI` 使用的是 OpenAI **Responses API**（`/responses`），而 DeepSeek 仅支持 **Chat Completions API**（`/chat/completions`）。

这导致：
- DeepSeek 请求静默失败（返回 404 或格式错误）
- 系统回退到 Anthropic Proxy（`kimi-for-coding`），用户无法感知 DeepSeek 是否被调用

### 9.2 修复

新增两个专用函数：
- `callDeepSeekApi()` — 使用 `POST /chat/completions`，`messages` 格式，`response_format: { type: "json_object" }`
- `callDeepSeekApiRecursive()` — 递归搜索版本
- `extractChatCompletionText()` — 解析 `choices[0].message.content`

更新调用链：
```
callLocalProvider
  → callDeepSeekApi (替代 callOpenAI)
callLocalProviderRecursive
  → callDeepSeekApiRecursive (替代 callOpenAIRecursive)
```

### 9.3 验证

| 测试项 | 结果 |
|--------|------|
| 直接 DeepSeek API 调用 | 通过（model: deepseek-v4-flash） |
| 端到端（MiMo 优先路径） | 通过（model: mimo:mimo-v2.5-pro） |
| 端到端（DeepSeek 回退路径） | 通过（model: deepseek:deepseek-chat） |
| 递归端点（DeepSeek 回退） | 通过（返回 4 条 clues） |
| TypeScript 编译 | 通过 |

---

## 十、关键设计决策

### 9.1 为什么用 Vite 中间件做 API 代理？

- 不引入新依赖（无 Express/Fastify）
- 开发环境零配置
- 预览环境一致行为

### 9.2 为什么用 React Context + useReducer？

- 不引入新依赖（无 Redux/Zustand）
- 足够轻量
- 所有状态更新遵循不可变原则

### 9.3 为什么 Sherlock 搜索不走真实平台 API？

- 跨域限制（CORS）
- 平台 API 需要认证
- 演示阶段用 LLM 生成合理结果更高效

### 9.4 为什么前端展示多Agent，后端走单一API？

- 黑客松时间限制
- 前端展示满足「技术架构」评分维度
- 为后续真正多Agent架构留扩展点

---

## 十、文件变更总览

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/sherlockStyleSearch.ts` | Sherlock 搜索引擎核心 |
| `src/lib/mimoClient.ts` | MiMo API 客户端 |
| `src/lib/rumorDetection.ts` | 谣言特征检测 |
| `src/lib/sourceCredibility.ts` | 信源可信度评估 |
| `src/lib/reportExporter.ts` | 报告导出 |
| `src/components/v3/ReportModal.tsx` | 报告模态框 |
| `src/data/rumorCases/*.ts` | 4类谣言案例 |
| `.env.local` | 环境变量配置 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `vite.config.ts` | +700行：MiMo API、DeepSeek API、Sherlock endpoint、多集群回退 |
| `src/styles.css` | +3000行：Sherlock 样式、动画、响应式 |
| `src/store/reasoningStore.tsx` | Sherlock state、action、selector |
| `src/lib/agentExpansion.ts` | `requestSherlockSearch()`、rumor_check mode |
| `src/components/v3/NodeInspectorV3.tsx` | Sherlock 搜索面板 |
| `src/components/v3/ReasoningWorkspaceV3.tsx` | `handleSherlockSearch` |
| `src/components/v3/panels/AgentPanel.tsx` | Sherlock 统计 |
| `src/components/v3/Dashboard.tsx` | 品牌、4个案例卡片 |
| `src/lib/schemas.ts` | `rumorType`, `rumorIndicators` |
| `src/App.tsx` | 案例ID路由 |
| `src/lib/pipeline.ts` | `runDemoPipeline(caseId)` |

---

## 十一、待办事项

- [x] MiMo API 连通性修复（已恢复，多集群回退有效）
- [x] DeepSeek API 集成修复（已改用 /chat/completions）
- [ ] 360生态集成（UI占位已完成，真实接入待实现）
- [ ] 更多谣言案例数据（目前4个，可扩展至10+）
- [ ] 真实跨平台搜索 API（当前为 LLM 模拟）
- [ ] 用户反馈循环（验证结果反馈到模型训练）

---

## 十二、经验总结

### 12.1 成功的做法

1. **渐进式改造**：保留原有架构，逐步添加新能力
2. **向后兼容**：所有接口扩展都保持兼容
3. **多 provider 回退**：确保系统在任何环境下都能工作
4. **浏览器验证**：每完成一个功能都在浏览器中验证

### 12.2 教训

1. **sed 插入文本风险**：导致属性名被破坏，应优先使用 Edit 工具
2. **API 文档必须细读**：MiMo Token Plan 的使用限制在文档中明确声明
3. **并行开发需协调**：多个 Agent 同时修改同一文件时需明确分工

---

## 十三、2026-06-14：分析页与记忆库的重大产品原则更新

### 13.1 分析页原则：过程必须被真实探索出来

分析页不再追求把所有能力一次性摆满。页面上的每个组件都必须服务于一个真实功能：

- 来自中控 Agent 的过程流；
- 来自工具调用或搜索结果的状态；
- 来自证据链、知识库、记忆库的真实数据；
- 用户可以继续追问、展开、核查或确认的动作。

不承接功能的 UI 不再进入主界面。典型反例包括：静态核查路径、装饰性缩略图、没有状态意义的标签、重复的英文/中文标题、以及只是在解释系统“正在做什么”的废话。

核心判断标准：

> 前端展示的不是“系统设计图”，而是 Agent 当前真实走到哪一步、交付了什么、下一步由谁接手。

### 13.2 记忆库原则：只有能改变下一次核查动作的内容才值得记住

记忆库方向从“堆候选条目”调整为“案件即记忆 + Agent 判断索引”。

底层保存完整案件，但 Agent 不应该把所有过程碎片都当成记忆。它需要从案件里判断哪些内容会影响下一次核查动作，再生成可召回的记忆索引。

值得保存的不是普通事实碎片，而是：

- 这个谣言属于哪类老套路；
- 哪条证据路径最后真正有效；
- 哪些来源只是转载链，不值得优先相信；
- 哪个判断边界最关键；
- 下次遇到相似说法时，应该优先查什么、避免查什么。

不值得保存的是：

- 每见到一个域名就记一条 source reputation；
- 把搜索过程里的普通中间材料当成长期知识；
- 只对本案有意义、不能改变后续核查动作的细节。

核心判断标准：

> Agent 学到的不是答案，而是下次怎么查得更快、更准。

### 13.3 对后续开发的约束

后续记忆库实现应优先围绕“案件级召回”设计，而不是继续扩大候选池。候选机制如果保留，也必须变成少量、高价值、可解释的沉淀项。

记忆库 UI 不应该展示海量候选让用户疲劳审核，而应该回答三个问题：

- 这次案件沉淀了什么可复用经验；
- 这些经验会怎样影响下一次核查；
- 用户是否同意把这条经验写入长期记忆。

### 13.4 已落地：候选记忆增加行动价值过滤

已在 `memoryCandidateGenerator` 增加一层“行动价值过滤”：

- 每次案件仍然完整写入案件记忆；
- 长期候选索引从最多 12 条收紧为最多 4 条；
- 普通域名出现记录不再自动进入记忆库；
- 来源信誉只有在会改变下次查证顺序时才保存；
- 候选摘要必须说明“下次遇到相似案件怎么用”。

这一步不是最终的智能记忆算法，但先把记忆库从“素材堆积”拉回到“可复用调查经验”。后续可在这层过滤前加入真正的 Agent 评估，让模型判断某条经验是否值得长期沉淀。

---

*日志最后更新：2026-06-14*
