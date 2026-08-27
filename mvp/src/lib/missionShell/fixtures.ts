/**
 * SSE fixtures for MissionStreamAdapter (no network).
 */
import type { OrchestrateStreamEvent } from "../agentExpansion";

/** Fixture A: early stream — planner + memory + first agent running */
export const FIXTURE_EARLY: OrchestrateStreamEvent[] = [
  {
    type: "planner_update",
    claim: "隔夜菜加热会致癌吗",
    plan: {
      id: "dag-1",
      claimType: "causal",
      rationale: "因果类命题，进入事实核查与替代解释路径。",
      nodes: [],
      edges: [],
      criticalPath: [],
    } as OrchestrateStreamEvent["plan"],
    timestamp: 1,
  },
  {
    type: "tool_start",
    toolId: "memory_search",
    toolName: "Agent Memory Search",
    query: "隔夜菜加热会致癌吗",
    timestamp: 2,
  },
  {
    type: "tool_result",
    toolId: "memory_search",
    toolName: "Agent Memory Search",
    query: "隔夜菜加热会致癌吗",
    result: { hitCount: 1, acceptedCandidateCount: 0 },
    timestamp: 3,
  },
  {
    type: "agent_start",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    agentIcon: "🚨",
    timestamp: 4,
  },
];

/**
 * Live executing beat the user actually sees: planner done, memory nested,
 * speculative relay ("先派发可行动线索") then rumor_detector running.
 * Process UI must collapse relay + agent into one current triage step.
 */
export const FIXTURE_TRIAGE_RUNNING: OrchestrateStreamEvent[] = [
  FIXTURE_EARLY[0],
  FIXTURE_EARLY[1],
  FIXTURE_EARLY[2],
  {
    type: "speculative_update",
    relay: {
      id: "relay-rumor-to-search",
      title: "先派发可行动线索",
      upstream: "Planner",
      downstream: "RumorDetector",
      trigger: "已识别命题类型，先拆出可检索的判断。",
      status: "running",
      savedReason: "不用等最终报告，先把可验证问题拆出来。",
      confidence: "medium",
    },
    timestamp: 4,
  },
  {
    type: "agent_start",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    agentIcon: "🚨",
    timestamp: 5,
  },
];

/** Fixture B: mid stream — agents done + search tools */
export const FIXTURE_MID: OrchestrateStreamEvent[] = [
  ...FIXTURE_EARLY,
  {
    type: "agent_complete",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    output: {
      claimAtoms: ["隔夜菜加热产生致癌物"],
      severity: "medium",
      analysis: "属于因果健康类断言，需查权威来源与反证。",
    },
    timestamp: 5,
  },
  {
    type: "tool_start",
    toolId: "search360",
    toolName: "360 Search",
    query: "隔夜菜 致癌 证据",
    timestamp: 6,
  },
  {
    type: "tool_result",
    toolId: "search360",
    toolName: "360 Search",
    query: "隔夜菜 致癌 证据",
    result: {
      sourceCount: 3,
      sources: [
        {
          title: "食品安全与亚硝酸盐科普",
          url: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
          snippet: "不当储存可能升高风险，但不等于必然致癌。",
          domain: "who.int",
        },
        {
          title: "隔夜菜风险条件说明",
          url: "https://www.cdc.gov/foodsafety/",
          snippet: "风险与储存温度、时间相关。",
          domain: "cdc.gov",
        },
        {
          title: "科普中国：隔夜菜致癌说法辨析",
          url: "https://www.kepuchina.cn/",
          snippet: "说法混淆条件风险与必然致害。",
          domain: "kepuchina.cn",
        },
      ],
    },
    timestamp: 7,
  },
  {
    type: "agent_start",
    agent: "fact_checker",
    agentName: "FactChecker",
    timestamp: 8,
  },
  {
    type: "agent_complete",
    agent: "fact_checker",
    agentName: "FactChecker",
    output: {
      factCheckResult: "partial",
      keyFindings: ["加热不当可能产生有害物，但不等于必然致癌"],
      unresolvedEvidenceGaps: ["缺少 RCT", "缺少官方通告原文"],
    },
    timestamp: 9,
  },
  {
    type: "agent_start",
    agent: "source_validator",
    agentName: "SourceValidator",
    timestamp: 10,
  },
  {
    type: "agent_complete",
    agent: "source_validator",
    agentName: "SourceValidator",
    output: { sourceReliability: "medium", missingSources: ["权威疾控原文"] },
    timestamp: 11,
  },
];

/** Fixture C: complete with report reviewer */
export const FIXTURE_COMPLETE: OrchestrateStreamEvent[] = [
  ...FIXTURE_MID,
  {
    type: "agent_start",
    agent: "report_composer",
    agentName: "ReportComposer",
    timestamp: 12,
  },
  {
    type: "agent_complete",
    agent: "report_composer",
    agentName: "ReportComposer",
    output: {
      verdictType: "mixed_misleading",
      conclusion: "说法存在夸大，加热不当有风险但不宜直接等同致癌。",
    },
    timestamp: 13,
  },
  {
    type: "tool_start",
    toolId: "report_reviewer",
    toolName: "Report Reviewer (proposer-reviewer)",
    query: "隔夜菜加热会致癌吗",
    timestamp: 14,
  },
  {
    type: "tool_result",
    toolId: "report_reviewer",
    toolName: "Report Reviewer (proposer-reviewer)",
    result: {
      passed: true,
      score: 92,
      issues: [],
    },
    timestamp: 15,
  },
  {
    type: "complete",
    claim: "隔夜菜加热会致癌吗",
    finalReport: {
      verdictType: "mixed_misleading",
      conclusion: "说法存在夸大，加热不当有风险但不宜直接等同致癌。",
      credibilityScore: 42,
      recommendation: "只能信一部分。加热不当有风险，不能等同致癌。",
      keyFindings: ["加热不当可能产生有害物，但不等于必然致癌"],
      evidenceChain: [
        {
          finding: "加热不当可能产生有害物，但不等于必然致癌",
          sourceRefs: [
            { title: "示例来源：食品安全科普", url: "https://example.com/food-safety" },
          ],
        },
      ],
    },
    reportReview: {
      passed: true,
      score: 92,
      issues: [],
    },
    timestamp: 16,
  },
];

/** Fixture D: mid path then tool_error + top-level error (stream aborted) */
export const FIXTURE_ERROR: OrchestrateStreamEvent[] = [
  ...FIXTURE_MID,
  {
    type: "tool_start",
    toolId: "search360",
    toolName: "360 Search",
    query: "隔夜菜 致癌 官方通告",
    timestamp: 12,
  },
  {
    type: "tool_error",
    toolId: "search360",
    toolName: "360 Search",
    message: "搜索超时",
    timestamp: 13,
  },
  {
    type: "error",
    message: "核查失败：上游中断",
    timestamp: 14,
  },
];

/**
 * Fixture E: early stream + agent_error on rumor_detector (no top-level `error`).
 *
 * Adapter behavior (document actual, not desired):
 * - phaseLabel → 「角色异常」
 * - agent chip + agent thought → status error
 * - live stays true (only `complete` / top-level `error` flip live off)
 * - errorMessage stays undefined (shell alert is for stream abort, not role fail)
 */
export const FIXTURE_AGENT_ERROR: OrchestrateStreamEvent[] = [
  ...FIXTURE_EARLY,
  {
    type: "agent_error",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    message: "拆题超时",
    timestamp: 5,
  },
];

/** Fixture F: complete path but report reviewer fails (需补证) */
export const FIXTURE_REVIEW_FAIL: OrchestrateStreamEvent[] = [
  ...FIXTURE_MID,
  {
    type: "agent_start",
    agent: "report_composer",
    agentName: "ReportComposer",
    timestamp: 12,
  },
  {
    type: "agent_complete",
    agent: "report_composer",
    agentName: "ReportComposer",
    output: {
      verdictType: "true",
      conclusion: "绝对致癌，无需再查。",
    },
    timestamp: 13,
  },
  {
    type: "tool_start",
    toolId: "report_reviewer",
    toolName: "Report Reviewer (proposer-reviewer)",
    query: "隔夜菜加热会致癌吗",
    timestamp: 14,
  },
  {
    type: "tool_result",
    toolId: "report_reviewer",
    toolName: "Report Reviewer (proposer-reviewer)",
    result: {
      passed: false,
      score: 48,
      issues: [
        { code: "overclaim", severity: "error", message: "结论过强，与证据不匹配" },
        { code: "missing_evidence", severity: "warn", message: "证据链为空" },
      ],
    },
    timestamp: 15,
  },
  {
    type: "complete",
    claim: "隔夜菜加热会致癌吗",
    finalReport: {
      verdictType: "unverified",
      conclusion: "证据不足，不宜给出确定性致癌结论。",
      credibilityScore: 40,
    },
    reportReview: {
      passed: false,
      score: 48,
      issues: [
        { code: "overclaim", severity: "error", message: "结论过强，与证据不匹配" },
        { code: "missing_evidence", severity: "warn", message: "证据链为空" },
      ],
    },
    timestamp: 16,
  },
];

/**
 * Fixture G: mid agents done + consensus debate (round → final).
 *
 * Adapter behavior:
 * - phaseLabel → 「冲突调解」
 * - thought kind → debate (same key, final status success)
 * - live stays true (no complete / top-level error)
 */
export const FIXTURE_DEBATE: OrchestrateStreamEvent[] = [
  ...FIXTURE_MID,
  {
    type: "consensus_debate_round",
    timestamp: 12,
    debate: {
      id: "debate-fixture-1",
      status: "running",
      title: "Agent 冲突调解室",
      conflictCount: 2,
      rounds: [
        {
          challenger: "SourceValidator",
          respondent: "FactChecker",
          challenge: "部分科普只谈储存风险，不能推出「等于致癌」。",
          response: "事实层已把该类材料降为限定证据，并保留剂量阈值缺口。",
        },
      ],
      finalConsensus: "",
      confidenceAdjustment: 0,
    },
  },
  {
    type: "consensus_debate_final",
    timestamp: 13,
    debate: {
      id: "debate-fixture-1",
      status: "resolved",
      title: "Agent 冲突调解室",
      conflictCount: 2,
      rounds: [
        {
          challenger: "SourceValidator",
          respondent: "FactChecker",
          challenge: "部分科普只谈储存风险，不能推出「等于致癌」。",
          response: "事实层已把该类材料降为限定证据，并保留剂量阈值缺口。",
        },
      ],
      finalConsensus: "结论从「加热等于致癌」降级为「储存/加热不当可能增加风险」。",
      confidenceAdjustment: -8,
    },
  },
];

/**
 * Fixture H: an agent streaming real reasoning (agent_thought increments).
 *
 * Adapter behavior:
 * - same key `agent:rumor_detector` (from agent_start) accumulates reasoning
 * - status stays loading until agent_complete
 * - reasoningElapsedMs grows from first to last increment
 */
export const FIXTURE_AGENT_THOUGHT: OrchestrateStreamEvent[] = [
  ...FIXTURE_EARLY,
  {
    type: "agent_thought",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    content: "这句是拆题的真实思考句一。",
    seq: 0,
    done: false,
    timestamp: 5,
  },
  {
    type: "agent_thought",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    content: "这句是拆题的真实思考句二。",
    seq: 1,
    done: false,
    timestamp: 6,
  },
  {
    type: "agent_thought",
    agent: "rumor_detector",
    agentName: "RumorDetector",
    content: "这句是拆题的真实思考句三。",
    seq: 2,
    done: true,
    timestamp: 7,
  },
];

/**
 * Loop-shaped live stream: Thought / Task board / Thought / Search / Thought / Visit / Thought / Visit.
 * Mimics Apodex chat process, not the pipeline DAG.
 */
export const FIXTURE_LOOP_PROGRESSIVE: OrchestrateStreamEvent[] = [
  {
    type: "agent_start",
    agent: "investigator",
    agentName: "核查",
    timestamp: 1000,
  },
  {
    type: "agent_thought",
    agent: "investigator",
    agentName: "核查",
    content: "先把这句拆成能核对的部分。",
    seq: 0,
    partial: true,
    timestamp: 1400,
  },
  {
    type: "tool_start",
    agent: "investigator",
    toolId: "todo_write",
    toolName: "todo_write",
    query: "任务板",
    timestamp: 1800,
  },
  {
    type: "tool_result",
    agent: "investigator",
    toolId: "todo_write",
    toolName: "todo_write",
    query: "任务板",
    result: {
      todos: [
        { id: "1", label: "拆开要核对的部分", status: "done" },
        { id: "2", label: "检索公开材料", status: "active" },
        { id: "3", label: "打开权威页面", status: "pending" },
      ],
    },
    timestamp: 1900,
  },
  {
    type: "agent_thought",
    agent: "investigator",
    agentName: "核查",
    content: "去搜公开材料和权威来源。",
    seq: 0,
    partial: true,
    timestamp: 2400,
  },
  {
    type: "tool_start",
    agent: "investigator",
    toolId: "web_search",
    toolName: "web_search",
    query: "隔夜菜 加热 亚硝酸盐 致癌",
    timestamp: 2800,
  },
  {
    type: "tool_result",
    agent: "investigator",
    toolId: "web_search",
    toolName: "web_search",
    query: "隔夜菜 加热 亚硝酸盐 致癌",
    result: {
      sourceCount: 2,
      sources: [
        {
          title: "食品安全与亚硝酸盐科普",
          url: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
          snippet: "储存条件相关，不等于必然致癌。",
          domain: "who.int",
        },
        {
          title: "隔夜菜风险条件说明",
          url: "https://www.cdc.gov/foodsafety/",
          snippet: "风险与温度、时间相关。",
          domain: "cdc.gov",
        },
      ],
    },
    timestamp: 3200,
  },
  {
    type: "agent_thought",
    agent: "investigator",
    agentName: "核查",
    content: "打开疾控和食安页核对原文。",
    seq: 0,
    partial: true,
    timestamp: 3600,
  },
  {
    type: "tool_start",
    agent: "investigator",
    toolId: "web_fetch",
    toolName: "web_fetch",
    query: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
    timestamp: 4000,
  },
  {
    type: "tool_result",
    agent: "investigator",
    toolId: "web_fetch",
    toolName: "web_fetch",
    query: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
    result: {
      url: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
      title: "Food safety",
    },
    timestamp: 4400,
  },
  {
    type: "agent_thought",
    agent: "investigator",
    agentName: "核查",
    content: "再看储存条件那一页。",
    seq: 0,
    partial: true,
    timestamp: 4800,
  },
  {
    type: "tool_start",
    agent: "investigator",
    toolId: "web_fetch",
    toolName: "web_fetch",
    query: "https://www.cdc.gov/foodsafety/",
    timestamp: 5200,
  },
  {
    type: "tool_result",
    agent: "investigator",
    toolId: "web_fetch",
    toolName: "web_fetch",
    query: "https://www.cdc.gov/foodsafety/",
    result: {
      url: "https://www.cdc.gov/foodsafety/",
      title: "FoodSafety",
    },
    timestamp: 5600,
  },
];
