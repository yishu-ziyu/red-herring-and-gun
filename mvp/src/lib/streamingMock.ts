import type {
  ChunkType,
  StreamEventHandler,
  StreamingChunk,
  StreamingReasoningSession,
  StreamingStage,
} from "./streamingTypes";

type ChunkTemplate = {
  type: ChunkType;
  content: string;
};

type StageTemplate = Omit<StreamingStage, "status" | "chunks" | "startTime" | "endTime"> & {
  chunks: ChunkTemplate[];
};

const STAGE_TEMPLATES: readonly StageTemplate[] = [
  {
    id: "claim-decomposition",
    name: "claim-decomposition",
    nameZh: "Claim 拆解",
    description: "将复杂断言拆分为可独立验证的原子命题",
    agentName: "ClaimDecomposer",
    agentIcon: "✂️",
    chunks: [
      { type: "thought", content: "收到 claim：{claim}" },
      { type: "thought", content: "先把原句拆成可核查对象，避免直接用语言风险替代事实判断。" },
      { type: "thought", content: "优先识别人物/机构、事件动作、因果或死亡等强结论。" },
      { type: "action", content: "提取断言 1：原始陈述中的核心事件是否发生。" },
      { type: "action", content: "提取断言 2：陈述中的因果关系或归因是否成立。" },
      { type: "action", content: "提取断言 3：是否存在权威来源、当事人回应或可追溯原始出处。" },
      { type: "result", content: "拆解完成，得到 3 个原子命题，覆盖事实存在性、因果归因和来源可追溯性。" },
      { type: "divider", content: "---" },
      { type: "result", content: "命题 A：核心事件是否存在 [类型: 事实存在性]" },
      { type: "result", content: "命题 B：因果归因是否有证据 [类型: 归因断言]" },
      { type: "result", content: "命题 C：原始来源是否可追溯 [类型: 信源断言]" },
    ],
  },
  {
    id: "search-strategy",
    name: "search-strategy",
    nameZh: "搜索策略生成",
    description: "为每个原子命题构建最优搜索查询",
    agentName: "EvidenceSearchRouter",
    agentIcon: "🧭",
    chunks: [
      { type: "thought", content: "现在为每个原子命题设计搜索策略..." },
      { type: "thought", content: "命题 A 需要支持查询和反证查询同时生成。" },
      { type: "action", content: "支持查询：{claim} 证据 来源 官方说明 原始出处" },
      { type: "thought", content: "命题 B 涉及强因果或归因，需要寻找反例、辟谣和当事人回应。" },
      { type: "action", content: "反证查询：{claim} 辟谣 反例 争议 无法证实 误读" },
      { type: "thought", content: "命题 C 需要追踪首发来源，而不是只统计转载页面数量。" },
      { type: "action", content: "溯源查询：{claim} 首发 原文 来源 时间线" },
      { type: "result", content: "搜索策略已生成，覆盖支持、反证、溯源三类查询。" },
      { type: "divider", content: "---" },
      { type: "result", content: "调度计划：并行调用 360 Search、AnySearch、Metaso，每个引擎执行 3 个查询任务" },
    ],
  },
  {
    id: "search-execution",
    name: "search-execution",
    nameZh: "搜索执行",
    description: "并行调度多个搜索引擎，收集证据",
    agentName: "SearchExecutor",
    agentIcon: "🔍",
    chunks: [
      { type: "thought", content: "开始并行调度搜索任务..." },
      { type: "tool_call", content: "调用 360 Search：查询支持证据..." },
      { type: "result", content: "360 Search 的真实返回会显示在上方交叉验证矩阵；若为空，本面板不补写来源。" },
      { type: "tool_call", content: "调用 AnySearch 适配器：查询反证线索..." },
      { type: "result", content: "AnySearch 当前为沙盒适配结果，只用于演示矩阵结构，不作为事实结论。" },
      { type: "tool_call", content: "调用 Metaso 适配器：查询首发和转载链..." },
      { type: "result", content: "Metaso 当前可能返回失败状态；失败会保留为证据缺口。" },
      { type: "thought", content: "检查是否存在单一来源被多个搜索引擎重复转载。" },
      { type: "tool_call", content: "执行来源去重与独立性分析..." },
      { type: "result", content: "去重结果只影响置信度，不会把重复来源当作多方证实。" },
      { type: "tool_call", content: "检查反证查询和支持查询是否互相冲突..." },
      { type: "result", content: "若支持与反证冲突，系统会标记为存疑或需人工复核。" },
      { type: "divider", content: "---" },
      { type: "result", content: "搜索执行完成后，结果会进入来源独立性、来源等级和反证覆盖评估。" },
    ],
  },
  {
    id: "consensus-evaluation",
    name: "consensus-evaluation",
    nameZh: "共识评估",
    description: "基于证据独立性、来源等级、反证覆盖三维度评估",
    agentName: "EvidenceConsensusAgent",
    agentIcon: "⚖️",
    chunks: [
      { type: "thought", content: "收到 6 个成功搜索任务的结果，开始共识评估..." },
      { type: "thought", content: "维度一：证据独立性评估" },
      { type: "action", content: "对返回来源进行 domain、URL 和标题相似度去重。" },
      { type: "result", content: "转载同源会被合并，避免把同一条消息误认为多方证实。" },
      { type: "result", content: "独立性评分由独立来源数量和总来源数量共同决定。" },
      { type: "thought", content: "维度二：来源等级评估" },
      { type: "action", content: "按官方、学术、媒体、自媒体、论坛、未知进行分级。" },
      { type: "result", content: "高等级来源或原始来源会提高进入推理的许可。" },
      { type: "result", content: "低等级来源不会被删除，但会降低证据权重。" },
      { type: "result", content: "没有原始来源时，系统只允许给出证据缺口，不允许强结论。" },
      { type: "thought", content: "维度三：反证覆盖评估" },
      { type: "action", content: "对每个命题执行反证搜索。" },
      { type: "result", content: "命题 A：根据来源覆盖情况标记为支持、存疑或需复核。" },
      { type: "result", content: "命题 B：若只找到转述而无原始来源，标记为存疑。" },
      { type: "result", content: "命题 C：若找到反证或关键数据缺口，标记为需人工复核。" },
      { type: "divider", content: "---" },
      { type: "result", content: "共识结果会显示在证据矩阵：可进入推理 / 存疑 / 需人工复核。" },
      { type: "result", content: "该状态是证据许可，不是最终真假裁决。" },
      { type: "result", content: "最终表达必须继续交给 ReportComposer 收束。" },
    ],
  },
  {
    id: "fire-assessment",
    name: "fire-assessment",
    nameZh: "FIRE 置信度评估",
    description: "五维置信度综合评估",
    agentName: "FireAssessor",
    agentIcon: "🔥",
    chunks: [
      { type: "thought", content: "基于共识评估结果，执行 FIRE 五维置信度评估..." },
      { type: "thought", content: "F1 来源可靠性：优先看官方、学术、原始出处。" },
      { type: "result", content: "来源可靠性由上方矩阵的来源等级和独立性共同决定。" },
      { type: "result", content: "如果来源为空，可靠性不会被自动补高。" },
      { type: "result", content: "如果只有低等级转述，输出必须降级为存疑。" },
      { type: "thought", content: "F2 证据完整性：检查支持、反证和溯源是否都覆盖。" },
      { type: "result", content: "证据完整度不足时，最终报告只能说明还缺什么。" },
      { type: "result", content: "反证查询失败会保留为风险，而不是忽略。" },
      { type: "result", content: "重复来源不会提升完整度。" },
      { type: "thought", content: "F3 逻辑一致性：检查事实存在是否能推出原 claim 的强结论。" },
      { type: "result", content: "事实存在不等于因果成立，因果链断裂时要降级。" },
      { type: "result", content: "人物、死亡、违法等强断言需要更高证据门槛。" },
      { type: "thought", content: "F4 信息时效性：检查来源发布时间和事件时间线。" },
      { type: "result", content: "旧来源或时间线不匹配会降低时效评分。" },
      { type: "thought", content: "F5 权威性匹配：检查来源主体是否能回答该 claim。" },
      { type: "result", content: "权威性匹配不足时，报告必须保留人工复核建议。" },
      { type: "divider", content: "---" },
      { type: "result", content: "FIRE 综合置信度会在真实证据返回后计算。" },
      { type: "result", content: "无真实证据时，系统不补写百分比结论。" },
      { type: "result", content: "下一步交给 ReportComposer 只输出证据允许的表述。" },
    ],
  },
];

const DEFAULT_BASE_DELAY_MS = 80;
const DEFAULT_CHUNK_JITTER_MS = 40;
const DEFAULT_STAGE_PAUSE_MS = 600;
const ACCELERATION_FACTOR = 5;

export function createStreamingSession(claim: string): StreamingReasoningSession {
  return {
    sessionId: createSessionId(),
    claim,
    stages: createPendingStages(),
    overallStatus: "idle",
    currentStageId: null,
    source: "mock",
    sourceLabel: "沙盒过程可视化",
  };
}

export function startMockStream(
  session: StreamingReasoningSession,
  onEvent: StreamEventHandler,
  options: {
    baseDelay?: number;
    chunkJitter?: number;
    stagePause?: number;
    accelerate?: boolean;
  } = {},
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const speedDivisor = options.accelerate ? ACCELERATION_FACTOR : 1;
  let cancelled = false;

  const schedule = (delayMs: number, callback: () => void) => {
    const timer = setTimeout(() => {
      if (!cancelled) callback();
    }, scaleDelay(delayMs, speedDivisor));
    timers.push(timer);
  };

  const nextChunkDelay = () =>
    randomBetween(
      (options.baseDelay ?? DEFAULT_BASE_DELAY_MS) - (options.chunkJitter ?? DEFAULT_CHUNK_JITTER_MS),
      (options.baseDelay ?? DEFAULT_BASE_DELAY_MS) + (options.chunkJitter ?? DEFAULT_CHUNK_JITTER_MS),
    );

  const nextStagePause = () => {
    const stagePause = options.stagePause ?? DEFAULT_STAGE_PAUSE_MS;
    return randomBetween(stagePause - stagePause / 3, stagePause + stagePause / 3);
  };

  const emitStage = (stageIndex: number) => {
    const stage = STAGE_TEMPLATES[stageIndex];

    if (!stage) {
      onEvent({ type: "session_complete", timestamp: Date.now() });
      return;
    }

    onEvent({
      type: "stage_start",
      stageId: stage.id,
      nameZh: stage.nameZh,
      agentName: stage.agentName,
    });

    const emitChunk = (chunkIndex: number) => {
      const template = stage.chunks[chunkIndex];

      if (!template) {
        onEvent({ type: "stage_end", stageId: stage.id, status: "completed" });
        const isFinalStage = stageIndex === STAGE_TEMPLATES.length - 1;
        schedule(isFinalStage ? 0 : nextStagePause(), () => emitStage(stageIndex + 1));
        return;
      }

      schedule(nextChunkDelay(), () => {
        onEvent({
          type: "content_chunk",
          stageId: stage.id,
          chunk: createChunk(stage.id, chunkIndex, template, Date.now(), session.claim),
        });
        emitChunk(chunkIndex + 1);
      });
    };

    emitChunk(0);
  };

  void session;
  schedule(0, () => emitStage(0));

  return () => {
    cancelled = true;
    timers.forEach((timer) => clearTimeout(timer));
  };
}

export function generateCompleteMockSession(claim: string): StreamingReasoningSession {
  const timestamp = Date.now();

  return {
    sessionId: createSessionId(),
    claim,
    stages: STAGE_TEMPLATES.map((stage, stageIndex) => {
      const stageStartTime = timestamp + stageIndex * 10_000;
      const chunks = createChunks(stage.id, stage.chunks, stageStartTime, claim);
      const endTime = chunks[chunks.length - 1]?.timestamp ?? stageStartTime;

      return {
        id: stage.id,
        name: stage.name,
        nameZh: stage.nameZh,
        description: stage.description,
        status: "completed",
        agentName: stage.agentName,
        agentIcon: stage.agentIcon,
        chunks,
        startTime: stageStartTime,
        endTime,
      };
    }),
    overallStatus: "completed",
    currentStageId: null,
    source: "mock",
    sourceLabel: "沙盒过程可视化",
  };
}

function createPendingStages(): StreamingStage[] {
  return STAGE_TEMPLATES.map((stage) => ({
    id: stage.id,
    name: stage.name,
    nameZh: stage.nameZh,
    description: stage.description,
    status: "pending",
    agentName: stage.agentName,
    agentIcon: stage.agentIcon,
    chunks: [],
  }));
}

function createChunks(stageId: string, chunks: readonly ChunkTemplate[], startTime: number, claim: string): StreamingChunk[] {
  return chunks.map((chunk, index) => createChunk(stageId, index, chunk, startTime + index * DEFAULT_BASE_DELAY_MS, claim));
}

function createChunk(stageId: string, index: number, chunk: ChunkTemplate, timestamp: number, claim: string): StreamingChunk {
  return {
    id: `${stageId}-chunk-${index + 1}`,
    type: chunk.type,
    content: chunk.content.split("{claim}").join(claim),
    timestamp,
  };
}

function createSessionId(): string {
  if (globalThis.crypto?.randomUUID) return `mock-session-${globalThis.crypto.randomUUID()}`;
  return `mock-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function randomBetween(min: number, max: number): number {
  const safeMin = Math.max(0, Math.min(min, max));
  const safeMax = Math.max(safeMin, max);
  return safeMin + Math.random() * (safeMax - safeMin);
}

function scaleDelay(delayMs: number, speedDivisor: number): number {
  return Math.max(0, Math.round(delayMs / speedDivisor));
}
