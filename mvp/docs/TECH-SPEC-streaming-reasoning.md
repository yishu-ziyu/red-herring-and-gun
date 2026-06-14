# StreamingReasoningPanel 技术规格书

> 目标：为 Codex 提供清晰的实现规范，生成 Mock 流式数据生成器。
> 前端由人工实现，Codex 只负责 `src/lib/streamingMock.ts` 中的数据层。

---

## 1. 整体架构

```
ConsensusDemoView
├── header
├── grid: [ConsensusProgressPanel | EvidenceMatrix]
└── StreamingReasoningPanel  ← 新增（本规格书）
    ├── PanelTrigger（可点击下拉/收起）
    └── PanelContent（下拉展开区）
        ├── StageList（5个推理阶段）
        │   └── StageCard × 5
        │       ├── StageHeader（图标+标题+Agent名+状态）
        │       └── StageBody（流式文字内容）
        └── PanelFooter（当前Agent标识）
```

---

## 2. 类型定义（前端与数据层共用）

```typescript
// src/lib/streamingTypes.ts

export type StageStatus = "pending" | "running" | "completed" | "error";

export type ChunkType = "thought" | "action" | "result" | "divider" | "tool_call";

export interface StreamingChunk {
  id: string;
  type: ChunkType;
  content: string;
  timestamp: number;
}

export interface StreamingStage {
  id: string;
  name: string;      // 英文标识
  nameZh: string;    // 中文展示名
  description: string;
  status: StageStatus;
  agentName: string;
  agentIcon: string; // emoji 或图标名
  chunks: StreamingChunk[];
  startTime?: number;
  endTime?: number;
}

export interface StreamingReasoningSession {
  sessionId: string;
  claim: string;
  stages: StreamingStage[];
  overallStatus: "idle" | "running" | "completed" | "error";
  currentStageId: string | null;
}

// 流式事件（SSE 风格，MVP 用函数回调模拟）
export type StreamEvent =
  | { type: "stage_start"; stageId: string; nameZh: string; agentName: string }
  | { type: "content_chunk"; stageId: string; chunk: StreamingChunk }
  | { type: "stage_end"; stageId: string; status: StageStatus }
  | { type: "session_complete"; timestamp: number };

export type StreamEventHandler = (event: StreamEvent) => void;
```

---

## 3. 五个推理阶段定义

每个阶段的 `chunks` 需要按时间顺序产生，模拟 Agent 的"思考→行动→结果"过程。

### Stage 1: claim-decomposition（Claim 拆解）

- **nameZh**: "Claim 拆解"
- **agentName**: "ClaimDecomposer"
- **agentIcon**: "✂️"
- **description**: "将复杂断言拆分为可独立验证的原子命题"
- **chunks 内容**（按顺序）：
  1. `[thought]` "收到 claim：清华大学食堂推出'AI营养师'配餐系统"
  2. `[thought]` "这个 claim 包含多个可验证的断言，需要逐一拆解..."
  3. `[thought]` "首先识别核心事实断言："
  4. `[action]` "提取断言 1：清华大学食堂是否推出了'AI营养师'配餐系统"
  5. `[action]` "提取断言 2：该配餐系统是否使用了 AI 技术"
  6. `[action]` "提取断言 3：使用该系统的学生营养不良率是否下降了 30%"
  7. `[result]` "拆解完成，得到 3 个原子命题，覆盖事实存在性、技术属性和效果数据三个维度"
  8. `[divider]` "---"
  9. `[result]` "命题 A：清华大学食堂是否推出了'AI营养师'配餐系统 [类型: 事实存在性]"
  10. `[result]` "命题 B：该配餐系统是否使用了 AI 技术 [类型: 技术属性]"
  11. `[result]` "命题 C：使用该系统的学生营养不良率是否下降了 30% [类型: 效果数据]"

### Stage 2: search-strategy（搜索策略生成）

- **nameZh**: "搜索策略生成"
- **agentName**: "EvidenceSearchRouter"
- **agentIcon**: "🧭"
- **description**: "为每个原子命题构建最优搜索查询"
- **chunks 内容**（按顺序）：
  1. `[thought]` "现在为每个原子命题设计搜索策略..."
  2. `[thought]` "命题 A 的核心是'系统是否存在'，需要搜索官方公告和新闻报道"
  3. `[action]` "为命题 A 构建查询：清华大学食堂 AI营养师 配餐系统 官方"
  4. `[thought]` "命题 B 涉及技术细节，需要更精确的关键词"
  5. `[action]` "为命题 B 构建查询：清华大学 智慧营养 配餐系统 AI技术"
  6. `[thought]` "命题 C 是效果数据声明，需要查找统计数据"
  7. `[action]` "为命题 C 构建查询：清华大学 学生营养不良率 下降 30% 统计数据"
  8. `[result]` "搜索策略已生成，覆盖官方信源、技术报道和统计数据三类查询"
  9. `[divider]` "---"
  10. `[result]` "调度计划：并行调用 360 Search、AnySearch、Metaso，每个引擎执行 3 个查询任务"

### Stage 3: search-execution（搜索执行）

- **nameZh**: "搜索执行"
- **agentName**: "SearchExecutor"
- **agentIcon**: "🔍"
- **description**: "并行调度多个搜索引擎，收集证据"
- **chunks 内容**（按顺序）：
  1. `[thought]` "开始并行调度搜索任务..."
  2. `[tool_call]` "调用 360 Search：查询'清华大学食堂 AI营养师 配餐系统'..."
  3. `[result]` "360 Search 返回 3 个来源：清华大学饮食服务中心公告、新华网报道、科技日报"
  4. `[tool_call]` "调用 AnySearch：查询'清华大学 智慧营养 配餐系统 AI技术'..."
  5. `[result]` "AnySearch 返回 2 个来源：清华大学新闻网、教育部官网"
  6. `[tool_call]` "调用 Metaso：查询'清华大学 学生营养不良率 下降 30%'..."
  7. `[result]` "⚠️ Metaso 返回 0 个来源：查询超时，已标记为失败"
  8. `[thought]` "对命题 B 执行补充搜索..."
  9. `[tool_call]` "调用 360 Search：查询'清华大学 智慧营养配餐系统 AI技术'..."
  10. `[result]` "360 Search 返回 2 个来源：人民日报、清华大学官网"
  11. `[tool_call]` "调用 AnySearch：查询'清华大学 智慧营养配餐系统'..."
  12. `[result]` "AnySearch 返回 1 个来源：未明确提及 AI 技术，标记为'未判定'"
  13. `[divider]` "---"
  14. `[result]` "搜索执行完成：6 个任务成功，3 个失败（均为 Metaso 超时），覆盖 3 个命题"

### Stage 4: consensus-evaluation（共识评估）

- **nameZh**: "共识评估"
- **agentName**: "EvidenceConsensusAgent"
- **agentIcon**: "⚖️"
- **description**: "基于证据独立性、来源等级、反证覆盖三维度评估"
- **chunks 内容**（按顺序）：
  1. `[thought]` "收到 6 个成功搜索任务的结果，开始共识评估..."
  2. `[thought]` "维度一：证据独立性评估"
  3. `[action]` "对 11 个来源进行去重分析..."
  4. `[result]` "发现 2 组转载同源：新华网和科技日报内容重复，排除 1 个重复来源"
  5. `[result]` "独立来源：5 个，重复来源：1 个，独立性评分 = 40 + (5/6)*60 = 80%"
  6. `[thought]` "维度二：来源等级评估"
  7. `[action]` "对 5 个独立来源进行分级..."
  8. `[result]` "官方来源 2 个（gov.cn）：教育部官网、清华大学饮食服务中心"
  9. `[result]` "媒体来源 2 个（媒体）：人民日报、科技日报"
  10. `[result]` "论坛来源 1 个（论坛）：知乎讨论帖"
  11. `[result]` "最高等级来源：政府/学术（Tier 1），满足'高等级或原创来源'条件"
  12. `[thought]` "维度三：反证覆盖评估"
  13. `[action]` "对每个命题执行反证搜索..."
  14. `[result]` "命题 A：暂未发现反证"
  15. `[result]` "命题 B：暂未发现反证"
  16. `[result]` "命题 C：发现反驳！AnySearch 返回的来源显示'营养不良率下降'的说法缺乏数据支撑"
  17. `[divider]` "---"
  18. `[result]` "命题 A 评估：✅ 可进入推理（满足所有最低条件，无反证）"
  19. `[result]` "命题 B 评估：⚠️ 存疑（来源不足，AnySearch 未判定）"
  20. `[result]` "命题 C 评估：❌ 需人工复核（发现反证，数据来源不明确）"

### Stage 5: fire-assessment（FIRE 置信度评估）

- **nameZh**: "FIRE 置信度评估"
- **agentName**: "FireAssessor"
- **agentIcon**: "🔥"
- **description**: "五维置信度综合评估"
- **chunks 内容**（按顺序）：
  1. `[thought]` "基于共识评估结果，执行 FIRE 五维置信度评估..."
  2. `[thought]` "F1 来源可靠性：命题 A 有 2 个 Tier-1 官方来源 → 高"
  3. `[result]` "命题 A 来源可靠性：高（2/3 来源为官方/权威媒体）"
  4. `[result]` "命题 B 来源可靠性：中（1/2 来源明确，1 个未判定）"
  5. `[result]` "命题 C 来源可靠性：低（无可靠数据支撑，存在反证）"
  6. `[thought]` "F2 证据完整性：命题 A 有 3 个独立来源交叉验证 → 高"
  7. `[result]` "命题 A 证据完整性：高"
  8. `[result]` "命题 B 证据完整性：中（来源数量不足）"
  9. `[result]` "命题 C 证据完整性：低（反证存在，无正面数据）"
  10. `[thought]` "F3 逻辑一致性：三个命题之间存在因果链条..."
  11. `[result]` "命题 A→B：存在（系统存在 → 使用 AI 技术）→ 一致"
  12. `[result]` "命题 B→C：断裂（使用 AI ≠ 营养不良率下降 30%）→ 逻辑跳跃"
  13. `[thought]` "F4 信息时效性：搜索结果时间戳 2024.03-2024.04 → 近期"
  14. `[result]` "信息时效性：高（均为 2024 年最新数据）"
  15. `[thought]` "F5 权威性匹配：官方来源与 claim 主体（清华大学）完全匹配"
  16. `[result]` "权威性匹配：高"
  17. `[divider]` "---"
  18. `[result]` "FIRE 综合置信度："
  19. `[result]` "命题 A：85%（来源可靠 + 证据完整 + 逻辑一致 + 时效高 + 权威匹配）"
  20. `[result]` "命题 B：55%（来源中等 + 证据不完整 + 逻辑一致 + 时效高 + 权威匹配）"
  21. `[result]` "命题 C：25%（来源低 + 证据缺失 + 逻辑断裂 + 时效高 + 权威匹配）"

---

## 4. Mock 流生成器接口（Codex 实现）

```typescript
// src/lib/streamingMock.ts

import type { StreamingReasoningSession, StreamEvent, StreamEventHandler } from "./streamingTypes";

/**
 * 创建一个新的流式推理会话
 */
export function createStreamingSession(claim: string): StreamingReasoningSession;

/**
 * 启动 Mock 流式输出
 * @param session 会话对象
 * @param onEvent 事件回调
 * @param options 配置选项
 * @returns 取消函数
 */
export function startMockStream(
  session: StreamingReasoningSession,
  onEvent: StreamEventHandler,
  options?: {
    baseDelay?: number;      // 基础延迟（默认 80ms）
    chunkJitter?: number;    // 随机抖动（默认 40ms）
    stagePause?: number;     // 阶段间停顿（默认 600ms）
    accelerate?: boolean;    // 是否加速模式（开发调试用）
  }
): () => void; // 返回取消函数

/**
 * 生成完整的 Mock 会话（用于 Demo 预加载，非流式）
 */
export function generateCompleteMockSession(claim: string): StreamingReasoningSession;
```

---

## 5. 实现约束

1. **文件位置**: `src/lib/streamingMock.ts`
2. **依赖**: 只能依赖 `src/lib/streamingTypes.ts` 中的类型，不能依赖其他业务模块
3. **时间控制**: 
   - 每个 chunk 之间延迟 40-120ms（baseDelay 80ms ± jitter 40ms）
   - 每个 stage 之间停顿 400-800ms
   - 整个流在 15-25 秒内完成（accelerate 模式下 3-5 秒）
4. **不可变性**: 所有状态更新返回新对象，禁止 mutate
5. **取消机制**: `startMockStream` 返回的函数必须能安全停止所有 pending 的 setTimeout
6. **随机性**: 每次生成的 chunk 延迟有随机抖动，但内容固定（基于上面的 5 个阶段定义）

---

## 6. 前端组件接口（供参考，Codex 不实现）

```typescript
// src/components/v3/StreamingReasoningPanel.tsx（人工实现）

interface StreamingReasoningPanelProps {
  claim: string;
  session: StreamingReasoningSession | null;
  isStreaming: boolean;
  onToggle: () => void;
  isExpanded: boolean;
}
```

---

## 7. 集成到 ConsensusDemoView

在 `ConsensusDemoView.tsx` 中，`EvidenceMatrix` 下方添加：

```tsx
<div style={{ marginTop: "24px" }}>
  <StreamingReasoningPanel 
    claim={claim}
    session={streamingSession}
    isStreaming={isStreaming}
    onToggle={() => setIsExpanded(!isExpanded)}
    isExpanded={isExpanded}
  />
</div>
```

当用户点击"体验交叉验证"时，触发 `LOAD_CONSENSUS_DEMO` 的同时启动 Mock 流：
- `startMockStream` 开始 emit 事件
- 前端通过 `useEffect` 监听事件，更新 `streamingSession` 状态
- 流完成后，`isStreaming` 设为 false
