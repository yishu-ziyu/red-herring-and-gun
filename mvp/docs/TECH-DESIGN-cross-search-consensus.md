# 技术设计文档：多搜索引擎交叉验证与 EvidenceConsensusAgent

## 1. 架构概览

### 1.1 数据流

```
用户输入 claim
  → Dashboard.onStartAnalysis(claim)
    → ReasoningWorkspaceV3
      → MissionControl（执行态）
        Phase 1: ClaimDecomposer
          → LLM 调用（StepFun/360智脑）
          → 输出：AtomicProposition[]
        
        Phase 2: EvidenceSearchRouter
          → 并行调用搜索 Provider
            → 360 Search API
            → AnySearch API（或 Mock）
            → Metaso Search API（或 Mock，默认关闭）
          → 聚合：MultiSearchJob[]
        
        Phase 3: EvidenceConsensusAgent
          → LLM 调用（带完整搜索结果）
          → 输出：EvidenceConsensusReport
          → 实时流式展示到 MissionControl
        
        Phase 4-7: 现有 Agent 流程
          → FactChecker（增强输入）
          → SourceValidator
          → ReportComposer
      
      → Evidence Graph（结果态）
        → EvidenceMatrix（全量展示）
        → EvidenceDetailDrawer（点击交互）
        → SourceIndependenceGraph（可视化）
```

### 1.2 模块依赖图

```
components/v3/
├── EvidenceMatrix.tsx ──────────┐
├── EvidenceDetailDrawer.tsx ◄───┤
├── ConsensusProgressPanel.tsx   │
│                                │
lib/                             │
├── evidenceConsensus.ts ────────┤
├── claimDecomposer.ts           │
├── evidenceSearchRouter.ts      │
├── sourceIndependence.ts        │
│                                │
store/                           │
├── reasoningStore.tsx ──────────┘
```

---

## 2. 类型定义（与现有 schemas.ts 衔接）

```typescript
// ── 新增：多搜索引擎交叉验证 ─────────────────────────────────────

export interface AtomicProposition {
  id: string;
  text: string;
  type: "事实陈述" | "因果推断" | "数值断言" | "归因断言";
  verifiability: "可直接验证" | "需间接推断" | "主观判断";
}

export interface ClaimDecompositionResult {
  originalClaim: string;
  atomicPropositions: AtomicProposition[];
  decompositionReasoning: string;
}

export interface MultiSearchJob {
  jobId: string;
  propositionId: string;
  propositionText: string;
  searchTasks: SearchTask[];
}

export interface SearchTask {
  provider: "360_search" | "any_search" | "metaso_search";
  query: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: SearchProviderResult;
}

export interface SearchProviderResult {
  provider: string;
  query: string;
  sources: SearchResultSource[];
  answer?: string;
  latencyMs: number;
}

export interface SearchResultSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
  sourceType: SearchSourceType;
}

export type ConsensusStatus = "可进入推理" | "存疑" | "需人工复核";

export interface EvidenceConsensusReport {
  consensusId: string;
  timestamp: number;
  propositionResults: PropositionConsensusResult[];
  overallStats: ConsensusStats;
}

export interface PropositionConsensusResult {
  propositionId: string;
  propositionText: string;
  status: ConsensusStatus;
  statusReason: string;
  evidenceIndependence: EvidenceIndependenceAssessment;
  sourceTierDistribution: SourceTierDistribution;
  counterEvidenceCoverage: CounterEvidenceCoverage;
  providerResults: ProviderConsensusResult[];
  independentSources: IndependentSource[];
  meetsMinimumCriteria: MinimumCriteriaCheck;
}

export interface EvidenceIndependenceAssessment {
  totalSources: number;
  independentSources: number;
  duplicateSources: number;
  independenceScore: number;
  reasoning: string;
}

export interface SourceTierDistribution {
  government: number;
  academic: number;
  media: number;
  selfMedia: number;
  forum: number;
  unknown: number;
  highestTierFound: "government" | "academic" | "media" | "selfMedia" | "forum" | "unknown";
}

export interface CounterEvidenceCoverage {
  counterSearchPerformed: boolean;
  counterEvidenceFound: boolean;
  counterEvidenceCount: number;
  counterEvidenceSources: string[];
  verdict: "反证已覆盖" | "暂未发现反证" | "反证检索未执行";
}

export interface ProviderConsensusResult {
  provider: string;
  sourceCount: number;
  relevantSources: number;
  supportsProposition: boolean | null;
  contradictsProposition: boolean | null;
  topSourceUrl: string;
}

export interface IndependentSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: SearchSourceType;
  isOriginalSource: boolean;
  originalSourceUrl?: string;
  supports: boolean;
  contradicts: boolean;
  providerOrigins: string[];
}

export interface MinimumCriteriaCheck {
  criteria1_minProviders: boolean;
  criteria2_hasHighTierOrOriginal: boolean;
  criteria3_counterSearchDone: boolean;
  criteria4_duplicatesCountedOnce: boolean;
  allMet: boolean;
}

export interface ConsensusStats {
  totalPropositions: number;
  readyForReasoning: number;
  doubtful: number;
  needsManualReview: number;
  totalIndependentSources: number;
  totalDuplicateSources: number;
  counterEvidenceSearchesPerformed: number;
}

// ── 扩展：HandoffStep ────────────────────────────────────────────

// 在 agentConfigs.ts 的 HandoffStep 中增加：
export interface HandoffStep {
  // ... 现有字段
  consensusReport?: EvidenceConsensusReport; // 新增
  searchJobs?: MultiSearchJob[]; // 新增
}

// ── 扩展：ReasoningState ────────────────────────────────────────

// 在 reasoningStore.tsx 中增加：
export interface ReasoningState {
  // ... 现有字段
  consensusReport: EvidenceConsensusReport | null; // 新增
  searchJobs: MultiSearchJob[]; // 新增
  claimDecomposition: ClaimDecompositionResult | null; // 新增
}

// 新增 Action 类型：
export type ReasoningAction =
  // ... 现有 actions
  | { type: "SET_CLAIM_DECOMPOSITION"; payload: ClaimDecompositionResult }
  | { type: "SET_SEARCH_JOBS"; payload: MultiSearchJob[] }
  | { type: "SET_CONSENSUS_REPORT"; payload: EvidenceConsensusReport }
  | { type: "UPDATE_SEARCH_TASK"; payload: { jobId: string; provider: string; result: SearchProviderResult } }
  | { type: "UPDATE_CONSENSUS_STATUS"; payload: { propositionId: string; status: ConsensusStatus } };
```

---

## 3. 后端 API 设计

### 3.1 新增端点

```
POST /api/agent/claim-decompose
  Request: { claim: string }
  Response: { success: true, data: ClaimDecompositionResult }

POST /api/agent/multi-search
  Request: { 
    propositionId: string,
    propositionText: string,
    providers: ["360_search", "any_search", "metaso_search"]
  }
  Response: { success: true, data: MultiSearchJob }
  // 流式：SSE 推送每个 provider 的完成状态

POST /api/agent/evidence-consensus
  Request: { 
    claim: string,
    decomposition: ClaimDecompositionResult,
    searchJobs: MultiSearchJob[]
  }
  Response: { success: true, data: EvidenceConsensusReport }
  // 流式：SSE 推送分析进度和最终结果
```

### 3.2 与现有 orchestrate 流程的衔接

建议新增一个专门的 orchestrate 端点：

```
POST /api/agent/orchestrate-with-consensus
  Request: { claim: string, enableConsensus: boolean }
  Response: HandoffResult（含 consensusReport 字段）
```

或者在现有 `orchestrate-stream` 中增加阶段：

```
现有阶段：rumor_detector → 360_search → fact_checker → source_validator → report_composer
新增阶段：claim_decomposer → evidence_search_router → evidence_consensus_agent
```

### 3.3 搜索 Provider 接口抽象

```typescript
interface SearchProvider {
  name: string;
  enabled: boolean;
  search(query: string): Promise<SearchProviderResult>;
}

// 实现：
class Search360Provider implements SearchProvider {
  name = "360_search";
  enabled = true;
  async search(query: string): Promise<SearchProviderResult> {
    // 复用现有 search360.ts
    const result = await request360Search({ query });
    return transform360Result(result);
  }
}

class AnySearchProvider implements SearchProvider {
  name = "any_search";
  enabled = false; // MVP 中默认关闭，使用 mock
  async search(query: string): Promise<SearchProviderResult> {
    // TODO: 接入 AnySearch API
    return mockAnySearchResult(query);
  }
}

class MetasoSearchProvider implements SearchProvider {
  name = "metaso_search";
  enabled = false; // 仅本地测试
  async search(query: string): Promise<SearchProviderResult> {
    // TODO: 接入 Metaso API
    return mockMetasoResult(query);
  }
}
```

---

## 4. 前端组件设计

### 4.1 EvidenceMatrix

```typescript
interface EvidenceMatrixProps {
  consensusReport: EvidenceConsensusReport;
  searchJobs: MultiSearchJob[];
  onCellClick: (propositionId: string, provider: string) => void;
  onStatusClick: (propositionId: string) => void;
  onIndependenceClick: (propositionId: string) => void;
}

// 状态管理：
// - 无内部状态，纯展示组件
// - 数据来自 props
// - 交互通过回调通知父组件
```

**渲染性能优化**：
- 使用 `React.memo` 避免不必要的重渲染
- 单元格使用 CSS Grid 布局，避免 table 的 reflow 问题
- 虚拟滚动：当原子命题 > 20 个时启用

### 4.2 EvidenceDetailDrawer

```typescript
interface EvidenceDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  propositionId: string;
  provider: string; // 或 "all" 表示该命题的所有 Provider
  consensusReport: EvidenceConsensusReport;
  searchJobs: MultiSearchJob[];
}

// 内部状态：
// - activeTab: "overview" | "sourceChain" | "timeline" | "agentReasoning"
```

**动画规格**：
- 打开：300ms ease-out，transform: translateX(100%) → translateX(0)
- 关闭：200ms ease-in，transform: translateX(0) → translateX(100%)
- 遮罩：opacity 0 → 0.5，200ms

### 4.3 ConsensusProgressPanel

```typescript
interface ConsensusProgressPanelProps {
  decomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  isAnalyzing: boolean;
}

// 展示阶段：
// 1. 拆解中（decomposition 为 null）
// 2. 搜索中（searchJobs 有任务未 completed）
// 3. 共识分析中（consensusReport 为 null）
// 4. 分析完成（consensusReport 存在）
```

---

## 5. 状态管理设计

### 5.1 ReasoningStore 扩展

```typescript
// 新增到 initialState：
export const initialState: ReasoningState = {
  // ... 现有字段
  consensusReport: null,
  searchJobs: [],
  claimDecomposition: null,
};

// 新增 Reducer 处理：
case "SET_CLAIM_DECOMPOSITION":
  return { ...state, claimDecomposition: action.payload };

case "SET_SEARCH_JOBS":
  return { ...state, searchJobs: action.payload };

case "UPDATE_SEARCH_TASK": {
  const { jobId, provider, result } = action.payload;
  return {
    ...state,
    searchJobs: state.searchJobs.map((job) =>
      job.jobId === jobId
        ? {
            ...job,
            searchTasks: job.searchTasks.map((task) =>
              task.provider === provider ? { ...task, status: "completed", result } : task
            ),
          }
        : job
    ),
  };
}

case "SET_CONSENSUS_REPORT":
  return { ...state, consensusReport: action.payload };
```

### 5.2 新增 Selector

```typescript
export function selectConsensusReadyPropositions(state: ReasoningState): PropositionConsensusResult[] {
  return state.consensusReport?.propositionResults.filter((r) => r.status === "可进入推理") ?? [];
}

export function selectSearchProgress(state: ReasoningState): {
  total: number;
  completed: number;
  failed: number;
} {
  const allTasks = state.searchJobs.flatMap((j) => j.searchTasks);
  return {
    total: allTasks.length,
    completed: allTasks.filter((t) => t.status === "completed").length,
    failed: allTasks.filter((t) => t.status === "failed").length,
  };
}
```

---

## 6. Mock 数据设计（MVP Demo）

### 6.1 Mock 场景

使用一个具体的谣言案例作为 Demo 数据：

```
Claim: "清华大学食堂推出 AI营养师配餐系统，学生使用后营养不良率下降30%"

分解：
- 命题 A：清华大学食堂是否推出了 AI 营养师配餐系统
- 命题 B：该系统是否使用了 AI 技术
- 命题 C：使用学生营养不良率是否下降了 30%

搜索结果（Mock）：
- 360 Search：
  - 来源 1：XX新闻网 — 报道清华食堂数字化改造（2024-03-16）
  - 来源 2：知乎 — 用户讨论（2024-03-17）
  - 来源 3：学校官网公告（2024-03-15）
- AnySearch：
  - 来源 1：另一媒体报道（引用同一学校公告）
  - 来源 2：微信公众号转载（2024-03-18）

共识分析（Mock）：
- 命题 A：
  - 360 Search 支持，AnySearch 支持
  - 但 AnySearch 的来源 1 是转载（引用学校官网）
  - 独立来源：学校官网 + 知乎讨论 = 2 个
  - 原始来源：学校官网（Tier 1）
  - 反证：暂未发现
  - 状态：🟢 可进入推理

- 命题 B：
  - 搜索结果未明确提及 AI 技术
  - 状态：🟡 存疑

- 命题 C：
  - 360 Search 未找到数据
  - AnySearch 找到一篇论文但已过期（2019年）
  - 状态：🔴 需人工复核
```

### 6.2 Mock 数据文件

`src/data/mockEvidenceConsensus.ts`

包含完整的 `ClaimDecompositionResult`、`MultiSearchJob[]`、`EvidenceConsensusReport` 三个对象，用于 MVP Demo 演示。

---

## 7. 性能优化

### 7.1 搜索并行化

```typescript
// EvidenceSearchRouter 中：
async function executeMultiSearch(jobs: MultiSearchJob[]): Promise<MultiSearchJob[]> {
  const providerMap = {
    "360_search": new Search360Provider(),
    "any_search": new AnySearchProvider(),
    "metaso_search": new MetasoSearchProvider(),
  };

  // 所有任务并行执行
  const promises = jobs.flatMap((job) =>
    job.searchTasks
      .filter((task) => providerMap[task.provider]?.enabled)
      .map(async (task) => {
        const result = await providerMap[task.provider].search(task.query);
        return { jobId: job.jobId, provider: task.provider, result };
      })
  );

  const results = await Promise.allSettled(promises);
  // 处理结果，更新 jobs
  return updateJobsWithResults(jobs, results);
}
```

### 7.2 LLM 调用优化

- **缓存**：相同 claim 的共识结果缓存 1 小时（使用 claim hash 作为 key）
- **流式**：EvidenceConsensusAgent 使用 SSE 流式输出，减少等待焦虑
- **降级**：LLM 超时 > 10 秒时，回退到规则引擎

### 7.3 前端渲染优化

- EvidenceMatrix 使用 CSS Grid + `contain: layout` 隔离重渲染
- EvidenceDetailDrawer 使用 `lazy` 加载 Tab 内容
- 图片/图标使用 SVG 内联，避免网络请求

---

## 8. 错误处理

### 8.1 搜索 Provider 失败

```typescript
// 单个 Provider 失败不影响其他 Provider
const results = await Promise.allSettled(promises);
results.forEach((result, index) => {
  if (result.status === "rejected") {
    console.error(`Provider ${providers[index]} failed:`, result.reason);
    // 记录失败，但不阻塞其他 Provider
  }
});
```

### 8.2 LLM 超时

```typescript
const CONSENSUS_TIMEOUT = 15000; // 15 秒

async function callEvidenceConsensusAgent(input) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("LLM_TIMEOUT")), CONSENSUS_TIMEOUT)
  );

  try {
    const result = await Promise.race([
      callLLM(input),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    if (error.message === "LLM_TIMEOUT") {
      return fallbackRuleBasedConsensus(input);
    }
    throw error;
  }
}
```

### 8.3 降级规则引擎

```typescript
function fallbackRuleBasedConsensus(searchJobs: MultiSearchJob[]): EvidenceConsensusReport {
  // 简化规则：
  // - 来源数量 > 3 → 可进入推理
  // - 来源数量 1-3 → 存疑
  // - 来源数量 0 → 需人工复核
  // - 不考虑独立性、来源等级
  return {
    // ... 基于规则的简化评估
  };
}
```

---

## 9. 测试策略

### 9.1 单元测试

| 模块 | 测试点 | 覆盖率目标 |
|------|--------|-----------|
| `claimDecomposer.ts` | 拆解逻辑、边界情况 | 80% |
| `sourceIndependence.ts` | 去重算法、独立性判断 | 90% |
| `evidenceConsensus.ts` | 状态判定逻辑 | 80% |
| `EvidenceMatrix.tsx` | 渲染、交互回调 | 70% |
| `EvidenceDetailDrawer.tsx` | Tab 切换、关闭 | 70% |

### 9.2 集成测试

- 完整流程：Claim → Decompose → Search → Consensus → Display
- Mock Provider 失败后的降级行为
- 流式输出的正确性

### 9.3 E2E 测试

- 用户输入 claim → 看到证据矩阵 → 点击单元格 → 查看详情 → 关闭抽屉
- 演示流程：≤ 3 分钟内完成

---

## 10. 实现顺序（MVP Demo）

```
Phase 1: 基础类型和 Mock 数据
  1.1 新增 schemas.ts 类型（ EvidenceConsensusReport 等）
  1.2 创建 mockEvidenceConsensus.ts
  1.3 更新 reasoningStore.tsx（新增 actions 和 state 字段）

Phase 2: 核心组件
  2.1 EvidenceMatrix.tsx
  2.2 EvidenceDetailDrawer.tsx
  2.3 ConsensusProgressPanel.tsx

Phase 3: 业务逻辑
  3.1 claimDecomposer.ts（Mock 实现）
  3.2 evidenceSearchRouter.ts（Mock 实现）
  3.3 evidenceConsensus.ts（Mock 实现）

Phase 4: 集成
  4.1 在 ReasoningWorkspaceV3 中集成新组件
  4.2 新增 Demo 入口（一键加载 Mock 数据）
  4.3 样式调整

Phase 5: 验收
  5.1 运行验证
  5.2 截图记录
  5.3 用户验收
```

---

## 11. 与现有代码的修改清单

### 只读文件（不修改）

- `agentConfigs.ts` — 本次 MVP Demo 中不新增真实 Agent 配置
- `confidenceEngine.ts` — 本次不扩展 FIRE 评分
- `vite.config.ts` — 本次不新增后端端点（使用 Mock 数据）

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/lib/schemas.ts` | 追加新类型定义 |
| `src/store/reasoningStore.tsx` | 追加 state 字段、actions、reducer 处理 |
| `src/components/v3/ReasoningWorkspaceV3.tsx` | 集成 EvidenceMatrix 和 ConsensusProgressPanel |
| `src/components/v3/Dashboard.tsx` | 可选：新增"演示多源交叉验证"按钮 |

### 新增文件

```
src/
├── data/
│   └── mockEvidenceConsensus.ts
├── lib/
│   ├── claimDecomposer.ts
│   ├── evidenceSearchRouter.ts
│   ├── evidenceConsensus.ts
│   └── sourceIndependence.ts
└── components/v3/
    ├── EvidenceMatrix.tsx
    ├── EvidenceDetailDrawer.tsx
    ├── ConsensusProgressPanel.tsx
    └── SourceIndependenceGraph.tsx
```
