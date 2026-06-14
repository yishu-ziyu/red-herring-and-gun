# Codex 执行 Prompt 集

> 每个 Prompt 可独立复制给 Codex 执行。按批次顺序执行，同一批次内可并行。
> 项目路径：`/Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp`
> 技术栈：React 18 + TypeScript + Vite + 自定义 CSS（无 Tailwind）

---

## 批次 0：基础设施（3 个任务并行）

---

### Prompt 0-A：AgentRuntimeConfig 运行时配置系统

**目标**：实现可配置、可持久化的 Agent 运行时配置系统，让评委能看到完整的技术架构配置。

**上下文**：
- 项目使用 React Context + useReducer 管理状态
- 配置需要持久化到 LocalStorage
- 当前 SettingsPanel 只有模型选择，没有完整的运行时配置

**要求**：

1. **新建 `src/lib/runtimeConfig.ts`**：

```typescript
import { z } from "zod";

export const AgentRuntimeConfigSchema = z.object({
  primaryModel: z.enum(["minimax", "deepseek", "anthropic"]).default("deepseek"),
  fallbackModel: z.enum(["minimax", "deepseek", "anthropic"]).default("minimax"),
  maxTokens: z.number().min(500).max(8000).default(2000),
  searchProvider: z.enum(["360", "mock"]).default("360"),
  maxSearchRoutes: z.number().min(1).max(10).default(5),
  searchTimeoutMs: z.number().min(3000).max(30000).default(10000),
  evidenceSources: z.array(z.string()).default(["360_search", "knowledge_base", "authority_source"]),
  minEvidenceConfidence: z.number().min(0).max(100).default(60),
  maxIterations: z.number().min(1).max(10).default(3),
  confidenceThreshold: z.number().min(0).max(100).default(70),
  knowledgeBaseEnabled: z.boolean().default(true),
  similarityThreshold: z.number().min(0).max(100).default(60),
});

export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfigSchema>;

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

export function loadRuntimeConfig(): AgentRuntimeConfig;
export function saveRuntimeConfig(config: AgentRuntimeConfig): void;
export function resetRuntimeConfig(): void;
```

2. **修改 `src/store/reasoningStore.tsx`**：
   - `ReasoningState` 新增 `runtimeConfig: AgentRuntimeConfig`
   - 新增 Action：`SET_RUNTIME_CONFIG`, `RESET_RUNTIME_CONFIG`
   - `initialState` 中调用 `loadRuntimeConfig()`

3. **修改 `src/components/v3/panels/SettingsPanel.tsx`**：
   - 新增 "运行时配置" 折叠面板
   - 展示所有配置项（只读模式 + 编辑模式切换）
   - 提供 "恢复默认" 按钮

**验收标准**：
- [ ] `runtimeConfig.ts` 实现完整，Zod schema 验证通过
- [ ] SettingsPanel 可展示和编辑配置
- [ ] 配置变更自动保存到 LocalStorage
- [ ] 页面刷新后配置不丢失
- [ ] TypeScript 编译通过

---

### Prompt 0-B：AgentSkill 契约层

**目标**：为每个 Agent 定义明确的输入/输出/约束契约，类似 AnySearch 的 SKILL.md 模式。

**上下文**：
- 已有 `src/lib/agentConfigs.ts` 定义了 4 个 Agent 的 system prompt
- 但缺少明确的契约接口（何时触发、输入什么、输出什么、不能做什么）

**要求**：

1. **新建 `src/lib/agentSkill.ts`**：

```typescript
import { z } from "zod";

export interface AgentSkill {
  id: string;
  name: string;
  icon: string;
  description: string;
  trigger: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  constraints: string[];
  evidenceSources: string[];
  maxIterations: number;
  fallbackBehavior: string;
}

// 为每个 Agent 定义契约
export const RUMOR_DETECTOR_SKILL: AgentSkill;
export const EVIDENCE_ROUTER_SKILL: AgentSkill;      // 新增
export const FACT_CHECKER_SKILL: AgentSkill;
export const SOURCE_VALIDATOR_SKILL: AgentSkill;
export const REPORT_COMPOSER_SKILL: AgentSkill;

// 注册表
export const AGENT_SKILL_REGISTRY: Record<string, AgentSkill>;

// 工具函数
export function getAgentSkill(id: string): AgentSkill | undefined;
export function validateAgentInput(skillId: string, input: unknown): boolean;
export function validateAgentOutput(skillId: string, output: unknown): boolean;
```

2. **契约内容要求**：
   - `rumor_detector`：输入 `{ claim: string }`，输出 `{ rumorIndicators: string[], severity: "low"|"medium"|"high", analysis: string, detectedPatterns: string[] }`，约束："不直接判定真假"
   - `evidence_router`（新增）：输入 `{ claim: string, rumorIndicators: string[], rumorType: string }`，输出 `{ routes: EvidenceRoute[] }`
   - `fact_checker`：输入 `{ claim: string, rumorIndicators: string[], severity: string }`，输出 `{ factCheckResult: string, confidence: string, sources: string[], keyFindings: string[], counterEvidence: string[] }`
   - `source_validator`：输入 `{ claim: string, sources: string[] }`，输出 `{ sourceReliability: string, verifiedSources: string[], questionableSources: string[], missingSources: string[], verificationNotes: string }`
   - `report_composer`：输入 `{ claim: string, rumorAnalysis: object, factCheck: object, sourceValidation: object }`，输出 `{ conclusion: string, credibilityScore: number, credibilityLabel: string, recommendation: string, summaryForPublic: string }`

3. **修改 `src/lib/agentConfigs.ts`**：
   - 导入 AgentSkill 契约
   - 在 AGENT_CONFIGS 中增加 `skillId` 字段，关联到契约

**验收标准**：
- [ ] 5 个 Agent 契约完整定义
- [ ] 输入/输出 Zod Schema 可验证
- [ ] `agentConfigs.ts` 关联到契约
- [ ] 提供 `validateAgentInput` / `validateAgentOutput` 工具函数
- [ ] TypeScript 编译通过

---

### Prompt 0-C：BentoCard 通用组件

**目标**：实现 Bento Grid 风格的基础卡片组件，作为 Dashboard 和证据展示的通用 UI 单元。

**上下文**：
- 项目使用自定义 CSS，无 Tailwind
- 需要新增 CSS 变量支持 Bento 风格
- 当前卡片样式不统一

**要求**：

1. **新建 `src/components/v3/BentoCard.tsx`**：

```typescript
interface BentoCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  variant?: "default" | "highlight" | "danger" | "success" | "warning";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  className?: string;
  footer?: React.ReactNode;
  badge?: { text: string; color: string };
}
```

2. **CSS 规范（添加到 `src/styles.css`）**：

```css
:root {
  --bento-bg: #ffffff;
  --bento-border: rgba(0, 0, 0, 0.06);
  --bento-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --bento-radius: 16px;
  --bento-hover-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.bento-card {
  background: var(--bento-bg);
  border: 1px solid var(--bento-border);
  border-radius: var(--bento-radius);
  box-shadow: var(--bento-shadow);
  padding: 20px;
  transition: all 0.2s ease;
  cursor: default;
}

.bento-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--bento-hover-shadow);
}

.bento-card--highlight { border-color: rgba(43, 127, 216, 0.2); background: #f0f7ff; }
.bento-card--danger { border-color: rgba(251, 76, 47, 0.2); background: #fff5f0; }
.bento-card--success { border-color: rgba(22, 167, 102, 0.2); background: #f0fff5; }
.bento-card--warning { border-color: rgba(255, 173, 71, 0.2); background: #fff8f0; }

.bento-card--sm { padding: 12px; }
.bento-card--md { padding: 20px; }
.bento-card--lg { padding: 28px; }
```

3. **组件实现要求**：
   - 标题区：标题 + 副标题 + badge
   - 内容区：children 渲染
   - 底部：可选 footer
   - 悬停效果：上浮 + 阴影加深
   - 点击：可选 onClick，有指针样式

**验收标准**：
- [ ] BentoCard 组件渲染正确
- [ ] 5 种 variant 样式正确
- [ ] 3 种 size 内边距正确
- [ ] 悬停动画流畅
- [ ] 在 Dashboard.tsx 中至少替换 1 个现有卡片为 BentoCard 作为示例
- [ ] TypeScript 编译通过

---

## 批次 1：P0 核心功能（5 个任务并行）

---

### Prompt 1-A：EvidenceRouter 证据路由层

**目标**：实现谣言类型 → 最佳证据源的路由系统，受 AnySearch `list_domains` 启发。

**上下文**：
- 已有 4 类谣言（健康/社会/科技/财经），将扩展为 6 类（+政治/娱乐）
- 当前搜索没有路由逻辑，直接调用单一 API
- 需要支持 Demo fallback 模式

**要求**：

1. **新建 `src/lib/evidenceRouter.ts`**：

```typescript
export interface EvidenceRoute {
  sourceType: "360_search" | "knowledge_base" | "authority_source" | "academic_db";
  sourceName: string;
  query: string;
  priority: number;          // 1-10
  expectedLatencyMs: number;
  reason: string;
}

export interface RoutePlan {
  claim: string;
  rumorType: string;
  routes: EvidenceRoute[];
  parallelGroups: EvidenceRoute[][];
  totalExpectedLatencyMs: number;
}

// 路由表
const TYPE_ROUTE_TABLE: Record<string, EvidenceRoute[]>;

// 核心函数
export function buildRoutePlan(
  claim: string,
  rumorType: string,
  rumorIndicators: string[]
): RoutePlan;

export function getRouteForType(rumorType: string): EvidenceRoute[];

export function prioritizeRoutes(routes: EvidenceRoute[]): EvidenceRoute[];
```

2. **路由表内容**（必须包含 6 类谣言）：

| 类型 | 优先级1 | 优先级2 | 优先级3 |
|---|---|---|---|
| 健康 | 国家卫健委 (authority) | 360健康搜索 | 历史健康谣言库 |
| 财经 | 央行/证监会 (authority) | 360财经搜索 | - |
| 科技 | 知网/万方 (academic) | 360科技搜索 | - |
| 社会 | 当地政府/警方 (authority) | 历史社会谣言库 | - |
| 政治 | 新华社/人民日报 (authority) | - | - |
| 娱乐 | 360新闻搜索 | 历史娱乐谣言库 | - |

3. **并行分组逻辑**：
   - 同一 sourceType 的路由可以并行
   - authority_source 优先单独执行（结果最可靠）
   - 其他路由按 sourceType 分组并行

4. **修改 `src/lib/agentConfigs.ts`**：
   - 新增 `evidence_router` Agent 配置
   - systemPrompt 要求输出 RoutePlan 格式的 JSON

5. **Demo fallback**：
   - 在 `src/lib/demoData.ts` 中新增 `buildRoutePlanDemoFallback()`

**验收标准**：
- [ ] 6 类谣言都有完整路由配置
- [ ] `buildRoutePlan` 返回正确的 RoutePlan 结构
- [ ] 并行分组逻辑正确
- [ ] 新增 `evidence_router` Agent 配置
- [ ] Demo fallback 数据可用
- [ ] TypeScript 编译通过

---

### Prompt 1-B：BatchSearch 批量并行搜索

**目标**：实现并行执行多个搜索任务的能力，受 AnySearch `batch_search` 启发。

**上下文**：
- EvidenceRouter 输出多个 EvidenceRoute
- 需要并行执行这些路由的搜索
- 需要超时控制和错误处理

**要求**：

1. **新建 `src/lib/batchSearch.ts`**：

```typescript
export interface BatchSearchJob {
  id: string;
  route: EvidenceRoute;
  status: "pending" | "running" | "completed" | "failed";
  result?: SearchResult;
  error?: string;
  latencyMs?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface SearchResult {
  sourceType: string;
  sourceName: string;
  query: string;
  hits: Array<{
    title: string;
    url: string;
    snippet: string;
    credibility?: "high" | "medium" | "low";
  }>;
  totalHits: number;
}

export interface BatchSearchResult {
  claim: string;
  jobs: BatchSearchJob[];
  completedAt: number;
  totalLatencyMs: number;
  sourcesFound: number;
  sourcesFailed: number;
  allHits: SearchResult["hits"];
}

// 核心函数
export async function executeBatchSearch(
  routes: EvidenceRoute[],
  claim: string,
  options?: {
    maxConcurrent?: number;
    timeoutMs?: number;
    onJobStart?: (job: BatchSearchJob) => void;
    onJobComplete?: (job: BatchSearchJob) => void;
  }
): Promise<BatchSearchResult>;

// 单个路由搜索（内部使用）
async function executeSingleSearch(
  route: EvidenceRoute,
  claim: string
): Promise<SearchResult>;
```

2. **执行策略**：
   - 默认最大并发：3 个
   - 单个路由超时：10s
   - 整体超时：30s
   - 失败路由记录 error，不影响其他路由
   - 提供回调函数用于实时更新 UI

3. **360 搜索集成**：
   - 调用 `src/lib/search360.ts`（Prompt 1-E 实现）
   - 如果 360 不可用，fallback 到 mock 数据

4. **知识库集成**：
   - `knowledge_base` 类型的路由查询 KnowledgeBase
   - 其他类型调用对应搜索 API

5. **Demo fallback**：
   - 在 `src/lib/demoData.ts` 中新增 `buildBatchSearchDemoFallback()`

**验收标准**：
- [ ] 可并行执行多个搜索任务
- [ ] 超时控制正确（单路由 10s，整体 30s）
- [ ] 失败路由不影响整体结果
- [ ] 回调函数可实时通知 UI 更新
- [ ] Demo fallback 数据可用
- [ ] TypeScript 编译通过

---

### Prompt 1-C：SourceExtractor 全文提取与证据引用

**目标**：实现"我读了网页的哪句话"的深度证据提取，受 AnySearch `extract` 启发。

**上下文**：
- 当前搜索只返回标题和摘要
- 需要展示关键引用片段及其上下文
- 需要评估引用与 claim 的关系

**要求**：

1. **新建 `src/lib/sourceExtractor.ts`**：

```typescript
export interface ExtractedEvidence {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  relevantQuotes: Array<{
    text: string;
    position: "beginning" | "middle" | "end";
    relevanceScore: number;      // 0-100
  }>;
  quoteContexts: string[];       // 每个引用的前后各 50 字
  claimRelation: "support" | "counter" | "neutral" | "context";
  confidence: number;            // 0-100
  extractionMethod: "search_snippet" | "full_page" | "knowledge_base";
  extractedAt: number;
}

// 从搜索结果中提取证据
export async function extractEvidenceFromSearchResult(
  searchResult: SearchResult,
  claim: string
): Promise<ExtractedEvidence[]>;

// 评估引用与 claim 的关系
export function assessClaimRelation(
  quote: string,
  claim: string
): "support" | "counter" | "neutral" | "context";

// 计算引用置信度
export function calculateQuoteConfidence(
  quote: string,
  sourceDomain: string,
  claim: string
): number;

// 域名可信度评估
export function assessDomainCredibility(domain: string): "high" | "medium" | "low";
```

2. **域名可信度表**（预定义）：

| 可信度 | 域名模式 |
|---|---|
| high | `*.gov.cn`, `xinhuanet.com`, `people.com.cn`, `nhc.gov.cn`, `pbc.gov.cn`, `csrc.gov.cn`, `cnki.net`, `wanfangdata.com.cn` |
| medium | `sina.com`, `163.com`, `sohu.com`, `ifeng.com`, `qq.com`, `zhihu.com` |
| low | `weibo.com`, `tieba.baidu.com`, `bbs.*`, `blog.*` |

3. **claimRelation 评估逻辑**（简化版）：
   - 提取 quote 和 claim 的关键词
   - 计算关键词重叠度
   - 检查否定词（"不"、"没有"、"虚假"等）
   - 返回 support / counter / neutral / context

4. **UI 展示格式**：

```
证据卡片（BentoCard 风格）
┌─────────────────────────────────────────┐
│ 📰 国家卫健委官网                        │
│ 🔗 nhc.gov.cn/...                       │
│                                         │
│ "...亚硝酸盐含量远低于国家安全标准..."   │
│                                         │
│ 上下文："根据最新研究，隔夜菜中的        │
│ 亚硝酸盐含量远低于国家安全标准，         │
│ 正常食用不会对健康造成危害..."           │
│                                         │
│ 与 Claim 关系：✅ 支持  |  置信度：85%   │
│ 来源可信度：🏛️ 政府官网（高）            │
└─────────────────────────────────────────┘
```

5. **Demo fallback**：
   - 在 `src/lib/demoData.ts` 中新增 `buildExtractedEvidenceDemoFallback()`

**验收标准**：
- [ ] 域名可信度评估正确
- [ ] claimRelation 评估逻辑可运行
- [ ] 引用置信度计算合理
- [ ] ExtractedEvidence 结构完整
- [ ] Demo fallback 数据可用
- [ ] TypeScript 编译通过

---

### Prompt 1-D：KnowledgeBase 知识库系统

**目标**：实现持久化、可检索的历史 Case 记忆系统，替代当前仅存的 LocalStorage 评论。

**上下文**：
- 当前只有 `NodeComment` 和 `FollowUpEntry` 存储在 LocalStorage
- 需要存储完整 Case 数据（claim、诊断、报告、Agent 执行记录）
- 需要支持相似 Case 推荐

**要求**：

1. **修改 `src/lib/schemas.ts`**，新增类型：

```typescript
export interface KnowledgeBaseEntry {
  id: string;
  claim: string;
  claimHash: string;                 // 简化相似度：使用文本 hash
  rumorType: RumorType | string;
  diagnosis: ClaimDiagnosis;
  finalReport: FinalReport;
  handoffSteps: HandoffStep[];
  credibilityScore: number;
  verificationResult?: "true" | "false" | "partial" | "unknown";
  timestamp: number;
  tags: string[];
  archived: boolean;                 // 是否存疑归档
  archiveReason?: string;
}

export interface EvidenceLibraryEntry {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  summary: string;
  role: EvidenceRole;
  relatedClaimIds: string[];
  credibility: ScoreLevel;
  timestamp: number;
}

export interface SearchStrategyMemory {
  id: string;
  rumorType: string;
  effectiveQueries: string[];
  ineffectiveQueries: string[];
  sourceDomains: string[];
  timestamp: number;
  useCount: number;
}
```

2. **新建 `src/lib/knowledgeBase.ts`**：

```typescript
export interface KnowledgeBase {
  // Case 管理
  saveCase(entry: KnowledgeBaseEntry): Promise<void>;
  getCase(id: string): Promise<KnowledgeBaseEntry | null>;
  listCases(filter?: { rumorType?: string; archived?: boolean; tag?: string }): Promise<KnowledgeBaseEntry[]>;
  findSimilarCases(claim: string, limit?: number): Promise<KnowledgeBaseEntry[]>;

  // 证据库
  addEvidence(evidence: EvidenceLibraryEntry): Promise<void>;
  findEvidence(query: string, options?: { role?: EvidenceRole; limit?: number }): Promise<EvidenceLibraryEntry[]>;

  // 搜索策略
  getSearchStrategy(rumorType: string): Promise<SearchStrategyMemory | null>;
  updateSearchStrategy(rumorType: string, updates: Partial<SearchStrategyMemory>): Promise<void>;

  // 统计
  getStats(): Promise<{
    totalCases: number;
    totalEvidence: number;
    archivedCases: number;
    typeDistribution: Record<string, number>;
  }>;
}

// 工厂函数
export function createKnowledgeBase(): KnowledgeBase;
```

3. **存储实现**：
   - 使用 LocalStorage 存储元数据列表（轻量）
   - 使用 IndexedDB 存储完整 Case 数据（大对象）
   - 如果 IndexedDB 不可用，fallback 到 LocalStorage（限制 5MB）

4. **相似度计算**（简化版，不使用向量）：

```typescript
function calculateSimilarity(claimA: string, claimB: string): number {
  let score = 0;

  // 1. 完全相同 +100
  if (claimA === claimB) return 100;

  // 2. 包含关系 +80
  if (claimA.includes(claimB) || claimB.includes(claimA)) return 80;

  // 3. 关键词重叠（Jaccard）
  const wordsA = new Set(claimA.split(/\s+/));
  const wordsB = new Set(claimB.split(/\s+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  score += (intersection.size / union.size) * 50;

  // 4. 最长公共子串
  const lcs = longestCommonSubstring(claimA, claimB);
  score += (lcs.length / Math.max(claimA.length, claimB.length)) * 30;

  return Math.min(100, Math.round(score));
}
```

5. **修改 `src/store/reasoningStore.tsx`**：
   - `ReasoningState` 新增 `knowledgeBase: KnowledgeBase`
   - 新增 Action：`SAVE_TO_KNOWLEDGE_BASE`, `ARCHIVE_CASE`
   - 完成核查后自动调用 `saveCase`

6. **修改 `src/components/v3/Dashboard.tsx`**：
   - 输入 claim 时，显示 "相似历史 Case" 推荐（最多 3 个）
   - 展示知识库统计："已核查 X 条 · 覆盖 Y 类谣言"

7. **修改 `src/components/v3/panels/KnowledgePanel.tsx`**：
   - 新增 "历史证据库" Tab
   - 展示最近添加的证据条目
   - 支持按类型筛选

**验收标准**：
- [ ] 完成核查后自动保存到知识库
- [ ] Dashboard 输入时显示相似 Case 推荐
- [ ] KnowledgePanel 显示历史证据库
- [ ] 支持按谣言类型筛选历史 Case
- [ ] 支持存疑归档功能
- [ ] LocalStorage/IndexedDB 持久化，刷新不丢失
- [ ] TypeScript 编译通过

---

### Prompt 1-E：360 Search API 接入

**目标**：接入 360 AI Search API，实现真实搜索能力。

**上下文**：
- API 端点：`POST https://api.360.cn/v1/search/aisearch`
- 模型：`360gpt-pro`
- 需要支持 SSE 流式返回
- 需要 Demo fallback 数据

**要求**：

1. **修改 `src/lib/schemas.ts`**，新增类型：

```typescript
export interface Search360Request {
  query: string;
  model?: string;
  maxResults?: number;
  freshness?: "day" | "week" | "month" | "year";
}

export interface Search360Source {
  title: string;
  url: string;
  snippet: string;
  publishDate?: string;
  credibility?: ScoreLevel;
}

export interface Search360Response {
  answer: string;
  sources: Search360Source[];
  relatedQuestions: string[];
  query: string;
  totalSources: number;
}
```

2. **新建 `src/lib/search360.ts`**：

```typescript
export async function search360(request: Search360Request): Promise<Search360Response>;

export interface Search360StreamEvent {
  type: "answer_chunk" | "source" | "related_question" | "complete" | "error";
  data?: string;
  source?: Search360Source;
  relatedQuestion?: string;
  error?: string;
}

export async function* search360Stream(request: Search360Request): AsyncGenerator<Search360StreamEvent>;
```

3. **后端 API（修改 `vite.config.ts`）**：

```typescript
// 新增 endpoint
app.post('/api/search/360', async (req, res) => {
  const { query, model = '360gpt-pro', maxResults = 5 } = req.body;

  // 调用 360 API
  // Authorization: Bearer {360_API_KEY}
  // 返回标准化 Search360Response
});
```

4. **环境变量**：
   - 读取 `VITE_360_API_KEY` 或 `360_API_KEY`
   - 如果未配置，返回 mock 数据

5. **前端 API 层（修改 `src/lib/agentExpansion.ts`）**：
   - 新增 `request360Search()` 函数
   - 失败时 fallback 到 demo 数据

6. **Demo fallback**：
   - 在 `src/lib/demoData.ts` 中新增 `build360SearchDemoFallback()`
   - 返回模拟的 Search360Response

**验收标准**：
- [ ] `/api/search/360` endpoint 可正常调用
- [ ] 支持流式返回（SSE）
- [ ] 前端 `request360Search()` 可用
- [ ] 无 API key 时自动 fallback 到 demo 数据
- [ ] 返回结果符合 Search360Response 类型
- [ ] TypeScript 编译通过

---

### Prompt 1-F：闭环动作系统（辟谣卡片 / 存疑归档 / 分享）

**目标**：实现核查后的 3 个闭环动作，替代当前仅有的"导出报告"。

**上下文**：
- 当前 `ConclusionDockV3.tsx` 只有"导出报告"按钮
- 需要新增：生成辟谣卡片、存疑归档、分享核查
- 辟谣卡片需要可下载为 PNG

**要求**：

1. **修改 `src/lib/schemas.ts`**，新增类型：

```typescript
export type ClosureAction =
  | "generate_rebuttal_card"
  | "archive_doubtful"
  | "share_verification"
  | "export_report";

export interface RebuttalCard {
  title: string;
  verdict: string;
  verdictColor: string;
  keyPoints: string[];
  sourceRef: string;
  generatedAt: number;
  claim: string;
  credibilityScore: number;
  credibilityLabel: string;
}
```

2. **新建 `src/components/v3/RebuttalCardModal.tsx`**：

```typescript
interface RebuttalCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: FinalReport;
  caseData: DemoCase;
  credibilityScore: number;
  credibilityLabel: string;
}
```

**UI 要求**：
- 竖版卡片预览（宽 375px，模拟手机屏幕）
- 顶部："🚨 谣言识别" 标签
- 中部：claim 摘要（最多 2 行）
- 大标题： verdict（"已证伪" / "部分可信" / "存疑"）
- 3 条核心反驳要点（带勾选框样式）
- 底部："红鲱鱼与枪 · 信息真相猎人" + 时间戳
- 背景色根据 verdict 变化（红/黄/灰）

3. **修改 `src/components/v3/ConclusionDockV3.tsx`**：

底部坞扩展为 4 个按钮：

```
┌─────────────────────────────────────────────────────────────┐
│  [📝 导出报告]  [🎯 辟谣卡片]  [📦 存疑归档]  [🔗 分享核查]   │
└─────────────────────────────────────────────────────────────┘
```

按钮样式：
- 导出报告：outline 样式（已有）
- 辟谣卡片：primary 样式（蓝色填充）
- 存疑归档：warning 样式（黄色填充）
- 分享核查：success 样式（绿色填充）

4. **存疑归档功能**：
   - 调用 `knowledgeBase.saveCase()` 并设置 `archived: true`
   - 弹出确认 toast："已存疑归档，可在 Dashboard 待验证队列查看"
   - 在 Dashboard 新增 "待验证队列" 区域

5. **分享功能**：
   - 生成分享摘要文本（适合微信/微博）
   - 格式：
     ```
     🚨 谣言识别结果

     「{claim摘要}」

     核查结论：{credibilityLabel}（{credibilityScore}%）
     核心发现：{keyFinding1}

     —— 红鲱鱼与枪 · 信息真相猎人
     ```
   - 复制到剪贴板
   - 可选：生成带 hash 的分享 URL（简化版用 claim 的 base64 hash）

6. **辟谣卡片下载**：
   - 使用 `html-to-image` 库（`npm install html-to-image`）
   - 将卡片 DOM 转为 PNG 下载
   - 文件名：`辟谣_{claim前10字}_{日期}.png`

7. **修改 `src/store/reasoningStore.tsx`**：
   - 新增 Action：`SET_VERIFICATION_RESULT`, `ARCHIVE_CASE`

**验收标准**：
- [ ] 底部坞显示 4 个闭环动作按钮
- [ ] 辟谣卡片弹窗可预览
- [ ] 辟谣卡片可下载为 PNG
- [ ] 存疑归档保存到知识库，Dashboard 可查看
- [ ] 分享功能生成可复制文本
- [ ] 所有动作都有 Demo fallback
- [ ] TypeScript 编译通过

---

## 批次 2：P1 增强（2 个任务并行）

---

### Prompt 2-A：谣言类型扩展（4 → 6 类）

**目标**：新增政治、娱乐两类谣言 Demo Case。

**要求**：

1. **新建 `src/data/rumorCases/politicalRumor.ts`**：
   - `originalClaim`: "某重要政策即将取消，内部已开会决定"
   - `rumorType`: "政治"
   - 包含完整的 diagnosis、subclaims、routes、searchPlans、candidates
   - rumorIndicators: ["匿名信源", "政策解读偏差", "煽动传播"]

2. **新建 `src/data/rumorCases/entertainmentRumor.ts`**：
   - `originalClaim`: "某知名演员因吸毒被捕，警方已证实"
   - `rumorType`: "娱乐"
   - 包含完整的 diagnosis、subclaims、routes、searchPlans、candidates
   - rumorIndicators: ["匿名信源", "明星八卦", "未经证实"]

3. **修改 `src/data/rumorCases/index.ts`**：
   - 导出新增的两个 case

4. **修改 `src/lib/schemas.ts`**：
   - `RumorType` 扩展为：`"健康" | "社会" | "科技" | "财经" | "政治" | "娱乐"`

5. **修改 `src/components/v3/Dashboard.tsx`**：
   - `DEMO_CASES` 数组新增 2 个案例卡片
   - 布局保持 3x2 网格

6. **修改 `src/lib/pipeline.ts`**：
   - `CASE_REGISTRY` 新增两个 case

7. **修改 `src/lib/evidenceRouter.ts`**（如果 Prompt 1-A 已完成）：
   - 路由表新增政治、娱乐类型的路由

**验收标准**：
- [ ] 6 类谣言类型在 TypeScript 中定义
- [ ] Dashboard 展示 6 个 Demo Case
- [ ] 每类谣言有完整的 Demo 数据
- [ ] 谣言检测 Agent 能识别新增类型的特征
- [ ] TypeScript 编译通过

---

### Prompt 2-B：纺锤体画布动态节点

**目标**：将当前静态 demo 画布改为根据 HandoffResult 动态生成纺锤体。

**上下文**：
- 当前 `src/data/reasoningCanvas.ts` 是静态数据
- 需要根据 HandoffResult 动态生成节点和边
- 节点需要状态动画（pending → running → completed）

**要求**：

1. **新建 `src/lib/spindleCanvasBuilder.ts`**：

```typescript
export interface SpindleLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function buildSpindleCanvas(
  claim: string,
  handoffResult: HandoffResult,
  options?: {
    includeSearchTrajectory?: boolean;
    includeConfidenceBar?: boolean;
  }
): SpindleLayout;

// 布局常量
export const SPINDLE_CONFIG = {
  entryY: 50,
  taxonomyY: 150,
  routeY: 250,
  expandY: 400,
  convergeY: 600,
  conclusionY: 750,
  nodeWidth: 200,
  nodeHeight: 120,
  horizontalSpacing: 250,
  centerX: 700,          // 画布中心 X（画布宽 1400）
};
```

2. **节点生成逻辑**：

```
Y=50    [claim-root] 主 claim 节点（蓝色，大）
         │
Y=150   [taxonomy-node] 谣言类型标签（小节点）
         │
Y=250   [route-plan] 证据路由规划（虚线框）
         │
Y=400   [rumor_detector] ──┬── [fact_checker] ──┬── [report_composer]
         （黄色脉冲）        │   （紫色脉冲）      │   （蓝色）
                            │                    │
         [evidence_nodes] ──┘                    │
         （Bento Card 风格）                       │
                                                 │
Y=600   [confidence-bar] 5维置信度条形图           │
         │                                        │
Y=750   [conclusion-node] 结论节点（颜色根据可信度）
```

3. **修改 `src/components/v3/ReasoningCanvasV3.tsx`**：
   - 支持动态传入 nodes/edges（而非仅使用静态 `canvasNodes`）
   - 当 `handoffResult` 存在时，使用 `buildSpindleCanvas()` 生成的布局
   - 保留静态数据作为 fallback

4. **修改 `src/components/v3/SuzhengNode.tsx`**：
   - 新增状态样式：`.node--pending`, `.node--running`, `.node--completed`, `.node--failed`
   - running 状态添加脉冲动画

5. **新增 CSS 动画（`src/styles.css`）**：

```css
.node--running {
  animation: node-pulse 1.5s ease-in-out infinite;
  border-color: var(--brand-blue);
}

@keyframes node-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--node-running-glow); }
  50% { box-shadow: 0 0 0 12px transparent; }
}

.node--completed {
  border-color: var(--success);
  box-shadow: 0 0 0 4px var(--node-completed-glow);
}

.node--failed {
  border-color: var(--danger);
}
```

6. **颜色编码规则**：
   - claim: `#2B7FD8`
   - rumor_detector: `#ffad47`
   - fact_checker: `#a479e2`
   - source_validator: `#43d692`
   - report_composer: `#4a86e8`
   - evidence_support: `#16a766`
   - evidence_counter: `#fb4c2f`
   - conclusion（高可信度）: `#16a766`
   - conclusion（中可信度）: `#ffad47`
   - conclusion（低可信度）: `#fb4c2f`

**验收标准**：
- [ ] 输入 claim 后画布动态生成纺锤体
- [ ] Agent 节点随执行状态变化（pending → running → completed）
- [ ] 节点颜色编码符合规范
- [ ] running 状态有脉冲动画
- [ ] 支持拖拽和缩放
- [ ] 点击节点显示详细信息
- [ ] TypeScript 编译通过

---

## Codex 执行注意事项

### 依赖安装

如果新增依赖，使用：

```bash
cd /Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp
npm install zod html-to-image
```

### 构建验证

每个 Prompt 完成后必须验证：

```bash
npm run build
```

### 代码风格

- 使用 TypeScript 严格模式
- 函数不超过 50 行
- 文件不超过 800 行
- 使用不可变更新（spread operator）
- 中文注释，英文变量名

### 与现有代码的集成

修改现有文件时，先读取文件内容，了解当前结构，再进行修改。不要删除现有功能，只做增量添加。

---

*Prompt 版本：v1.0 | 配套文档：IMPLEMENTATION.md + DESIGN_DECISIONS.md*
