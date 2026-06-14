# 红鲱鱼与枪 — 交互设计与架构决策补充文档

> 基于两层输入的综合决策：
> 1. 设计语言分层（React ≠ 设计语言，真正的 Design System 是什么）
> 2. AnySearch Skill 架构（Agent 工具包装样板，路由层 + 批量搜索 + 全文提取）
>
> 本文档产出可执行的设计决策，Codex 可直接据此修改代码。

---

## 一、设计语言选择（决策已锁定）

### 1.1 为什么不引入 Tailwind / shadcn/ui

| 考量 | 结论 |
|---|---|
| 时间 | 黑客松剩余时间不足以重写 CSS 体系 |
| 构建复杂度 | 当前项目无 Tailwind 依赖，引入会增加构建风险 |
| 现有资产 | 已有完整的自定义 CSS（`src/styles.css`），覆盖 2000+ 行 |
| **决策** | **保持现有 CSS，局部引入 Bento + Graph 视觉语言，不引入新依赖** |

### 1.2 视觉语言：Bento Grid + Graph Canvas 混合

```
Dashboard（Bento Grid 风格）
┌─────────────────────────────────────────────┐
│  [品牌标题]        [统计卡片] [统计卡片]      │
│                                             │
│  ┌──────────────┐  ┌────┐ ┌────┐ ┌────┐    │
│  │   输入框     │  │案例│ │案例│ │案例│    │
│  │   + 按钮     │  │卡片│ │卡片│ │卡片│    │
│  └──────────────┘  └────┘ └────┘ └────┘    │
│                                             │
│  [知识库快捷入口]  [最近核查]  [待验证队列]   │
└─────────────────────────────────────────────┘

Workspace（Graph Canvas 风格）
┌─────────────────────────────────────────────┐
│  [画布]                                      │
│    ○ → ○ → ○                                │
│    ↓   ↓   ↓                                │
│    ○   ○   ○  ← 纺锤体展开                   │
│    ↓   ↓   ↓                                │
│    ○ ← ○ ← ○                                │
│                                             │
│  [底部 Dock：导出/辟谣/归档/分享]             │
└─────────────────────────────────────────────┘
```

### 1.3 颜色系统（在现有基础上精修）

当前已有颜色变量，保持不变，新增语义映射：

```css
/* src/styles.css 中已有的变量 */
:root {
  --brand-blue: #2B7FD8;      /* 主品牌色 → 用于 claim 节点、主按钮 */
  --bg-warm: #fefcf6;          /* 暖白背景 → 页面底色 */
  --success: #16a766;          /* 可信/支持 → 可信节点、通过状态 */
  --warning: #ffad47;          /* 部分可信/警告 → 检测中节点 */
  --danger: #fb4c2f;           /* 高风险/存疑 → 风险节点、失败状态 */
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border: #e5e5e5;

  /* 新增：Bento Card 专用 */
  --bento-bg: #ffffff;
  --bento-border: rgba(0, 0, 0, 0.06);
  --bento-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --bento-radius: 16px;

  /* 新增：Graph 节点专用 */
  --node-running-glow: rgba(43, 127, 216, 0.3);
  --node-completed-glow: rgba(22, 167, 102, 0.2);
}
```

### 1.4 Bento Card 组件规格

**新建 `src/components/v3/BentoCard.tsx`**：

```typescript
interface BentoCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  variant?: "default" | "highlight" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  className?: string;
}
```

样式规范：
- 背景：白色（`--bento-bg`）
- 圆角：16px（`--bento-radius`）
- 边框：1px solid `rgba(0,0,0,0.06)`
- 阴影：`--bento-shadow`
- 悬停：`transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08)`
- 过渡：`all 0.2s ease`

### 1.5 Graph 节点规格（精修现有 SuzhengNode）

修改 `src/components/v3/SuzhengNode.tsx`：

```typescript
// 节点变体
interface NodeVariant {
  borderColor: string;
  backgroundColor: string;
  icon: string;
  glow?: string;
}

const NODE_VARIANTS: Record<string, NodeVariant> = {
  claim:          { borderColor: "#2B7FD8", backgroundColor: "#f0f7ff", icon: "📌" },
  rumor_detector: { borderColor: "#ffad47", backgroundColor: "#fff8f0", icon: "🚨", glow: "rgba(255,173,71,0.3)" },
  fact_checker:   { borderColor: "#a479e2", backgroundColor: "#f5f0ff", icon: "🔍", glow: "rgba(164,121,226,0.3)" },
  source_validator:{ borderColor: "#43d692", backgroundColor: "#f0fff5", icon: "📋", glow: "rgba(67,214,146,0.3)" },
  report_composer:{ borderColor: "#4a86e8", backgroundColor: "#f0f5ff", icon: "📝", glow: "rgba(74,134,232,0.3)" },
  evidence_support:{ borderColor: "#16a766", backgroundColor: "#f0fff5", icon: "✅" },
  evidence_counter:{ borderColor: "#fb4c2f", backgroundColor: "#fff5f0", icon: "❌" },
};
```

---

## 二、AnySearch Skill 架构启发（决策已锁定）

### 2.1 核心洞察：把"搜索"从临时动作变成可复用能力层

AnySearch 的设计精髓不是"搜索 API 包装"，而是**Agent 能力的协议化**：
- SKILL.md = Agent 契约
- list_domains = 路由层
- batch_search = 并行执行
- extract = 深度读取
- runtime.conf = 配置化

### 2.2 在我们的项目中的映射

| AnySearch 概念 | 我们的映射 | 实现文件 |
|---|---|---|
| `SKILL.md`（Agent 契约） | `AgentSkill` 接口 + `AGENT_SKILLS` 注册表 | `src/lib/agentSkill.ts` **【新建】** |
| `list_domains`（领域路由） | `EvidenceRouter`（谣言类型 → 证据源路由） | `src/lib/evidenceRouter.ts` **【新建】** |
| `batch_search`（批量搜索） | `BatchEvidenceSearch`（并行查多源） | `src/lib/batchSearch.ts` **【新建】** |
| `extract`（全文提取） | `SourceExtractor`（展示"我读了哪句话"） | `src/lib/sourceExtractor.ts` **【新建】** |
| `runtime.conf`（运行时配置） | `AgentRuntimeConfig`（模型/工具/策略配置） | `src/lib/runtimeConfig.ts` **【新建】** |

### 2.3 Agent Skill 契约层（新建 `src/lib/agentSkill.ts`）

每个 Agent 必须有明确的输入/输出/约束契约：

```typescript
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  trigger: string;                    // 何时触发该 Agent
  inputSchema: z.ZodSchema;           // 输入参数 schema
  outputSchema: z.ZodSchema;          // 输出参数 schema
  constraints: string[];              // 不能越界的约束
  evidenceSources: string[];          // 该 Agent 会查哪些证据源
  maxIterations: number;              // 最大迭代次数
  fallbackBehavior: string;           // 失败时的回退行为
}

export const AGENT_SKILLS: AgentSkill[] = [
  {
    id: "rumor_detector",
    name: "谣言特征检测",
    description: "分析 claim 中的谣言特征",
    trigger: "用户输入 claim 后自动触发",
    inputSchema: z.object({ claim: z.string() }),
    outputSchema: z.object({
      rumorIndicators: z.array(z.string()),
      severity: z.enum(["low", "medium", "high"]),
    }),
    constraints: [
      "不直接判定真假，只识别特征",
      "必须引用具体文本片段",
      "不能编造不存在的特征",
    ],
    evidenceSources: [],  // 纯文本分析
    maxIterations: 1,
    fallbackBehavior: "返回空特征列表，severity=low",
  },
  {
    id: "evidence_router",              // 新增：证据路由 Agent
    name: "证据路由器",
    description: "根据谣言类型选择最佳证据源",
    trigger: "RumorDetector 完成后触发",
    inputSchema: z.object({
      claim: z.string(),
      rumorIndicators: z.array(z.string()),
      rumorType: z.string(),
    }),
    outputSchema: z.object({
      routes: z.array(z.object({
        sourceType: z.string(),         // "360_search" | "knowledge_base" | "authority_db"
        query: z.string(),              // 搜索 query
        priority: z.number(),           // 优先级
        reason: z.string(),             // 为什么选择这个源
      })),
    }),
    constraints: [
      "必须优先查权威来源",
      "健康类必须查医学数据库",
      "财经类必须查官方数据",
    ],
    evidenceSources: ["360_search", "knowledge_base"],
    maxIterations: 1,
    fallbackBehavior: "route 到 360 通用搜索",
  },
  // ... FactChecker, SourceValidator, ReportComposer
];
```

### 2.4 证据路由层（新建 `src/lib/evidenceRouter.ts`）

**核心逻辑**：不是一上来就搜索，而是先判断谣言类型，再路由到最佳证据源。

```typescript
export interface EvidenceRoute {
  sourceType: "360_search" | "knowledge_base" | "authority_source" | "academic_db";
  sourceName: string;                 // 人类可读名称
  query: string;                      // 实际搜索 query
  priority: number;                   // 1-10，越高越优先
  expectedLatencyMs: number;          // 预计耗时
  reason: string;                     // 为什么选这个源
}

export interface RoutePlan {
  rumorType: string;
  routes: EvidenceRoute[];
  parallelGroups: EvidenceRoute[][];  // 可并行的路由组
}

// 路由表：谣言类型 → 证据源优先级
const TYPE_ROUTE_TABLE: Record<string, EvidenceRoute[]> = {
  "健康": [
    { sourceType: "authority_source", sourceName: "国家卫健委", query: "site:nhc.gov.cn {claim}", priority: 10, expectedLatencyMs: 2000, reason: "健康谣言首选权威医疗机构" },
    { sourceType: "360_search", sourceName: "360健康搜索", query: "{claim} 医学专家 辟谣", priority: 8, expectedLatencyMs: 3000, reason: "聚合多源医学信息" },
    { sourceType: "knowledge_base", sourceName: "历史健康谣言库", query: "{claim}", priority: 6, expectedLatencyMs: 500, reason: "查是否已有类似谣言" },
  ],
  "财经": [
    { sourceType: "authority_source", sourceName: "央行/证监会", query: "site:pbc.gov.cn OR site:csrc.gov.cn {claim}", priority: 10, expectedLatencyMs: 2000, reason: "财经信息以官方为准" },
    { sourceType: "360_search", sourceName: "360财经搜索", query: "{claim} 官方回应", priority: 8, expectedLatencyMs: 3000, reason: "查官方回应" },
  ],
  "科技": [
    { sourceType: "academic_db", sourceName: "知网/万方", query: "{claim} 论文 研究", priority: 9, expectedLatencyMs: 4000, reason: "科技谣言需查学术论文" },
    { sourceType: "360_search", sourceName: "360科技搜索", query: "{claim} 专家 科普", priority: 7, expectedLatencyMs: 3000, reason: "查科普文章" },
  ],
  "社会": [
    { sourceType: "authority_source", sourceName: "当地政府/警方", query: "{claim} 官方辟谣", priority: 10, expectedLatencyMs: 2000, reason: "社会谣言以官方通报为准" },
    { sourceType: "knowledge_base", sourceName: "历史社会谣言库", query: "{claim}", priority: 7, expectedLatencyMs: 500, reason: "查旧谣言复用" },
  ],
  "政治": [
    { sourceType: "authority_source", sourceName: "新华社/人民日报", query: "site:xinhuanet.com OR site:people.com.cn {claim}", priority: 10, expectedLatencyMs: 2000, reason: "政治信息以央媒为准" },
  ],
  "娱乐": [
    { sourceType: "360_search", sourceName: "360新闻搜索", query: "{claim} 当事人回应", priority: 8, expectedLatencyMs: 3000, reason: "娱乐谣言查当事人回应" },
    { sourceType: "knowledge_base", sourceName: "历史娱乐谣言库", query: "{claim}", priority: 6, expectedLatencyMs: 500, reason: "查旧谣言" },
  ],
};

export function buildRoutePlan(
  claim: string,
  rumorType: string,
  rumorIndicators: string[]
): RoutePlan;
```

### 2.5 批量并行搜索（新建 `src/lib/batchSearch.ts`）

```typescript
export interface BatchSearchJob {
  id: string;
  route: EvidenceRoute;
  status: "pending" | "running" | "completed" | "failed";
  result?: SearchResult;
  error?: string;
  latencyMs?: number;
}

export interface BatchSearchResult {
  jobs: BatchSearchJob[];
  completedAt: number;
  totalLatencyMs: number;
  sourcesFound: number;
  sourcesFailed: number;
}

// 并行执行多个搜索任务
export async function executeBatchSearch(
  routes: EvidenceRoute[],
  claim: string
): Promise<BatchSearchResult>;
```

**执行策略**：
- 将 routes 按 `parallelGroups` 分组
- 每组内并行执行（`Promise.all`）
- 组间串行（控制并发数，避免限流）
- 超时控制：单个 route 超时 10s，整体超时 30s

### 2.6 全文提取与证据引用（新建 `src/lib/sourceExtractor.ts`）

**核心能力**：不只是返回搜索摘要，而是展示"我读了网页的哪句话，这句话如何支持/反驳 claim"。

```typescript
export interface ExtractedEvidence {
  sourceUrl: string;
  sourceTitle: string;
  relevantQuotes: string[];           // 关键引用片段
  quoteContexts: string[];            // 引用上下文（前后各 50 字）
  claimRelation: "support" | "counter" | "neutral" | "context";
  confidence: number;                 // 0-100
  extractionMethod: "search_snippet" | "full_page" | "knowledge_base";
}

// 从搜索结果中提取关键引用
export async function extractEvidenceFromSource(
  source: Search360Source,
  claim: string
): Promise<ExtractedEvidence>;
```

**在 UI 中的展示**：

```
证据节点（Bento Card 风格）
┌─────────────────────────────────────┐
│  📰 来源：国家卫健委官网              │
│  🔗 https://nhc.gov.cn/...           │
│                                     │
│  "...隔夜菜中的亚硝酸盐含量          │
│   远低于国家安全标准..."             │
│   ── 支持 claim 的部分内容          │
│                                     │
│  置信度：85%  |  提取方式：全文提取   │
└─────────────────────────────────────┘
```

### 2.7 运行时配置（新建 `src/lib/runtimeConfig.ts`）

```typescript
export interface AgentRuntimeConfig {
  // LLM 配置
  primaryModel: string;               // "minimax" | "deepseek" | "anthropic"
  fallbackModel: string;
  maxTokens: number;

  // 搜索配置
  searchProvider: "360" | "anysearch" | "mock";
  maxSearchRoutes: number;
  searchTimeoutMs: number;

  // 证据配置
  evidenceSources: string[];          // 启用的证据源列表
  minEvidenceConfidence: number;      // 最低证据置信度

  // 迭代配置
  maxIterations: number;
  confidenceThreshold: number;        // 总体通过阈值

  // 知识库配置
  knowledgeBaseEnabled: boolean;
  similarityThreshold: number;
}

// 默认配置
export const DEFAULT_RUNTIME_CONFIG: AgentRuntimeConfig = {
  primaryModel: "deepseek",
  fallbackModel: "minimax",
  maxTokens: 2000,
  searchProvider: "360",
  maxSearchRoutes: 5,
  searchTimeoutMs: 10000,
  evidenceSources: ["360_search", "knowledge_base", "authority_source"],
  minEvidenceConfidence: 60,
  maxIterations: 3,
  confidenceThreshold: 70,
  knowledgeBaseEnabled: true,
  similarityThreshold: 60,
};

// 从 LocalStorage 读取 / 保存
export function loadRuntimeConfig(): AgentRuntimeConfig;
export function saveRuntimeConfig(config: AgentRuntimeConfig): void;
```

**在 UI 中的展示**：
- SettingsPanel 中新增 "运行时配置" 折叠面板
- 展示当前模型、搜索源、迭代策略
- 评委询问技术架构时可展开展示

---

## 三、交互流程重新设计

### 3.1 核心交互流（纺锤体 + Skill 架构融合）

```
用户输入 Claim
    │
    ▼
┌─────────────────┐
│ 谣言类型分类    │  ← 新增：先分类，再路由（AnySearch list_domains 启发）
│ (Taxonomy Agent)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 证据路由规划    │  ← 新增：根据类型选择最佳证据源
│ (EvidenceRouter)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 批量并行搜索    │  ← 新增：同时查多源（AnySearch batch_search 启发）
│ (BatchSearch)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 全文证据提取    │  ← 新增：展示"我读了哪句话"（AnySearch extract 启发）
│ (SourceExtractor)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 谣言特征检测    │
│ (RumorDetector) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 事实核查        │
│ (FactChecker)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 信源验证        │
│ (SourceValidator)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 置信度评估      │  ← 新增：5维置信度（FIRE 机制）
│ (ConfidenceEngine)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 报告生成        │
│ (ReportComposer)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 闭环动作        │  ← 新增：4个闭环按钮
│ (Closure Dock)  │
└─────────────────┘
```

### 3.2 画布节点映射

每个阶段对应画布上的节点类型：

| 阶段 | 节点类型 | 视觉表现 |
|---|---|---|
| 输入 Claim | `claim` | 蓝色大节点，顶部居中 |
| 谣言分类 | `taxonomy` | 小节点，显示类型标签 |
| 证据路由 | `route_plan` | 虚线框，内含多个路由卡片 |
| 批量搜索 | `batch_search` | 并行节点组，每个搜索一个子节点 |
| 全文提取 | `extracted_evidence` | Bento Card 风格证据卡片 |
| RumorDetector | `rumor_detector` | 黄色脉冲节点 |
| FactChecker | `fact_checker` | 紫色脉冲节点 |
| SourceValidator | `source_validator` | 绿色脉冲节点 |
| ConfidenceEngine | `confidence` | 5维条形图节点 |
| ReportComposer | `report_composer` | 蓝色节点 |
| 结论 | `conclusion` | 大节点，颜色根据可信度变化 |

### 3.3 Dashboard 重新设计（Bento Grid）

```
┌─────────────────────────────────────────────────────────────┐
│  红鲱鱼与枪 — 信息真相猎人                                    │
│  已核查 1,247 条 · 覆盖 6 类谣言 · 平均准确率 94.2%          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🔍 输入要核查的信息...                             │   │
│  │  [快速核查]  [深度核查（多Agent）]                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ 🏥 健康谣言   │  │ 🏛️ 社会谣言   │  │ 🔬 科技谣言   │     │
│  │ 隔夜菜致癌... │  │ 地铁停运...   │  │ 5G辐射...     │     │
│  │ [快速体验]    │  │ [快速体验]    │  │ [快速体验]    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ 💰 财经谣言   │  │ 🏛️ 政治谣言   │  │ 🎬 娱乐谣言   │     │
│  │ 人民币贬值... │  │ 政策解读...   │  │ 明星谣言...   │     │
│  │ [快速体验]    │  │ [快速体验]    │  │ [快速体验]    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ 📚 最近核查历史  │  │ ⏳ 待验证队列    │                  │
│  │ - 隔夜菜致癌 ✅  │  │ - 某疫苗副作用   │                  │
│  │ - 5G辐射 ✅     │  │ - 某股票内幕     │                  │
│  │ - 地铁停运 ❌   │  │                  │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、与 IMPLEMENTATION.md 的对照更新

本文档是对 `IMPLEMENTATION.md` 的补充和细化。以下是需要在 `IMPLEMENTATION.md` 中**新增或修改**的内容：

### 4.1 新增模块（在 M1-M7 基础上）

| 模块 | 文件 | 说明 |
|---|---|---|
| **M8** Agent Skill 契约层 | `src/lib/agentSkill.ts` | 每个 Agent 的输入/输出/约束契约 |
| **M9** 证据路由层 | `src/lib/evidenceRouter.ts` | 谣言类型 → 证据源路由 |
| **M10** 批量并行搜索 | `src/lib/batchSearch.ts` | 并行查多源 |
| **M11** 全文提取 | `src/lib/sourceExtractor.ts` | 展示关键引用 |
| **M12** 运行时配置 | `src/lib/runtimeConfig.ts` | AgentRuntimeConfig |
| **M13** Bento Card 组件 | `src/components/v3/BentoCard.tsx` | 通用卡片组件 |

### 4.2 修改现有模块

| 模块 | 修改内容 |
|---|---|
| M1 知识库 | 集成 `AgentRuntimeConfig`，支持配置化启用/禁用 |
| M2 360 搜索 | 被纳入 `EvidenceRouter` 统一管理 |
| M3 闭环动作 | 使用 `BentoCard` 组件 |
| M5 纺锤体画布 | 新增 `taxonomy`, `route_plan`, `batch_search`, `extracted_evidence`, `confidence` 节点类型 |
| M6 置信度 | 输出格式对接 `ConfidenceEngine` |

### 4.3 实施顺序更新

```
Phase 0: 基础设施（最优先）
├── M12: AgentRuntimeConfig（运行时配置）
├── M8: AgentSkill 契约层
├── M13: BentoCard 组件
└── 更新现有 CSS 变量

Phase 1: P0 核心
├── M9: EvidenceRouter（证据路由）
├── M10: BatchSearch（批量搜索）
├── M11: SourceExtractor（全文提取）
├── M1: KnowledgeBase（知识库）
├── M2: 360 Search（360 搜索接入）
└── M3: Closure Actions（闭环动作）

Phase 2: P1 增强
├── M4: 谣言类型扩展
├── M5: 纺锤体画布（含新增节点类型）
└── M6: FIRE 置信度

Phase 3: P2 polish
└── M7: BenchmarkPanel
```

---

## 五、关键设计决策总结

| 决策 | 选择 | 理由 |
|---|---|---|
| CSS 框架 | 保持现有自定义 CSS | 时间紧迫，不引入 Tailwind |
| 视觉语言 | Bento Grid + Graph Canvas | Dashboard 用 Bento，画布用 Graph |
| 组件风格 | Bento Card（圆角16px + 微阴影） | 现代感，适合信息卡片 |
| 节点风格 | 脉冲动画 + 语义色边框 | Agent 运行状态直观 |
| 搜索架构 | EvidenceRouter + BatchSearch | AnySearch Skill 启发，先路由再并行 |
| 证据展示 | 关键引用 + 上下文 | 展示"我读了哪句话"，增强可信度 |
| 配置方式 | AgentRuntimeConfig + LocalStorage | 评委可查看技术架构配置 |
| Agent 契约 | AgentSkill 接口 + 约束列表 | 明确的输入/输出/边界 |

---

*文档版本：v1.0 | 与 IMPLEMENTATION.md 配套使用*
