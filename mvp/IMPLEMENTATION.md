# 红鲱鱼与枪 — 工程实施文档 v1.0

> 本文档面向 Codex / 子 Agent 实施，需严格按模块拆分执行。
> 当前日期：2026-05-30 | 项目路径：`/Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp`

---

## 一、项目定位与架构总览

### 1.1 产品定位

中文谣言核查 Agent，核心交互范式为 **"无限白板 + 纺锤体"**：
- **窄入口**：用户输入 claim
- **宽展开**：并行/串行 Agent 核查（谣言检测 → 事实核查 → 信源验证 → 报告生成）
- **窄收敛**：核查结论 + 闭环动作（生成报告 / 一键辟谣 / 存疑归档）

### 1.2 技术栈

| 层级 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 画布引擎 | @xyflow/react (React Flow) |
| 状态管理 | React Context + useReducer |
| 后端 API | Vite dev server middleware（非生产部署） |
| LLM 调用 | MiMo → DeepSeek → Anthropic 回退链 |
| 部署 | 纯静态（Vercel）+ API fallback 到 demo 数据 |

### 1.3 当前架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Dashboard │  │ Reasoning    │  │ ResultWorkspace      │  │
│  │ (入口)    │  │ WorkspaceV3  │  │ (报告+结论)          │  │
│  └────┬─────┘  │ (画布+Agent) │  └──────────────────────┘  │
│       │        └──────┬───────┘                              │
│       │               │                                      │
│       └───────────────┼──────────────────┐                  │
│                       ▼                  ▼                  │
│              ┌────────────────┐  ┌─────────────┐           │
│              │ reasoningStore │  │ agentExpansion│          │
│              │ (Context)      │  │ (API 层)      │          │
│              └────────────────┘  └──────┬──────┘           │
│                                          │                  │
└──────────────────────────────────────────┼──────────────────┘
                                           │
                              ┌────────────┴────────────┐
                              ▼                         ▼
                    ┌─────────────────┐      ┌─────────────────┐
                    │ /api/agent/*    │      │ demoData.ts     │
                    │ (Vite middleware)│      │ (fallback)      │
                    └─────────────────┘      └─────────────────┘
```

### 1.4 代码目录结构

```
src/
├── components/
│   ├── canvas/
│   │   └── layeredLayout.ts          # 画布自动布局
│   ├── ClaimInput.tsx                # 独立 claim 输入组件
│   └── v3/                           # ===== 主界面 v3 =====
│       ├── Dashboard.tsx             # 首页仪表盘（入口）
│       ├── ReasoningWorkspaceV3.tsx  # 主工作区（画布+面板）
│       ├── ReasoningCanvasV3.tsx     # @xyflow/react 画布
│       ├── SuzhengNode.tsx           # 自定义节点组件
│       ├── NodeInspectorV3.tsx       # 节点详情弹窗
│       ├── AgentTraceV3.tsx          # Agent 执行痕迹
│       ├── DiagnosisBanner.tsx       # 诊断横幅
│       ├── ReasoningIslandNav.tsx    # 岛屿导航
│       ├── ConclusionDockV3.tsx      # 底部结论坞
│       ├── ReportModal.tsx           # 报告弹窗
│       ├── panels/
│       │   ├── AgentPanel.tsx        # Agent 执行面板
│       │   ├── KnowledgePanel.tsx    # 知识面板（证据需求）
│       │   └── SettingsPanel.tsx     # 设置面板
│       └── phases/
│           ├── MissionControlView.tsx     # 任务总览
│           ├── EvidenceMap.tsx            # 证据地图
│           ├── ResultWorkspace.tsx        # 结果工作区
│           └── result/
│               ├── ReportPanel.tsx        # 报告面板
│               ├── SourceList.tsx         # 来源列表
│               └── CredibilityBadge.tsx   # 可信度徽章
├── data/
│   ├── reasoningCanvas.ts            # 画布静态 demo 数据
│   ├── demoCase.ts                   # 默认 demo case
│   └── rumorCases/                   # 4 类谣言 demo cases
│       ├── healthRumor.ts
│       ├── socialRumor.ts
│       ├── techRumor.ts
│       ├── financeRumor.ts
│       └── index.ts
├── lib/
│   ├── schemas.ts                    # ===== 核心类型定义 =====
│   ├── agentConfigs.ts               # Agent system prompt 配置
│   ├── agentExpansion.ts             # 前端 API 调用层
│   ├── demoData.ts                   # fallback demo 数据
│   ├── pipeline.ts                   # Demo pipeline 入口
│   ├── reportComposer.ts             # 报告生成逻辑
│   ├── reportExporter.ts             # 报告导出（MD/JSON）
│   ├── graderRules.ts                # 证据评分规则
│   ├── rumorDetection.ts             # 谣言检测逻辑
│   ├── sourceCredibility.ts          # 信源可信度评估
│   ├── sherlockStyleSearch.ts        # 深度搜索
│   └── mimoClient.ts                 # MiMo API 客户端
├── store/
│   └── reasoningStore.tsx            # ===== 全局状态 =====
├── App.tsx
└── main.tsx
```

---

## 二、当前状态审计：已完成 vs 缺失

### 2.1 已完成 ✅

| 模块 | 状态 | 文件 |
|---|---|---|
| 基础画布渲染 | ✅ | `ReasoningCanvasV3.tsx`, `SuzhengNode.tsx` |
| 4 类谣言 Demo Case | ✅ | `rumorCases/*.ts` |
| 多 Agent Handoff API | ✅ | `agentExpansion.ts` (5 个 API 函数) |
| Agent System Prompt 配置 | ✅ | `agentConfigs.ts` (4 个 Agent) |
| Demo Fallback 数据 | ✅ | `demoData.ts` |
| 报告导出（MD/JSON） | ✅ | `reportExporter.ts` |
| 可信度评分计算 | ✅ | `reportExporter.ts` |
| 项目重命名 | ✅ | "红鲱鱼与枪" |
| Dashboard 入口 | ✅ | `Dashboard.tsx` |
| 品牌统一 | ✅ | 所有文件已更新 |

### 2.2 缺失 / 待实施 ❌

按 **评分标准失分严重性** 排序：

| 优先级 | 模块 | 缺失内容 | 对应评分项 |
|---|---|---|---|
| **P0** | **Agent Memory / 知识库** | 只有 LocalStorage 评论，无向量检索、无历史 Case 记忆、无知识积累 | 技术架构 10% |
| **P0** | **360 生态集成** | 完全未接入 360 AI Search API | 技术架构 10% |
| **P0** | **结果闭环动作** | 只有导出报告，无一键辟谣、存疑归档、分享卡片 | 信息完整度 20% |
| **P1** | **谣言类型扩展** | 只有 4 类（健康/社会/科技/财经），缺 2 类 | 覆盖度 20% |
| **P1** | **纺锤体画布 UI** | 当前是固定 demo 节点，非动态纺锤体展开 | 用户体验 |
| **P1** | **FIRE 置信度驱动** | 当前固定 pipeline，无置信度迭代 | 技术架构 |
| **P2** | **Benchmark 面板** | 无准确率展示 | 性能表现 |

---

## 三、模块详细规格

---

### 模块 M1：Agent Memory / 知识库机制（P0）

**目标**：实现持久化、可检索的 Agent 记忆系统，替代当前仅存的 LocalStorage 评论。

#### 3.1.1 核心概念

引入 **"知识库 Agent"** 模式（受 Qwen-Agent 启发）：Memory 不是存储层，而是一个独立 Agent，负责：
1. 历史 Case 的向量化存储与检索
2. 相似 claim 的自动推荐
3. 证据库的累积与去重
4. 核查策略的记忆（哪些搜索 query 对哪类 claim 有效）

#### 3.1.2 数据模型

在 `src/lib/schemas.ts` 中新增：

```typescript
// ── 知识库核心类型 ────────────────────────────────────────────

export interface KnowledgeBaseEntry {
  id: string;                    // UUID
  claim: string;                 // 原始 claim
  claimEmbedding?: number[];     // 向量嵌入（简化版可用 hash）
  rumorType: RumorType | string; // 谣言类型
  diagnosis: ClaimDiagnosis;
  finalReport: FinalReport;
  handoffSteps: HandoffStep[];
  credibilityScore: number;
  verificationResult?: "true" | "false" | "partial" | "unknown";
  timestamp: number;
  tags: string[];
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
  effectiveQueries: string[];    // 对该类谣言有效的搜索 query
  ineffectiveQueries: string[];  // 无效的 query（避免重复）
  sourceDomains: string[];       // 高质量来源域名
  timestamp: number;
  useCount: number;
}
```

#### 3.1.3 存储层设计

采用 **分层存储**：

```
┌──────────────────────────────────────┐
│  Layer 1: In-Memory (Session)        │
│  - 当前会话的 Case 数据              │
│  - 快速检索，页面刷新丢失            │
├──────────────────────────────────────┤
│  Layer 2: LocalStorage (Persistent)  │
│  - 历史 Case 列表（仅元数据）        │
│  - 证据库条目                        │
│  - 搜索策略记忆                      │
├──────────────────────────────────────┤
│  Layer 3: IndexedDB (Structured)     │
│  - 完整 Case 数据（大对象）          │
│  - 向量化的 claim 索引（简化实现）   │
│  - 全文检索支持                      │
└──────────────────────────────────────┘
```

**实现策略**：不引入外部向量数据库，使用 **LocalStorage + 简单的相似度计算**（基于 rumorType + 关键词重叠）即可满足 hackathon 演示需求。

#### 3.1.4 接口定义

在 `src/lib/knowledgeBase.ts` 中实现（**新建文件**）：

```typescript
// ── 知识库操作接口 ────────────────────────────────────────────

export interface KnowledgeBase {
  // Case 管理
  saveCase(entry: KnowledgeBaseEntry): Promise<void>;
  getCase(id: string): Promise<KnowledgeBaseEntry | null>;
  listCases(filter?: { rumorType?: string; tag?: string }): Promise<KnowledgeBaseEntry[]>;
  findSimilarCases(claim: string, limit?: number): Promise<KnowledgeBaseEntry[]>;

  // 证据库
  addEvidence(evidence: EvidenceLibraryEntry): Promise<void>;
  findEvidence(query: string, options?: { role?: EvidenceRole; limit?: number }): Promise<EvidenceLibraryEntry[]>;

  // 搜索策略
  getSearchStrategy(rumorType: string): Promise<SearchStrategyMemory | null>;
  updateSearchStrategy(rumorType: string, updates: Partial<SearchStrategyMemory>): Promise<void>;

  // 统计
  getStats(): Promise<{ totalCases: number; totalEvidence: number; typeDistribution: Record<string, number> }>;
}

// 工厂函数
export function createKnowledgeBase(): KnowledgeBase;
```

#### 3.1.5 相似度计算（简化版）

不使用真实向量嵌入，使用 **多层匹配**：

```typescript
function calculateSimilarity(claimA: string, claimB: string): number {
  let score = 0;

  // 1. rumorType 匹配 +50
  // 2. 关键词重叠（Jaccard）+30
  // 3. 共同子串（最长公共子序列）+20

  return Math.min(100, score);
}
```

#### 3.1.6 与现有系统的集成点

1. **`reasoningStore.tsx`**：
   - `ReasoningState` 新增 `knowledgeBase: KnowledgeBase`
   - `ADD_CASE_TO_KNOWLEDGE_BASE` action
   - 用户完成核查后自动保存

2. **`Dashboard.tsx`**：
   - 输入 claim 时，显示 "相似历史 Case" 推荐卡片
   - 展示知识库统计（已核查 X 条，覆盖 Y 类谣言）

3. **`KnowledgePanel.tsx`**：
   - 从 "仅展示当前证据需求" 升级为 "展示历史证据库 + 推荐"

#### 3.1.7 验收标准

- [ ] 完成核查后自动保存到知识库
- [ ] Dashboard 输入时显示相似 Case 推荐
- [ ] KnowledgePanel 显示历史证据库
- [ ] 支持按谣言类型筛选历史 Case
- [ ] LocalStorage 持久化，页面刷新不丢失

---

### 模块 M2：360 生态集成（P0）

**目标**：接入 360 AI Search API，实现真实搜索能力。

#### 3.2.1 API 规格

根据用户提供的资料：

```
Endpoint: POST https://api.360.cn/v1/search/aisearch
Headers:
  Authorization: Bearer {360_API_KEY}
  Content-Type: application/json
Body:
  {
    "query": "搜索query",
    "model": "360gpt-pro",
    "stream": false
  }
```

#### 3.2.2 数据模型

在 `src/lib/schemas.ts` 中新增：

```typescript
export interface Search360Request {
  query: string;
  model?: string;
}

export interface Search360Response {
  answer: string;
  sources: Search360Source[];
  relatedQuestions: string[];
}

export interface Search360Source {
  title: string;
  url: string;
  snippet: string;
  credibility?: ScoreLevel;
}
```

#### 3.2.3 实现文件

**新建 `src/lib/search360.ts`**：

```typescript
export async function search360(request: Search360Request): Promise<Search360Response>;
export function search360Stream(request: Search360Request): AsyncGenerator<Search360StreamEvent>;
```

#### 3.2.4 与现有系统的集成

1. **`vite.config.ts` 后端**：
   - 新增 `/api/search/360` endpoint
   - 调用 360 API，返回标准化结果
   - 使用 `360_API_KEY` 环境变量

2. **`agentConfigs.ts`**：
   - FactChecker 和 SourceValidator 的 system prompt 中增加 "优先使用 360 搜索结果"

3. **`EvidenceMap.tsx` / `ReasoningCanvasV3.tsx`**：
   - 搜索轨迹可视化（显示搜索了哪些 query，返回了哪些来源）

#### 3.2.5 搜索轨迹可视化

在画布上新增 **"搜索轨迹"** 节点类型：

```typescript
type CanvasNodeType = ... | "search_trajectory";

interface SearchTrajectoryNode {
  query: string;
  resultCount: number;
  topSources: Search360Source[];
  timestamp: number;
}
```

#### 3.2.6 验收标准

- [ ] `/api/search/360` endpoint 可正常调用
- [ ] Agent 核查时自动触发 360 搜索
- [ ] 画布上显示搜索轨迹节点
- [ ] 搜索结果作为证据来源展示
- [ ] Demo fallback 模式下展示模拟搜索数据

---

### 模块 M3：结果闭环动作（P0）

**目标**：实现核查后的 3 个闭环动作 —— 生成辟谣卡片、存疑归档、一键分享。

#### 3.3.1 闭环动作定义

```typescript
export type ClosureAction =
  | "generate_rebuttal_card"   // 生成辟谣卡片（适合朋友圈/微博）
  | "archive_doubtful"         // 存疑归档（放入待验证库）
  | "share_verification"       // 分享核查链接/截图
  | "export_report";           // 导出详细报告（已有）

export interface RebuttalCard {
  title: string;               // "谣言：{claim摘要}"
  verdict: string;             // "已证伪" / "部分可信" / "存疑"
  color: string;               // 对应可信度颜色
  keyPoints: string[];         // 3 条核心反驳点
  sourceRef: string;           // "红鲱鱼与枪核查" + 时间戳
  qrCodeData?: string;         // 链接或标识
}
```

#### 3.3.2 UI 实现

修改 `ConclusionDockV3.tsx`：

当前底部坞只有 "导出报告"，需要扩展为 4 个按钮：

```
┌─────────────────────────────────────────────────────────────┐
│  [📝 导出报告]  [🎯 辟谣卡片]  [📦 存疑归档]  [🔗 分享核查]   │
└─────────────────────────────────────────────────────────────┘
```

**辟谣卡片弹窗**（新建 `RebuttalCardModal.tsx`）：
- 竖版卡片预览（类似手机截图）
- 核心 claim + 结论 + 3 条要点
- 底部品牌标识 "红鲱鱼与枪 · 信息真相猎人"
- 下载为 PNG / 复制图片到剪贴板

**存疑归档**（集成到 KnowledgeBase）：
- 标记 verificationResult = "unknown"
- 放入 "待验证队列"
- 可在 Dashboard 查看 "我的待验证"

**分享核查**：
- 生成可分享的 URL（带 claim hash）
- 复制链接 + 复制摘要文字

#### 3.3.3 验收标准

- [ ] 底部坞显示 4 个闭环动作按钮
- [ ] 辟谣卡片弹窗可预览和下载
- [ ] 存疑归档保存到知识库
- [ ] 分享功能生成可复制链接
- [ ] 所有动作都有 Demo fallback

---

### 模块 M4：谣言类型扩展（P1）

**目标**：从 4 类扩展到 6 类谣言。

#### 3.4.1 新增类型

当前：`健康` | `社会` | `科技` | `财经`

新增：
- `政治` — 政策解读偏差、领导人假消息
- `娱乐` — 明星谣言、影视剧伪消息

#### 3.4.2 Demo Case 数据

新建文件：
- `src/data/rumorCases/politicalRumor.ts`
- `src/data/rumorCases/entertainmentRumor.ts`

每个文件结构参考现有 4 个文件，包含：
- `originalClaim`
- `useContext`
- `rumorType`
- `diagnosis`（含 `rumorIndicators`）
- `subclaims[]`
- `routes[]`
- `searchPlans[]`
- `candidates[]`

#### 3.4.3 Dashboard 更新

在 `Dashboard.tsx` 的 `DEMO_CASES` 数组中新增 2 个案例卡片。

#### 3.4.4 验收标准

- [ ] 6 类谣言类型在 TypeScript 类型中定义
- [ ] Dashboard 展示 6 个 Demo Case
- [ ] 每类谣言有完整的 Demo 数据
- [ ] 谣言检测 Agent 能识别新增类型的特征

---

### 模块 M5：纺锤体画布 UI（P1）

**目标**：将当前固定 demo 画布改为动态纺锤体展开。

#### 3.5.1 纺锤体概念

```
        [输入 Claim]          ←── 窄入口（1个节点）
             │
             ▼
    ┌─────────────────┐
    │  谣言特征检测   │      ←── 纺锤开始展开
    └────────┬────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
 [事实核查]       [信源验证]    ←── 最宽处（并行 Agent）
    │                 │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │   综合报告生成   │      ←── 窄收敛
    └────────┬────────┘
             │
             ▼
      [结论 + 闭环动作]        ←── 最终输出
```

#### 3.5.2 动态节点生成

当前 `reasoningCanvas.ts` 是静态数据。需要改为 **根据 HandoffResult 动态生成**：

**新建 `src/lib/spindleCanvasBuilder.ts`**：

```typescript
export interface SpindleLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function buildSpindleCanvas(
  claim: string,
  handoffResult: HandoffResult
): SpindleLayout;

// 布局参数
const SPINDLE_CONFIG = {
  entryY: 50,           // 入口 Y 坐标
  expandY: 300,         // 展开层 Y 坐标
  convergeY: 600,       // 收敛层 Y 坐标
  conclusionY: 800,     // 结论 Y 坐标
  nodeWidth: 200,
  nodeHeight: 120,
  horizontalSpacing: 250,
};
```

#### 3.5.3 节点状态动画

每个 Agent 节点需要状态变化动画：

```css
/* 运行中：脉冲动画 */
.node--running {
  animation: pulse 1.5s infinite;
  border-color: #2B7FD8;
}

/* 完成：绿色边框 */
.node--completed {
  border-color: #16a766;
}

/* 失败：红色边框 */
.node--failed {
  border-color: #fb4c2f;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(43, 127, 216, 0.4); }
  50% { box-shadow: 0 0 0 10px rgba(43, 127, 216, 0); }
}
```

#### 3.5.4 颜色编码

| 节点类型 | 颜色 | 含义 |
|---|---|---|
| claim | `#2B7FD8` | 主 claim |
| rumor_detector | `#ffad47` | 检测中 |
| fact_checker | `#a479e2` | 事实核查 |
| source_validator | `#43d692` | 信源验证 |
| report_composer | `#4a86e8` | 报告生成 |
| evidence | `#16a766` / `#fb4c2f` | 支持 / 反驳 |
| conclusion | 根据可信度 | 高=绿，中=黄，低=红 |

#### 3.5.5 验收标准

- [ ] 输入 claim 后画布动态生成纺锤体
- [ ] Agent 节点随执行状态变化（pending → running → completed）
- [ ] 节点颜色编码符合规范
- [ ] 支持拖拽和缩放
- [ ] 点击节点显示详细信息

---

### 模块 M6：FIRE 置信度驱动迭代（P1）

**目标**：用置信度驱动的动态迭代替代固定 pipeline 步骤。

#### 3.6.1 FIRE 核心机制

受 FIRE 论文启发：不预设固定步骤，而是每次 Agent 执行后评估置信度，决定下一步动作。

```typescript
export interface ConfidenceAssessment {
  dimension: string;           // "source_reliability" | "evidence_completeness" | "consistency" | "recency" | "authority"
  score: number;               // 0-100
  threshold: number;           // 通过阈值
  passed: boolean;
  reason: string;
}

export interface IterationDecision {
  shouldContinue: boolean;     // 是否继续迭代
  nextAction: string;          // "search_more" | "verify_source" | "cross_check" | "conclude"
  reason: string;
  targetConfidence: number;
}
```

#### 3.6.2 5 维置信度评估

```typescript
const CONFIDENCE_DIMENSIONS = [
  { id: "source_reliability",   label: "来源可靠性",   threshold: 70 },
  { id: "evidence_completeness", label: "证据完整度",   threshold: 60 },
  { id: "consistency",          label: "逻辑一致性",   threshold: 75 },
  { id: "recency",              label: "信息时效性",   threshold: 50 },
  { id: "authority",            label: "权威匹配度",   threshold: 65 },
];
```

#### 3.6.3 集成到现有 Handoff

修改 `agentConfigs.ts` 中 ReportComposer 的 prompt，要求输出 5 维置信度评分。

在 `ReportPanel.tsx` 中展示置信度纺锤条：

```
来源可靠性    ████████████░░░░ 75%
证据完整度    ████████░░░░░░░░ 50%  ← 未达标，触发补充搜索
逻辑一致性    █████████████░░░ 85%
信息时效性    ███████████████░ 92%
权威匹配度    ██████████░░░░░░ 65%
```

#### 3.6.4 验收标准

- [ ] ReportComposer 输出 5 维置信度评分
- [ ] UI 展示置信度纺锤条
- [ ] 未达标维度自动触发补充 Agent 调用
- [ ] 迭代次数上限为 3 次（防止无限循环）

---

### 模块 M7：Benchmark 面板（P2）

**目标**：展示系统准确率，增强说服力。

#### 3.7.1 数据模型

```typescript
export interface BenchmarkMetrics {
  totalCases: number;
  accuracyRate: number;        // 人工复核准确率
  avgLatencyMs: number;
  coverageByType: Record<string, { total: number; correct: number }>;
  topSources: string[];        // 最常引用的权威来源
}
```

#### 3.7.2 UI 实现

新建 `src/components/v3/panels/BenchmarkPanel.tsx`：

- 总核查数 + 准确率大数字
- 按谣言类型的准确率柱状图
- 平均耗时趋势
- 最近核查历史（脱敏）

#### 3.7.3 验收标准

- [ ] 面板展示核心指标
- [ ] 数据来自知识库统计
- [ ] 有 Demo 数据 fallback

---

## 四、接口汇总

### 4.1 前端 API 层（`agentExpansion.ts`）

已有 5 个 API 函数，保持不变：

| 函数 | Endpoint | 用途 |
|---|---|---|
| `requestOrchestrate` | POST `/api/agent/orchestrate` | 多 Agent Handoff（串行） |
| `requestOrchestrateStream` | POST `/api/agent/orchestrate-stream` | SSE 流式 Handoff |
| `requestAgentExpansion` | POST `/api/agent/expand` | 单 Agent 扩展 |
| `requestRecursiveSearch` | POST `/api/agent/recursive-search` | 递归深度搜索 |
| `requestSherlockSearch` | POST `/api/agent/sherlock-search` | 深度信源搜索 |

**新增**：

| 函数 | Endpoint | 用途 |
|---|---|---|
| `request360Search` | POST `/api/search/360` | 360 AI Search |

### 4.2 后端 API 层（`vite.config.ts`）

已有 5 个 handler，需新增：

```typescript
// 新增
const search360Handler: RequestHandler = async (req, res) => { ... };

// 注册
app.post('/api/search/360', search360Handler);
```

### 4.3 全局状态（`reasoningStore.tsx`）

新增 State 字段：

```typescript
interface ReasoningState {
  // ... 已有字段

  // ── M1: 知识库 ──
  knowledgeBase: KnowledgeBase;
  knowledgeBaseStats: { totalCases: number; totalEvidence: number };

  // ── M6: 置信度 ──
  confidenceDimensions: ConfidenceAssessment[];
  iterationCount: number;
}
```

新增 Actions：

```typescript
type ReasoningAction =
  // ... 已有 actions
  | { type: "SAVE_TO_KNOWLEDGE_BASE"; payload: KnowledgeBaseEntry }
  | { type: "UPDATE_CONFIDENCE"; payload: ConfidenceAssessment[] }
  | { type: "SET_VERIFICATION_RESULT"; payload: VerificationResult }
  | { type: "ARCHIVE_DOUBTFUL"; payload: { claim: string; reason: string } };
```

---

## 五、实施顺序

```
Phase 1: 基础设施（所有后续模块依赖）
├── M1-A: KnowledgeBase 类型定义 (schemas.ts)
├── M1-B: KnowledgeBase 实现 (knowledgeBase.ts)
├── M2-A: 360 Search API 类型定义
├── M2-B: 360 Search 后端 endpoint (vite.config.ts)
└── M2-C: 360 Search 前端 API 层

Phase 2: P0 核心功能
├── M1-C: KnowledgeBase 与 reasoningStore 集成
├── M1-D: Dashboard 相似 Case 推荐
├── M1-E: KnowledgePanel 证据库展示
├── M2-D: Agent 调用 360 搜索
├── M2-E: 搜索轨迹画布可视化
├── M3-A: 闭环动作 UI (ConclusionDockV3)
├── M3-B: 辟谣卡片生成
├── M3-C: 存疑归档
└── M3-D: 分享功能

Phase 3: P1 增强功能
├── M4-A: 新增 2 类谣言 Demo Case
├── M4-B: Dashboard 案例卡片更新
├── M5-A: SpindleCanvasBuilder 动态布局
├── M5-B: 节点状态动画
├── M5-C: 颜色编码
└── M6-A: FIRE 置信度驱动（简化版）

Phase 4: P2  polish
├── M7-A: BenchmarkPanel
└── 端到端测试 + 浏览器验证
```

---

## 六、文件变更清单

### 6.1 新建文件

```
src/
├── lib/
│   ├── knowledgeBase.ts              # M1 知识库实现
│   ├── search360.ts                  # M2 360 搜索 API
│   ├── spindleCanvasBuilder.ts       # M5 纺锤体画布构建器
│   └── confidenceEngine.ts           # M6 置信度引擎
├── components/v3/
│   ├── RebuttalCardModal.tsx         # M3 辟谣卡片弹窗
│   └── panels/
│       └── BenchmarkPanel.tsx        # M7 基准面板
└── data/rumorCases/
    ├── politicalRumor.ts             # M4 政治谣言案例
    └── entertainmentRumor.ts         # M4 娱乐谣言案例
```

### 6.2 修改文件

```
src/
├── lib/
│   ├── schemas.ts                    # 新增 KnowledgeBase* / Search360* / Confidence* 类型
│   ├── agentConfigs.ts               # 更新 Agent prompt（360 搜索 + 置信度维度）
│   ├── agentExpansion.ts             # 新增 request360Search
│   └── demoData.ts                   # 新增 360 搜索 / 置信度 / 辟谣卡片 demo 数据
├── store/
│   └── reasoningStore.tsx            # 新增 knowledgeBase / confidence 状态
├── components/v3/
│   ├── Dashboard.tsx                 # 相似 Case 推荐 + 6 类谣言
│   ├── ReasoningWorkspaceV3.tsx      # 纺锤体画布集成
│   ├── ReasoningCanvasV3.tsx         # 动态节点生成
│   ├── ConclusionDockV3.tsx          # 4 个闭环动作按钮
│   ├── KnowledgePanel.tsx            # 历史证据库展示
│   └── phases/result/
│       └── ReportPanel.tsx           # 置信度纺锤条
├── data/
│   ├── reasoningCanvas.ts            # 颜色编码更新
│   └── rumorCases/index.ts           # 导出新增 2 类
└── App.tsx                           # 如有路由/布局调整

vite.config.ts                        # 新增 /api/search/360 endpoint
```

---

## 七、设计规范

### 7.1 颜色系统

```css
:root {
  --brand-blue: #2B7FD8;
  --bg-warm: #fefcf6;
  --success: #16a766;
  --warning: #ffad47;
  --danger: #fb4c2f;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border: #e5e5e5;
}
```

### 7.2 节点颜色编码

| 状态/类型 | 色值 | Tailwind 类 |
|---|---|---|
| 高风险/存疑 | `#fb4c2f` | `text-red-500` |
| 进行中 | `#2B7FD8` | `text-blue-500` |
| 支持/可信 | `#16a766` | `text-green-600` |
| 部分可信 | `#ffad47` | `text-amber-500` |
| 证据/线索 | `#a479e2` | `text-purple-500` |

### 7.3 动画规范

| 动画 | 时长 | 缓动 |
|---|---|---|
| 节点出现 | 300ms | `ease-out` |
| 状态切换 | 200ms | `ease-in-out` |
| 脉冲（运行中） | 1500ms | `ease-in-out` infinite |
| 抽屉展开 | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` |

---

## 八、验收清单

### 8.1 P0 验收（必须完成）

- [ ] **M1**：完成核查后知识库自动保存，Dashboard 显示相似推荐
- [ ] **M2**：360 搜索 API 调用成功，画布显示搜索轨迹
- [ ] **M3**：底部坞有 4 个闭环动作按钮，辟谣卡片可下载
- [ ] TypeScript 编译通过 (`npm run build`)
- [ ] 浏览器验证：选择案例 → 深度核查 → 看到 Agent 执行 → 生成报告 → 闭环动作可用

### 8.2 P1 验收（力争完成）

- [ ] **M4**：Dashboard 展示 6 类谣言案例
- [ ] **M5**：画布动态生成纺锤体，节点有状态动画
- [ ] **M6**：报告展示 5 维置信度纺锤条

### 8.3 P2 验收（加分项）

- [ ] **M7**：Benchmark 面板展示准确率统计

---

## 九、Codex 执行指南

### 9.1 任务拆分方式

将本文档按 **Phase** 拆分为独立任务，每个任务包含：
1. 目标（1 句话）
2. 涉及文件（新建 + 修改）
3. 接口定义（TypeScript 类型）
4. 实现逻辑（伪代码或关键逻辑说明）
5. 验收标准（ checklist ）

### 9.2 并行执行建议

可并行的任务组：
- **组 A**：M1（知识库）+ M2（360 搜索）→ 无依赖
- **组 B**：M3（闭环动作）+ M4（谣言扩展）→ 无依赖
- **组 C**：M5（纺锤体 UI）+ M6（置信度）→ 可在组 A 完成后开始

### 9.3 环境变量

```bash
# 360 AI Search
VITE_360_API_KEY=your_360_api_key

# 现有 LLM 配置（已在 vite.config.ts 中）
MIMO_API_KEY=...
DEEPSEEK_API_KEY=...
ANTHROPIC_API_KEY=...
```

### 9.4 测试命令

```bash
cd /Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp
npm run build    # TypeScript 编译 + Vite 构建
npm run dev      # 开发服务器（localhost:5173）
```

---

## 十、附录

### A. 现有 Demo Case 数据参考

每个 `rumorCases/*.ts` 文件导出一个 `DemoCase` 对象，结构：

```typescript
const case: DemoCase = {
  originalClaim: "...",
  rumorType: "健康",
  useContext: "...",
  diagnosis: {
    mixedJudgments: ["因果", ...],
    ambiguousTerms: ["隔夜菜", "致癌"],
    risk: "...",
    whyNotDirectFactCheck: "...",
    rumorIndicators: ["绝对化表述", "恐惧诉求"],
  },
  subclaims: [
    { id: "S1", text: "...", type: "因果", roleInArgument: "..." },
  ],
  routes: [...],
  searchPlans: [...],
  candidates: [...],
};
```

### B. Agent System Prompt 模板

参考 `agentConfigs.ts` 中已有格式，每个 Agent 包含：
- `id`, `name`, `icon`, `description`
- `systemPrompt`（中文，包含角色定义 + 输出格式要求）
- `responseSchema`（JSON Schema）
- `maxTokens`

### C. 画布节点类型定义

参考 `src/data/reasoningCanvas.ts`：

```typescript
type CanvasNodeType =
  | "claim"           // 主 claim
  | "judgment"        // 判断节点
  | "subclaim"        // 子命题
  | "evidence_need"   // 证据需求
  | "candidate_evidence" // 候选证据
  | "agent_task"      // Agent 任务
  | "evidence_clue"   // 证据线索
  | "search_frontier" // 搜索前沿
  | "search_stopped"  // 已停止搜索
  | "inference_license" // 推断许可
  | "rewrite";        // 改写

type CanvasNodeStatus =
  | "risk" | "active" | "supported" | "limited"
  | "blocked" | "rewrite" | "clue" | "frontier"
  | "stopped" | "controller" | "handoff";
```

---

*文档版本：v1.0 | 编写日期：2026-05-30 | 适用：赛道三 AI Agent 黑客松*
