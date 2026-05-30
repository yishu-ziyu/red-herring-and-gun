# PRD：多搜索引擎交叉验证与 EvidenceConsensusAgent

## 1. 产品背景与目标

### 1.1 评分标准映射

赛题评分中 **30% 为结果准确性**，要求产品展示出可靠的核查路径：溯源、交叉验证、逻辑推演、证据链呈现。

当前产品已有基础流程，但在"交叉验证"维度上存在明显短板：

| 当前状态 | 问题 |
|---------|------|
| 仅 360 Search 单搜索引擎 | 覆盖范围有限，无法展示"多源交叉"能力 |
| FactChecker 直接基于搜索结果推理 | 缺少对"多源是否独立""是否转载同源"的分析环节 |
| 缺少来源分级可视化 | 评委无法直观看到"权威来源 vs 自媒体"的区别 |
| 缺少反证搜索的独立流程 | 反证检索不够显性化，容易被忽略 |

### 1.2 核心目标

引入多搜索引擎交叉验证机制，不是为了"搜索结果一致所以为真"，而是：

1. **展示核查路径的透明度** — 让评委看到"我们是怎么判断的"
2. **区分"表层一致"与"深层独立"** — 同一篇文章被多个搜索引擎收录 ≠ 多个独立证据
3. **强化反证覆盖** — 没有找到反证 ≠ 没有反证，要显式说明搜索范围
4. **提升可信度表达的精确性** — 用"证据链完整度"替代"多源一致"

### 1.3 一句话产品定位

> 不是"搜索结果一样就说明是真的"，而是"我们追溯了原始来源、判断了来源独立性、覆盖了反证搜索，才给出结论"。

---

## 2. 用户故事

### 2.1 评委视角（演示场景）

> 作为评委，我在 3 分钟演示中需要快速理解：
> - 这个产品不是在用 AI 瞎编结论
> - 它展示了清晰的核查路径
> - 它能区分"多源转载"和"多源独立验证"
> - 它对反证搜索有显式处理

**关键场景**：输入一个谣言案例，产品在 30 秒内展示：
1. 拆解为原子命题
2. 多搜索引擎并行检索
3. 来源去重与独立性判断
4. 证据矩阵展示
5. 基于证据链完整度的结论

### 2.2 用户视角（使用场景）

> 作为普通用户，我输入一条朋友圈看到的信息，想知道它是不是真的。
> 我不需要理解技术细节，但需要看到：
> - 有哪些来源支持这个说法
> - 这些来源是否可靠
> - 有没有反驳的声音
> - 为什么结论是"可进入推理"还是"存疑"

**关键场景**：用户看到证据矩阵中某条标为"🔴 需人工复核"，点击后看到：
- 原始来源已过期
- 多个搜索引擎引用的是同一篇转载
- 反证检索未发现 → "暂未发现反证"（不是"没有反证"）

---

## 3. 核心功能定义

### 3.1 新增 Agent 流程（MVP 版）

```
ClaimDecomposer
  → EvidenceSearchRouter
    → 360 Search（主检索，赛题生态联动评分项）
    → AnySearch（交叉验证，扩大覆盖）
    → Metaso Search（实验性，仅本地测试）
  → EvidenceConsensusAgent
    → FactChecker
    → SourceValidator
    → ReportComposer
```

### 3.2 各 Agent 职责

#### ClaimDecomposer（Claim 拆解器）

**输入**：用户原始 claim
**输出**：`ClaimDecompositionResult`

```typescript
interface ClaimDecompositionResult {
  originalClaim: string;
  atomicPropositions: AtomicProposition[];
  decompositionReasoning: string;
}

interface AtomicProposition {
  id: string;
  text: string;
  type: "事实陈述" | "因果推断" | "数值断言" | "归因断言";
  verifiability: "可直接验证" | "需间接推断" | "主观判断";
}
```

**职责**：
- 将复杂 claim 拆分为可独立验证的原子命题
- 识别哪些部分需要事实验证，哪些是主观判断
- 为每个原子命题分配唯一 ID（后续证据矩阵的行标识）

**示例**：
```
输入："清华大学食堂推出"AI营养师"配餐系统，学生使用后营养不良率下降30%"
输出：
- 命题 A：清华大学食堂是否推出了"AI营养师"配餐系统
- 命题 B：该配餐系统是否使用了 AI 技术
- 命题 C：使用该系统的学生营养不良率是否下降了 30%
```

#### EvidenceSearchRouter（证据搜索路由器）

**输入**：`ClaimDecompositionResult`
**输出**：`MultiSearchJob`

```typescript
interface MultiSearchJob {
  jobId: string;
  propositionId: string;
  propositionText: string;
  searchTasks: SearchTask[];
}

interface SearchTask {
  provider: "360_search" | "any_search" | "metaso_search";
  query: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: SearchProviderResult;
}

interface SearchProviderResult {
  provider: string;
  query: string;
  sources: SearchResultSource[];
  answer?: string;
  latencyMs: number;
}

interface SearchResultSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
  sourceType: SearchSourceType; // 复用现有类型
}
```

**职责**：
- 为每个原子命题生成搜索查询（支持/反证各一组）
- 并行调度多个搜索 Provider
- 统一管理搜索进度和结果聚合

#### EvidenceConsensusAgent（证据共识分析器）

**输入**：`MultiSearchJob[]`（所有原子命题的搜索结果）
**输出**：`EvidenceConsensusReport`

```typescript
interface EvidenceConsensusReport {
  consensusId: string;
  timestamp: number;
  propositionResults: PropositionConsensusResult[];
  overallStats: ConsensusStats;
}

interface PropositionConsensusResult {
  propositionId: string;
  propositionText: string;
  status: "可进入推理" | "存疑" | "需人工复核";
  statusReason: string;

  // 三维度评估
  evidenceIndependence: EvidenceIndependenceAssessment;
  sourceTierDistribution: SourceTierDistribution;
  counterEvidenceCoverage: CounterEvidenceCoverage;

  // 搜索 Provider 结果汇总
  providerResults: ProviderConsensusResult[];

  // 去重后的独立来源
  independentSources: IndependentSource[];

  // 推荐的最低条件检查
  meetsMinimumCriteria: MinimumCriteriaCheck;
}

interface EvidenceIndependenceAssessment {
  totalSources: number;
  independentSources: number;
  duplicateSources: number; // 转载同源的数量
  independenceScore: number; // 0-100
  reasoning: string;
}

interface SourceTierDistribution {
  government: number;
  academic: number;
  media: number;
  selfMedia: number;
  forum: number;
  unknown: number;
  highestTierFound: "government" | "academic" | "media" | "selfMedia" | "forum" | "unknown";
}

interface CounterEvidenceCoverage {
  counterSearchPerformed: boolean;
  counterEvidenceFound: boolean;
  counterEvidenceCount: number;
  counterEvidenceSources: string[];
  verdict: "反证已覆盖" | "暂未发现反证" | "反证检索未执行";
}

interface ProviderConsensusResult {
  provider: string;
  sourceCount: number;
  relevantSources: number;
  supportsProposition: boolean | null; // null = 无法判断
  contradictsProposition: boolean | null;
  topSourceUrl: string;
}

interface IndependentSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: SearchSourceType;
  isOriginalSource: boolean;
  originalSourceUrl?: string;
  supports: boolean;
  contradicts: boolean;
  providerOrigins: string[]; // 哪些搜索引擎返回了这个来源
}

interface MinimumCriteriaCheck {
  criteria1_minProviders: boolean; // 至少 2 个 Provider 返回相关来源
  criteria2_hasHighTierOrOriginal: boolean; // 至少 1 个高可信来源或原始来源
  criteria3_counterSearchDone: boolean; // 已执行反证搜索
  criteria4_duplicatesCountedOnce: boolean; // 转载源只算 1 个
  allMet: boolean;
}

interface ConsensusStats {
  totalPropositions: number;
  readyForReasoning: number;
  doubtful: number;
  needsManualReview: number;
  totalIndependentSources: number;
  totalDuplicateSources: number;
  counterEvidenceSearchesPerformed: number;
}
```

**核心判断逻辑**（不做简单多数投票）：

```
对于每个原子命题：
  1. 收集所有 Provider 的搜索结果
  2. 按 URL + 标题去重（同一篇文章不同搜索引擎收录 = 1 个来源）
  3. 判断来源独立性：
     - 如果来源 A 和来源 B 都引用了同一原始出处 → 不独立
     - 如果来源 A 和来源 B 独立报道了同一事件 → 独立
  4. 来源分级：
     - Tier 1: 政府官网、学术期刊、国际组织
     - Tier 2: 权威媒体、知名智库
     - Tier 3: 普通媒体、自媒体
     - Tier 4: 论坛、社交平台
  5. 原始来源追溯：
     - 新闻报道是否引用了原始公告/论文/数据？
     - 追溯到 Tier 1 来源了吗？
  6. 反证覆盖：
     - 执行了反证搜索吗？
     - 找到反证了吗？
     - 没找到 → "暂未发现反证"（不是"没有反证"）
  7. 时间线一致性：
     - 各来源的时间戳是否一致？
     - 有没有"穿越"的引用？

状态判定：
  🟢 可进入推理：
     - 满足最低条件 1-4
     - 独立性评分 ≥ 60
     - 有 Tier 1/2 来源或可追溯原始来源
     
  🟡 存疑：
     - 满足最低条件 1-3
     - 但发现明确反证
     - 或来源独立性评分 < 40
     
  🔴 需人工复核：
     - 不满足最低条件 1 或 3
     - 或来源全部来自 Tier 3/4
     - 或原始来源已过期/失效
```

### 3.3 与现有 Agent 的衔接

EvidenceConsensusAgent 的输出作为 FactChecker 的输入增强：

```typescript
// FactChecker 输入增强
interface FactCheckerInput {
  claim: string;
  rumorIndicators: string[];
  severity: string;
  // 新增：EvidenceConsensusAgent 的结果
  evidenceConsensus?: {
    propositionResults: PropositionConsensusResult[];
    overallStats: ConsensusStats;
  };
}
```

FactChecker 利用 consensus 结果：
- 优先使用"可进入推理"的原子命题进行逻辑推演
- 对"存疑"的命题标注需要特别说明的限定条件
- 不基于"需人工复核"的命题做任何推断

---

## 4. UI/UX 详细规格

### 4.1 新增页面/组件清单

| 组件名 | 类型 | 位置 | 说明 |
|--------|------|------|------|
| `EvidenceMatrix` | 新组件 | MissionControl + EvidenceGraph | 核心交互组件 |
| `EvidenceDetailDrawer` | 新组件 | EvidenceMatrix 内嵌 | 点击证据单元展开 |
| `ConsensusProgressPanel` | 新组件 | MissionControl | 实时共识分析进度 |
| `SourceIndependenceGraph` | 新组件 | EvidenceGraph | 来源独立性可视化 |
| `ClaimDecomposerDisplay` | 新组件 | MissionControl | 原子命题展示 |
| `MultiSearchStatusBar` | 新组件 | MissionControl | 多搜索 Provider 状态 |

### 4.2 EvidenceMatrix（证据矩阵）

#### 布局规格

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📊 证据矩阵 — 多搜索引擎交叉验证                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  共识概览：                                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │ 可进入推理    │ │ 存疑         │ │ 需人工复核    │               │
│  │    2 项      │ │   1 项       │ │    0 项      │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
│                                                                      │
│  ┌──────────┬────────┬───────────┬──────────┬────────┬────────┬────────┐ │
│  │ 原子命题 │ 360    │ AnySearch │ 原始来源 │ 反证   │ 独立性 │ 状态   │ │
│  ├──────────┼────────┼───────────┼──────────┼────────┼────────┼────────┤ │
│  │ 命题 A   │ ✅支持 │ ✅支持    │ ✅找到   │ 🚫未发现│ 80%   │ 🟢    │ │
│  │          │ 3 来源 │ 2 来源    │ 政府公告 │        │       │ 可进入 │ │
│  ├──────────┼────────┼───────────┼──────────┼────────┼────────┼────────┤ │
│  │ 命题 B   │ ❓未证实│ ❌反驳   │ ❌未找  │ ✅找到  │ —     │ 🟡    │ │
│  │          │ 0 来源 │ 1 来源    │          │ 1 来源 │       │ 存疑   │ │
│  ├──────────┼────────┼───────────┼──────────┼────────┼────────┼────────┤ │
│  │ 命题 C   │ ✅支持 │ 🔁转载   │ ⚠️过期  │ 🚫未发现│ 20%   │ 🔴    │ │
│  │          │ 5 来源 │ 3 来源    │ 论文 2019│        │       │ 需复核 │ │
│  └──────────┴────────┴───────────┴──────────┴────────┴────────┴────────┘ │
│                                                                      │
│  图例：✅ 支持  ❌ 反驳  ❓ 未证实  🚫 未发现  🔁 转载同源  ⚠️ 问题标注      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 交互规格

| 交互 | 行为 |
|------|------|
| **Hover 单元格** | 显示 Tooltip：Provider 返回的来源数、相关度评分 |
| **点击单元格** | 打开 EvidenceDetailDrawer，展示该命题在该 Provider 下的详细搜索结果 |
| **点击状态列** | 展开该命题的完整共识分析（三维度评估） |
| **点击"独立性"分数** | 展开来源独立性图谱（SourceIndependenceGraph） |
| **表格横向滚动** | 当 Provider 数量 > 3 时，支持横向滚动 |

#### 列宽规范

```
原子命题: 280px (固定，左对齐，可换行)
各 Provider: 120px (最小宽度，居中)
原始来源: 120px (居中)
反证: 100px (居中)
独立性: 80px (居中)
状态: 100px (固定，居中，带颜色标签)
```

### 4.3 EvidenceDetailDrawer（证据详情抽屉）

#### 布局规格

```
┌─────────────────────────────────────────┐
│ 证据详情 ×                                │
├─────────────────────────────────────────┤
│ [概览] [来源链] [时间线] [Agent 判断]      │
├─────────────────────────────────────────┤
│                                         │
│ Tab 1: 概览                              │
│ ─────────────────────────────────────── │
│ 原子命题：清华大学食堂是否推出了           │
│          "AI营养师"配餐系统               │
│                                         │
│ 搜索引擎：360 Search                     │
│ 检索时间：2026-05-30 14:23:15            │
│ 检索查询："清华大学 AI营养师 配餐系统"    │
│                                         │
│ 结果摘要：                                │
│ ┌─────────────────────────────────────┐ │
│ │ 360 Search 返回了 3 条相关结果：      │ │
│ │ • 来源 1：XX新闻网 — 摘要...          │ │
│ │ • 来源 2：知乎 — 摘要...              │ │
│ │ • 来源 3：微信公众号 — 摘要...        │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 支持/反驳/背景/无关：支持 ✅              │
│ 相关度评分：0.92                         │
│                                         │
│ 来源分级分布：                            │
│ 🥇 Tier 1: 0  🥈 Tier 2: 1  🥉 Tier 3: 2  │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│ Tab 2: 来源链                            │
│ ─────────────────────────────────────── │
│ 直接引用来源：XX新闻网                     │
│ 来源类型：新闻媒体（Tier 2）              │
│ 是否原始来源：❌ 否                        │
│                                         │
│ 原始来源追溯：                             │
│ [政府公告] ← [XX新闻网]                   │
│                                          │
│ 点击 [政府公告] 可查看原始出处              │
│                                          │
│ 是否转载：是                              │
│ 与其他来源独立性：                         │
│ • 与 AnySearch 结果引用同一政府公告        │
│   → 判定为：不独立                         │
│                                          │
├─────────────────────────────────────────┤
│                                         │
│ Tab 3: 时间线                            │
│ ─────────────────────────────────────── │
│ 事件时间线：                               │
│ 2024-03-15  政府公告发布                   │
│ 2024-03-16  XX新闻网转载                   │
│ 2024-03-17  AnySearch 收录来源转载         │
│ 2026-05-30  本系统检索                     │
│                                          │
│ ⚠️ 注意：原始来源距今已 14 个月            │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│ Tab 4: Agent 判断理由                      │
│ ─────────────────────────────────────── │
│ EvidenceConsensusAgent 的判断过程：        │
│                                          │
│ 1. 来源去重：                              │
│    360 Search 返回 3 条，AnySearch 返回 2 条 │
│    去重后独立来源：2 条                     │
│    转载同源：1 条（XX新闻网和另一来源      │
│    都引用了同一政府公告）                   │
│                                          │
│ 2. 来源分级：                              │
│    Tier 2（新闻媒体）：1 条                 │
│    Tier 3（自媒体）：1 条                   │
│                                          │
│ 3. 原始来源追溯：                           │
│    追溯到政府公告 ✅                        │
│                                          │
│ 4. 反证搜索：                              │
│    执行了反证搜索（查询："清华大学 AI营养师  │
│    辟谣"）                                 │
│    结果：暂未发现反证                       │
│                                          │
│ 5. 最终判定：                              │
│    满足最低条件 1-4                        │
│    独立性评分：80%                          │
│    状态：🟢 可进入推理                     │
│                                          │
└─────────────────────────────────────────┘
```

#### 抽屉规格

- **位置**：从右侧滑入（right drawer）
- **宽度**：600px（桌面端），100%（移动端）
- **遮罩**：半透明黑色背景，点击可关闭
- **动画**：300ms ease-out 滑入
- **滚动**：内部内容区域独立滚动

### 4.4 MissionControl 增强（执行态）

当前 MissionControl 需增加 EvidenceConsensusAgent 的实时展示：

```
Phase 2: 证据检索（并行中）
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 360 Search   │ │ AnySearch    │ │ Metaso       │
│ 🟢 12 结果   │ │ 🟢 8 结果    │ │ ⚪ 未启用    │
│ 去重后 5 独立│ │ 去重后 3 独立│ │              │
│ ⏱️ 2.3s      │ │ ⏱️ 3.1s      │ │              │
└──────────────┘ └──────────────┘ └──────────────┘

Phase 3: 证据共识（分析中）
┌───────────────────────────────────────┐
│ EvidenceConsensusAgent                │
│ 📊 来源去重：18 → 9 独立来源           │
│ 📈 来源分级：🥇 2 | 🥈 3 | 🥉 4       │
│ 🔍 原始追溯：6/9 ✅                    │
│ 🛡️ 反证搜索：3/3 完成                  │
│ 🔗 独立性评分：65%                     │
│                                       │
│ 原子命题 A：🟢 可进入推理              │
│ 原子命题 B：🟡 存疑                    │
│ 原子命题 C：🔴 需人工复核              │
└───────────────────────────────────────┘
```

### 4.5 EvidenceGraph 增强（结果态）

在现有 Evidence Graph 中增加：

1. **EvidenceMatrix 全量展示**
2. **SourceIndependenceGraph**：
   - 节点：来源（颜色按 Tier 分级）
   - 边：引用关系（虚线 = 转载引用，实线 = 独立报道）
   - 可交互：点击节点查看来源详情
3. **时间线视图**：按时间排序的证据事件

---

## 5. 可信度表达策略

### 5.1 文案规范

| 不要使用 | 使用 |
|---------|------|
| "3个搜索引擎都支持该说法" | "该说法有 2 个独立来源支持，其中 1 个为原始来源" |
| "高置信度" | "证据链完整度：原始来源可追溯 + 独立来源互相印证 + 反证检索已完成" |
| "事实为真" | "当前证据链支持该结论，暂未发现反证" |
| "没有反证" | "暂未发现反证（搜索范围：XX、YY、ZZ）" |
| "多源一致" | "多源独立验证" / "来源互相印证" |
| "来源可靠" | "来源可追溯至原始出处" |

### 5.2 可视化规范

**共识状态标签**：

```
🟢 可进入推理
   背景色：green-50
   边框色：green-500
   文字色：green-800
   图标：CheckCircle

🟡 存疑
   背景色：yellow-50
   边框色：yellow-500
   文字色：yellow-800
   图标：AlertTriangle

🔴 需人工复核
   背景色：red-50
   边框色：red-500
   文字色：red-800
   图标：AlertOctagon
```

**来源分级颜色**：

```
🥇 Tier 1 (政府/学术): 紫色 purple-600
🥈 Tier 2 (权威媒体): 蓝色 blue-600
🥉 Tier 3 (普通媒体): 灰色 gray-500
   Tier 4 (论坛/社交): 橙色 orange-500
```

### 5.3 FIRE 五维模型的扩展

EvidenceConsensusAgent 的输出直接增强 FIRE 评估中的两个维度：

| FIRE 维度 | 当前计算 | 增强后计算 |
|-----------|---------|-----------|
| **来源可靠性** | Agent 证据包平均来源质量 | + 原始来源追溯成功率 + Tier 1/2 来源占比 |
| **证据完整度** | 支持/反驳证据数 | + 独立来源数 + 反证覆盖情况 |

新增维度（可选，MVP 后迭代）：
- **来源独立性**：独立来源占比（EvidenceIndependenceAssessment.independenceScore）
- **反证覆盖率**：CounterEvidenceCoverage.verdict

---

## 6. 验收标准

### 6.1 功能验收

- [ ] ClaimDecomposer 能将测试 claim 拆分为 ≥2 个原子命题
- [ ] EvidenceSearchRouter 能并行调用 ≥2 个搜索 Provider
- [ ] EvidenceConsensusAgent 能输出符合 schema 的共识报告
- [ ] 证据矩阵展示所有原子命题 × 所有 Provider 的结果
- [ ] 点击证据矩阵单元格能打开 EvidenceDetailDrawer
- [ ] EvidenceDetailDrawer 4 个 Tab 都能正常展示
- [ ] 来源独立性判断能正确标记"转载同源"
- [ ] 反证搜索状态能正确显示"暂未发现反证"
- [ ] 共识状态（🟢🟡🔴）判定逻辑与 spec 一致

### 6.2 演示验收

- [ ] 演示流程 ≤ 3 分钟
- [ ] 评委能在 30 秒内理解"多搜索引擎交叉验证"的逻辑
- [ ] 证据矩阵能直观展示"独立来源 vs 转载同源"
- [ ] 反证搜索有显式展示，不是暗箱操作
- [ ] 文案中没有"搜索结果一致所以为真"的误导性表达

### 6.3 性能验收

- [ ] 多搜索并行总耗时 ≤ 10 秒（不含 LLM 调用）
- [ ] EvidenceConsensusAgent LLM 调用耗时 ≤ 5 秒
- [ ] 整个新增流程（拆解 → 搜索 → 共识）总耗时 ≤ 30 秒
- [ ] 证据矩阵渲染 ≤ 100ms（≤ 20 行数据）
- [ ] EvidenceDetailDrawer 打开动画 ≤ 300ms

---

## 7. 非功能需求

### 7.1 性能

- 搜索 Provider 必须并行调用，不能串行
- EvidenceConsensusAgent 的 LLM 调用可缓存（相同 claim 的共识结果缓存 1 小时）
- 证据矩阵使用虚拟滚动（如果原子命题 > 20 个）

### 7.2 安全

- 搜索 Provider 的 API Key 不暴露到前端
- 来源 URL 需要经过 XSS 过滤后展示
- 用户输入的 claim 需要长度限制（≤ 1000 字符）

### 7.3 可扩展性

- 搜索 Provider 接口设计为插件化，新增 Provider 只需实现统一接口
- EvidenceConsensusAgent 的三维度评估可配置权重
- 来源分级规则可配置（JSON 配置文件）

### 7.4 降级策略

| 故障场景 | 降级行为 |
|---------|---------|
| AnySearch API 不可用 | 仅使用 360 Search，UI 中标注"交叉验证受限" |
| EvidenceConsensusAgent LLM 超时 | 回退到简单规则引擎（基于来源数量判断） |
| 某原子命题无搜索结果 | 标记为"🔴 需人工复核"，不阻塞其他命题 |
| 反证搜索失败 | 标记"反证检索未执行"，不判真 |

---

## 8. 风险与假设

### 8.1 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| AnySearch API 不稳定 | 中 | 高 | 设计降级策略，MVP 中先用 mock 数据演示 |
| EvidenceConsensusAgent 判断不准确 | 中 | 高 | 增加"Agent 判断理由"Tab，让用户可审查 |
| LLM 调用延迟过高 | 高 | 中 | 流式输出共识分析过程，降低等待焦虑 |
| 来源独立性判断复杂 | 高 | 中 | MVP 中用简化规则（URL + 标题去重），后续迭代 NLP 分析 |

### 8.2 假设

- AnySearch API 在演示前能稳定可用
- 评委理解"证据链完整度"优于"多源一致"的概念
- 360 Search 能返回足够丰富的搜索结果用于交叉验证
- LLM 能正确执行来源去重和独立性判断（MVP 中可人工辅助标注）

---

## 9. 附录

### 9.1 与现有代码的衔接点

| 现有文件 | 修改点 |
|---------|--------|
| `agentConfigs.ts` | 新增 ClaimDecomposer、EvidenceSearchRouter、EvidenceConsensusAgent 的配置 |
| `confidenceEngine.ts` | 新增 evidenceIndependence 和 counterEvidenceCoverage 对 FIRE 评分的增强逻辑 |
| `schemas.ts` | 新增 EvidenceConsensusReport 相关类型 |
| `reasoningStore.tsx` | 新增 handoff 步骤类型（evidence_consensus） |
| `vite.config.ts` | 新增 `/api/agent/evidence-consensus` 端点 |
| `ReasoningWorkspaceV3.tsx` | 集成 EvidenceMatrix 和 ConsensusProgressPanel |

### 9.2 新增文件清单

```
src/
├── lib/
│   ├── evidenceConsensus.ts      # EvidenceConsensusAgent 核心逻辑
│   ├── claimDecomposer.ts        # ClaimDecomposer 核心逻辑
│   ├── evidenceSearchRouter.ts   # 多搜索 Provider 调度
│   └── sourceIndependence.ts     # 来源独立性判断算法
├── components/v3/
│   ├── EvidenceMatrix.tsx        # 证据矩阵主组件
│   ├── EvidenceDetailDrawer.tsx  # 证据详情抽屉
│   ├── ConsensusProgressPanel.tsx # 共识进度面板
│   ├── SourceIndependenceGraph.tsx # 来源独立性图谱
│   └── ClaimDecomposerDisplay.tsx # 原子命题展示
└── data/
    └── mockEvidenceConsensus.ts  # Mock 数据（MVP Demo 用）
```

### 9.3 版本规划

| 版本 | 范围 | 目标 |
|------|------|------|
| MVP Demo | EvidenceMatrix + EvidenceDetailDrawer + Mock 数据 | 演示效果验证 |
| v3.1 | EvidenceConsensusAgent 真实 LLM 调用 + AnySearch 集成 | 功能完整 |
| v3.2 | SourceIndependenceGraph + 时间线视图 | 可视化增强 |
| v3.3 | 来源分级规则配置 + 缓存优化 | 工程优化 |
