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

---

## 十四、2026-06-14：Agent Loop 调研与迭代式核查方向

### 14.1 背景

黑客松赛题三（信息真相猎人）的评分权重中，「准确性」占 30% 且标注为「核心技术门槛」。当前实现是固定 3-phase pipeline，所有案例走同一条路径，不做质量回退。

比赛期间曾考虑加入「低置信度重查」机制，但未落地。本次调研重新梳理了这个问题。

### 14.2 调研范围

调研了两条线：
- 业界 Agent 编排的五种模式（固定管线 / 迭代式循环 / 动态路由 / 并发竞争 / 人机协作）
- Claude Code 和 Codex CLI 的 agent loop 实现机制与设计哲学

### 14.3 当前管线结构

```
用户输入 → Vision预处理(可选) → RumorDetector(串行) → 360 Search
                                              ↓
                   FactChecker ∥ SourceValidator → Debate调解 → ReportComposer → 输出
```

核心是：固定顺序 + Phase 2 条件性并发。 Debate 调解是唯一的动态逻辑（当两个 Agent 输出冲突时自动生成辩论回合）。

### 14.4 `credibilityScore` 的发现

调研中发现一个事实：`credibilityScore`（0-100）**不是公式算出来的**。

查看 `agentConfigs.ts` 第 329-365 行，`report_composer` 的 system prompt 给出了五档评分参考（80-100 可信 / 60-79 基本可信 / 40-59 部分可信 / 20-39 高度可疑 / 0-19 疑似谣言），但代码层面没有任何加权公式或计算逻辑。分数是 LLM 综合前面三个 Agent 的输出后「估」出来的。

**影响**：同一 claim 两次运行可能打出不同分数，没有 deterministic 保证。黑客松 demo 阶段可接受，产品化时需补。

### 14.5 当时未解决的问题

比赛时有一个想法：当置信度低时，系统自动补充检索再跑一轮。但没有想清楚两件事：

**问题 1：重跑哪些 phase？**

全部重跑成本最高但最稳妥。只重跑 FactChecker 成本低但可能不够（RumorDetector 的检测结果可能已经偏了）。这个取舍需要实测数据来判断。

**问题 2：界面怎么体现？**

这是更大的困惑。如果系统自动进入第二轮，前端应该展示什么？

- 方案 A：静默重跑，用户只看到 loading 时间变长，最终结果置信度提高
- 方案 B：在 Agent Trace 面板里显示「第一轮置信度不足，正在补充检索…」，让用户看到过程
- 方案 C：给用户一个选择——「当前可信度较低，是否补充检索？」

方案 C 最诚实，但引入了一个决策点，与产品定位「自动核查」有张力。方案 B 是折中，但 Trace 面板的用户心智是「看过程」，不是「看为什么需要重跑」。

这个界面问题在比赛时没有答案。

### 14.6 调研结论与下一步

调研中的关键发现：

1. **迭代式 loop 的生产级风险**：业界已有 $23,000/4小时的真实事故。缓解手段是五层终止架构（步数上限 / token 预算 / 成本预算 / 收敛检测 / 硬超时）。

2. **Claude Code 的 token budget 机制值得参考**：不是硬中断，而是在达到 90% 预算时向模型发一条 nudge 消息，让模型自己决定是否收尾。

3. **不建议全系统改循环**：80% 的谣言核查案例走固定直线最快也最可靠。全循环是过度工程。

**推荐方向**（条件性重查，非全循环）：

```
Phase 3 输出 credibilityScore
  ├── ≥ 60 → complete（约 70% 案例走这条，零额外成本）
  └── < 60 且未超重跑上限 → 补充搜索 → 第二 provider 重跑 → 再判断
        └── 第二轮仍 < 60 → 标记"存疑" → complete
```

改动范围：仅 `orchestrateStreamHandler` 末尾加一个 `if/else` 分支，不碰前面任何 phase。

**界面问题仍未解决**：迭代式 loop 的触发、过程和结果展示需要单独的 UX 设计，不能简单复用现有 Trace 面板。

### 14.7 大佬观点摘录

| 人物 | 核心观点 |
|------|---------|
| Boris Cherny（Claude Code 创建者） | "我不再 prompt Claude 了。我有正在运行的循环，它们才是我 prompt 的东西。我的工作是写循环。" |
| Simon Willison | "LLM agent 是为了达成目标而循环调用工具的东西。用好它的关键在于精心设计工具和循环。" |
| Addy Osmani | "Loop engineering 是用系统替代你自己去 prompt agent。" |
| Karpathy | 2025 年 12 月是 "agentic 拐点"——模型突然变得足够可靠，可以长期自主运行。 |

### 14.8 待办

- [ ] 实现条件性重查（Phase 3 后加 `if score < 60` 分支）
- [ ] 第二 provider 选型（与第一轮不同的 provider，避免模型盲区）
- [ ] 迭代式 loop 的界面设计（独立于 Trace 面板的新方案）
- [ ] `credibilityScore` 公式化（产品化前补加权计算，消除不可复现性）

---

### 14.9 调研来源

**Agent 编排模式：**
- Google Cloud — [Choose a design pattern for your agentic AI system](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) (2026-05)
- Build5Nines — [6 Multi-Agent Orchestration Design Patterns](https://build5nines.com/6-multi-agent-orchestration-design-patterns-every-developer-should-know/) (2026-05)
- Microsoft Agent Framework — [Orchestration Patterns](https://microsoft-agent-framework.mintlify.app/workflows/orchestration)

**Agent Loop 实现机制：**
- OpenAI — [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) (2026-01-23)
- OpenAI — [Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex) (2026-02)
- Anthropic — [Claude Code Agent SDK: Agent Loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)（官方文档）
- huangserva/claude-code-cli — 社区反编译 TypeScript 源码（query.ts 1729 行）

**大佬观点：**
- Karpathy — [Sequoia Ascent 2026 演讲](https://karpathy.bearblog.dev/sequoia-ascent-2026/)（Software 3.0 / Autonomy Slider）
- Simon Willison — [Designing agentic loops](https://simonwillison.net/2025/Sep/30/designing-agentic-loops/) (2025-09-30)
- Addy Osmani — [Loop Engineering](https://addys.me/blog/loop-engineering) (2026-06-08)
- Boris Cherny — Acquired Unplugged 访谈 (2026-06-02)（"我写循环，它们 prompt Claude"）

**可信度评分方法论：**
- PolitiFact — Truth-O-Meter 六档评分体系（TRUE → MOSTLY TRUE → HALF TRUE → MOSTLY FALSE → FALSE → PANTS ON FIRE）
- baiyishr/truthcheck — GitHub 开源项目，TruthScore 0-100，四维等权 25%
- **MAFC 论文**（最相关）：*"Multi-agent systems and credibility-based advanced scoring mechanism in fact-checking"*，京都大学，**Scientific Reports (Nature 旗下) 2026年3月** [PMC13066471](https://pmc.ncbi.nlm.nih.gov/articles/PMC13066471/)
  - 多 Agent 加权聚合 + log₂ 收敛因子
  - 实验：二分类 79% 准确率（SelfCheckGPT 72%），多标签 97%（SelfCheckGPT 57%）
- Boonsanong et al. — [FACTS&EVIDENCE (NAACL 2025)](https://arxiv.org/html/2602.18693) — 双视角检索验证
- Dempster-Shafer 证据理论 — [多源信息融合综述](https://www.mdpi.com/1099-4300/21/6/611)（重型方案，不推荐直接采用）
- SURE-RAG — [arXiv 2605.03534](https://arxiv.org/html/2605.03534) — 证据充分性集合级框架
- themmoonlight.io — [多模态事实核查三组分置信度公式](https://themmoonlight.io/blog/multimodal-fact-checking-confidence)（α·Intrinsic + β·External + γ·Coherence）

**自我修正 Loop 设计：**
- Tian Pan — [The Self-Correction Loop That Shared Its Verifier's Blind Spot](https://tianpan.co/blog/2026-06-02-the-self-correction-loop-that-shared-its-verifiers-blind-spot) (2026-06-02)
  - 同一模型做生成+审查有 64.5% 概率漏掉自己的错误
- CallSphere — [Self-Correcting Agents: Reflexion, CRITIC, and ReAct Loops Compared](https://callsphere.ai/blog/self-correcting-agents-reflexion-critic-react-loops-compared-2026) (2026-04)

**真实事故：**
- AI Engineering — [The Agent that spent $23,000 in four hours](https://aisysdesign.substack.com/p/updated-the-agent-that-spent-23000-ab1) (2026-06)
- Waxell — [The Hidden Cost of AI Agents](https://waxell.ai/blog/control-ai-agent-costs)
- PolicyLayer — [Runaway Tool Loops](https://policylayer.com/attacks/runaway-tool-loops)

---

## 2026-06-14 下午：红鲱鱼与枪全面审查与修复

**背景：** 黑客松项目优化日。发起 5 条并行审查线 + 1 条执行线（Git 整理），后续通过 Workflow 完成 4 Phase 优化。

### Git 版本锁定

- `feat/detective-clue-network` squash merge 到 `main`（200 files, 66,062 lines）
- `git tag v1.0.0` — 项目第一个稳定可部署版本
- 开发线保留未删除
- `.agent-memory/` `.agent-swarm/` `.superpowers/` 加入 `.gitignore`
- 根 `.gitignore` 补充 `dist-a/` `dist-b/` `/.DS_Store`

### 5 条审查线（并行 Agent）

| # | 审查线 | 结论 |
|---|--------|------|
| 1 | Git 分支现状 | 4 个分支，feat/detective-clue-network 是主力，建议 squash merge |
| 2 | Demo 案例验证 | 6 个内置案例全部完整，「隔夜菜会致癌」主推，「AI 导致初级内容岗位减少」备播 |
| 3 | 失败路径审查 | 8 处问题：P0 的 Promise.all 无 allSettled、sourceCondenser 静默 catch；P1 的 tool-error 包装、MiMo 模拟数据无标记 |
| 4 | 路演叙事统一 | 5 处冲突，输出 `docs/narrative-unity.md`（SSOT 文档） |
| 5 | Can-say 边界审查 | 核心问题：reportComposerSchema 无 canSay/cannotSay 字段，三条报告路径互不打通 |

### 代码修改（4 个 commit 推送至 origin/main）

**Commit 07601fe — Can-say 边界修复**
- `agentConfigs.ts`：`ReportComposerOutput` interface + `reportComposerSchema` 各加 `canSay`/`cannotSay` 字段，加入 `required`
- `ReasoningWorkspaceV3.tsx`：`handoffResult` 传递 `canSay`/`cannotSay`/`scoreBreakdown`
- `ConclusionDockV3.tsx`：结论下方新增「可以说 / 不能说」双栏面板 + 可信度分解条（factCheck/search/source 三信号可视化）
- `styles.css`：新增 `.boundary-panel` `.score-breakdown` `.breakdown-bar-*`

**Commit 90020cb — 失败路径修复**
- `search360.ts`：`Promise.all` → `Promise.allSettled`，新增 `buildSearchFailure()` 降级辅助函数（traceText 可见失败原因）
- `sourceCondenser.ts`：静默 catch → `console.warn` 记录失败原因
- `handlers.ts`：两处「失败静默」注释修正 + 两处 credibilityScore catch 静默降级 → `console.warn`

**Commit c9667b5 — ScoreBreakdown 可视化 + 叙事统一**
- `ReasoningWorkspaceV3.tsx`：通过 `_scoreBreakdown` 把公式计算的维度数据传给前端
- `ConclusionDockV3.tsx`：分数分解条（三信号条形图，正绿负红）
- `docs/narrative-unity.md`：路演叙事口径统一文档（SSOT），登记 5 处冲突
- `handlers.ts`：静默降级 catch 全部改为 log warning

**Commit 18b7de0 — 部署脚本**
- `deploy-to-aliyun.sh`：一键部署脚本（SSH → git pull → docker compose rebuild → 验证）

### credibilityScore 公式化状态

- 确定性公式 `credibilityScore.ts` 已完成（218 行，四维加权 + log₂ 收敛 + 谣言惩罚 + 缺失门控）
- `handlers.ts` 已用公式覆盖 LLM 估算分数
- 新增前端可视化：scoreBreakdown 条（factCheckSignal / searchSignal / sourceSignal）
- 测试套件 7 个场景全通过

### 已知未闭环

| 项目 | 状态 |
|------|------|
| 阿里云后端同步 | 待手动跑 `bash deploy-to-aliyun.sh` |
| Demo 端到端验证 | 待在实际环境验证「隔夜菜」案例 |
| MiMo 模拟数据 isSimulated 标记 | P2，计划中 |
| credibilityScore 反转逻辑 UI 标注 | P2，计划中 |
| unverified verdict UI 降级 | P2，计划中 |

### 部署架构备忘

```
本地 Mac → git push → GitHub → Vercel（前端自动部署）
                                    ↓ /api/* proxy
                              阿里云 121.89.90.68（Docker, 需手动 deploy-to-aliyun.sh）
```

*日志最后更新：2026-06-14 20:50*

## 2026-07-04 v3 强推迭代: 证据呈现净化 + BYO key + 邮箱登录 + 隐私合规基线

### 用户反馈 (起点)
> "现在这些证据呈现和陈列的方式都非常糟糕"

证据边界卡片泄露了 `Exa Search 调用失败: credits limit` 等基础设施错误;某些 demo 跑题到完全不相关的命题。

### Wave 1 — 数据 + UI 净化 (P0)
- 新增 `mvp/src/lib/sanitizeReport.ts`: INFRA_PATTERNS 11 条正则(quota/credits/调用失败/超时/Exception/emoji/URL 等),纯函数封装 `{allowed, blocked, warnings, drops}`。
- `mvp/src/lib/pipeline.ts`: 加 bigramJaccard + assertRelevantCase(短文本<10 字不拦,空 subclaims 不拦,阈值 0.2);runDemoPipeline 加 opts.claim 参数,跑题时返回 `{caseData: null, error: 'NO_MATCHING_CASE'}`。用 TypeScript overloads 不破坏现有调用方。
- `mvp/src/components/v3/NodeInspectorV3.tsx`: evidence_clue 节点用 sanitizeReport 处理 cannotSay,warnings 在 `<details>` 里折叠。
- 测试: 13 个 sanitize + 10 个 pipeline。

### Wave 2 — BYO Key 设置页 (P1)
- 新增 `mvp/src/components/v3/settings/ApiKeySettings.tsx`: baseUrl + apiKey + modelName 三字段,测试连接按钮,保存到 localStorage。
- 新增 endpoint `POST /api/agent/test-llm`: https-only,reject loopback IPs in prod,5s AbortController timeout,**永不 log apiKey**。
- Dashboard 挂载「设置 → 模型服务商」入口。

### Wave 3 — 邮箱登录 + 隐私 (P1)
- 新增 `mvp/server/src/lib/accountStore.ts`: in-memory store,emailHash 作为 Map key(SHA-256),6 位验证码,1 分钟 rate-limit,5/30 天 quota。
- 新增 6 个 endpoints: `/api/auth/email/{request,verify,me,logout}` + `/api/account/{export}` (DELETE/GET)。
- 新增 `LoginView.tsx` (邮箱 → 验证码 两步表单) + `PrivacyPolicy.tsx` (服务条款 + 隐私政策 + 导出/删除)。
- 验证码通过 `console.log [v3-auth]` 输出(生产环境接 SMTP)。

### Wave 4 — 部署 + 修复
- `decodeSignedJson` 在 secret 为空字符串时返回 null (false condition: `!secret`),改为 `if (!token) return null` 信任 HMAC 校验。
- 部署到 gun.yishuziyu.cn 全链路 HTTPS 验证通过:
  - `/api/agent/test-llm` 拒绝非 https baseUrl
  - 邮箱 → 验证码 → cookie → /me (返回 authenticated:true, quota:{remaining:5,total:5}) → /export (返回完整账户 JSON) → DELETE (账户已删除)

### 已知未闭环

| 项目 | 状态 |
|------|------|
| 真邮件发送 (SMTP) | 计划中,当前 console.log |
| 微信登录 | 用户决定暂不接入 |
| 微信支付/支付宝 | 用户决定下一阶段 |
| accountStore 数据持久化 | 当前 in-memory,重启会丢 |
| ApiKeySettings 视觉样式 | 后续 polish |

## 2026-07-05 v4 UI 改造: 全产品 Cinema Motion + 杂志质感重做

### 用户决策
- **动效**: 叙事 / 电影感
- **调性**: 杂志质感 (出版级排版)
- **范围**: 全产品总升级
- **架构**: 抽取 design tokens

### Design Tokens 抽取 (commit e87ddde)
- **8 档动效时长**: instant (80ms) → quick (150) → base (240) → soft (360) → narrative (520) → cinema (720) → epic (1100) → reveal (1600)
- **6 条缓动曲线**: ease-out / in-out / spring / soft / emphasis / cinema
- **7 组动效组合**: motion-pop / fade / rise / cinematic / epic / reveal / glide
- **8 档排版层级**: display / headline / title / subtitle / body / meta / caption / micro
- **4 级深度**: paper / card / float / cinematic
- **6 组状态渐变**: narrative / veil / amber / ink / success / alert
- **3 档色相端点**: narrative-start / mid / end

### Cinema Motion Library (commit e87ddde)
- 8 个 keyframes: rise / fall / veil / traverse / glide / glow / shimmer / breath
- 工具类: `.cinema-rise / fall / veil / traverse / shimmer / breath`
- Stagger: `.cinema-rise-d1` / `d2` / `d3` / `d4` / `d5` (80ms 步进)
- 自动错峰: `.cinema-stagger > *:nth-child(n)`
- motion-blur 隐喻: rise 用 `blur(8px) → blur(0)` + `saturate(0.9) → saturate(1)` 联动

### 视觉重做 (commit 227283c)
- **Dashboard**: 渐变背景 + 双 radial-gradient 光晕 + dot pattern 1px 点阵纹理 + 衬线 display 品牌头 + 渐变下划线输入框 + 演示卡左侧 4px 拉条 hover 展开 + 黑色实心 pill 按钮 + shimmer hover
- **ConclusionDockV3**: 杂志 grid 三列 (原始 / 脉动箭头 / 核查后) + 箭头带 dashed 环 cinema-breath + lede 斜体衬线段落 + 卡片化 boundary panel (success/alert 渐变背景 + glow 圆点) + 评分条 stagger 80ms + bar 渐变填充
- **LoginView**: cinema-rise 入场 + 衬线 h1 + 卡片输入 + 等宽字体 OTP 输入 (0.4em letter-spacing 居中)
- **PrivacyPolicy**: 长文阅读样式 (720px max-width, 衬线 h1, lede 引言, h2 章节分隔线, 1.7 行高列表, 危险按钮 hover 反色)
- **InferenceLicensePanel**: 卡片化 + boundary dot glow
- **ReasoningTracePanel**: 时间线 + cinema 入场
- **AgentStatusDot**: 8x8 圆点 + 白圈徽章感

### 字体策略
- 标题 / 引言 / 文章: var(--font-serif) (Noto Serif SC / Songti SC)
- 正文 / 按钮: var(--font-sans)
- 数字 / OTP: var(--font-mono) + tabular-nums

### 验收
- `npx tsc --noEmit` → 0 errors
- `npm test -- --run` → 155/155 pass
- `npm run build` → success
- `./ops.sh deploy --yes` → 成功,部署到 gun.yishuziyu.cn
- 设计令牌 grep 验证: 8 timing, 8 keyframes, 0 framer-motion 引入

### 已知未闭环
| 项目 | 状态 |
| --- | --- |
| MissionControlView 视觉升级 | 4667 行,留待 v5 polish |
| ApiKeySettings 视觉 | 留待 v5 polish |
| prefers-reduced-motion 适配 | 留待 v5 polish |
| 滚动入场 IntersectionObserver | 留待 v5 polish |

## 2026-07-05 v5: ScoreRail 可信度评分可视化栏目

### 用户反馈
> "这个评分这一块能不能做一个这种可视化的栏目?或者说做一个可视化的条?"

### 设计参照
用户给的 ultracode 截图核心:
- 顶部高对比度状态行 (单一焦点 + 加粗断言)
- 中间步骤行 (带图标,渐进披露)
- 下方分类卡片 (类别标题 + 必填/可选 + chip 列表)
- 中间步骤用浅色,具体结论用强样式

### 实现 (commit de1633c)
- 新建 `mvp/src/components/v3/panels/ScoreRail.tsx`(电影感双极轴可视化)
  - 大号 display 总分 + 等级 pill (4 档)
  - 主条 + 0/20/40/60/80/100 刻度 (单极 0-100,渐变填充含阈值色)
  - 三轴分量 (双极 -1..+1,中间 0 基线居中,supports/opposes/neutral 三态颜色)
  - 风险标签 chip (基于阈值推断)
- 新建 `mvp/src/components/v3/panels/ScoreRail.test.tsx`(8 个测试)
- 修改 `ConclusionDockV3.tsx` 用 `<ScoreRail>` 替换旧的进度条
- 修改 `styles.css` 加 `.score-rail` 系列样式

### 关键设计选择
- **双极轴 (bipolar axis)** 替代单极进度条 — 0 在中间,负值向左,正值向右。读者一眼看出哪个分量在拖后腿,哪个在支撑。
- **风险标签自动推断** — 不要在 schema 上加新字段,从总分和三个分量推导出 5 类风险:整体证据不足 / 主流来源缺失 / 来源稳定性偏低 / 反证覆盖不足 / 核心事实被推翻。
- **chip 用 ultracode 的轻量 pill 形态**(不是按钮感)— `⚠ △ ·` 前缀区分等级。
- **保持既有 cinema 节奏** — 整条主条用 cinema-rise 进场,刻度线和小数延迟 stagger。

### 验收
- `npx tsc --noEmit` → 0 errors
- `npm test -- --run` → 172/172 pass (164 + 8)
- `npm run build` → success
- `./ops.sh deploy --yes` → 部署到 gun.yishuziyu.cn 完成

### 已知未闭环
| 项目 | 状态 |
| --- | --- |
| 三维多端 vs 长跑 | 已合一个平衡 |
| 其他评分场景 (SourceValidator 独立报告, Mission Control middle 等) | 暂未集成 |

## 2026-07-06 — v5 visual polish follow-up

- BYO Key 设置页信任文案修正: 不再承诺“不会上传到服务端”,明确本机浏览器存储和测试连接时会 POST 到 `/api/agent/test-llm`。
- BYO Key 设置页接入杂志/电影感视觉: 增加本机保存说明、token 化表单/按钮/状态卡样式,不新增依赖。
- MissionControl 顶部状态条去掉 synthetic 进度百分比,改为真实事件流 ledger: 完成/运行/失败/排队/事件总数。
- AgentCard 可访问性文案从“执行进度 xx%”改为“执行状态”,百分数保留在标准 `progressbar` 属性里。
- Reduced motion: 新增完整 `prefers-reduced-motion` 覆盖,静态保留状态语义,禁用无限装饰动画,不重置 React Flow wrapper transform。
- Verification: `npx tsc --noEmit` OK, `npm test -- --run` 180/180, `npm run build` OK。
- Deployment: `./ops.sh deploy --yes` 已更新 gun.yishuziyu.cn。远端 nginx Host 验证 `/`, `/api/models/list`, `/health` 通过。
