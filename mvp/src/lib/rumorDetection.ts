/**
 * rumorDetection.ts — 谣言特征检测
 *
 * 基于规则的谣言特征检测，无需LLM即可快速识别常见谣言特征。
 * 用于Dashboard输入时的即时反馈和DiagnosisBanner展示。
 */

export interface RumorDetectionResult {
  indicators: string[];
  severity: "low" | "medium" | "high";
  suggestions: string[];
}

const RUMOR_PATTERNS = [
  {
    id: "absolutism",
    name: "绝对化表述",
    patterns: [/绝对|肯定|一定|100%|百分之百|必然|永远|所有|都|全|无一例外/],
    suggestion: "绝对化表述往往是谣言的特征，真实信息通常会留有余地。",
  },
  {
    id: "anonymous_source",
    name: "匿名信源",
    patterns: [/内部消息|知情人士|独家|爆料|小道消息|内部人士|相关负责人|权威人士/],
    suggestion: "匿名信源无法核实，需要寻找原始出处。",
  },
  {
    id: "fear_appeal",
    name: "恐惧诉求",
    patterns: [/致癌|中毒|致死|危险|警告|注意|千万别|千万不要|紧急|速看|赶紧|马上/],
    suggestion: "利用恐惧情绪传播的信息需要特别谨慎对待。",
  },
  {
    id: "emotional_manipulation",
    name: "情绪煽动",
    patterns: [/震惊|炸了|疯了|吓死|愤怒| outrage| 气死| 简直| 无法忍受| 天理难容/],
    suggestion: "情绪煽动性语言往往是为了掩盖事实的不足。",
  },
  {
    id: "vague_reference",
    name: "模糊引用",
    patterns: [/科学家说|研究表明|专家发现|调查发现|数据显示|实验证明/],
    negativePatterns: [/\d{4}年|《[^》]+》|[^，。]+等[^，。]+发现/],
    suggestion: "模糊引用「专家」或「研究」但未指明具体来源，是常见谣言手法。",
  },
  {
    id: "call_to_action",
    name: "煽动传播",
    patterns: [/不转不是|赶紧转发|马上删除|速扩散|转发给|让更多人知道|快告诉/],
    suggestion: "要求快速转发的信息往往是谣言传播的典型特征。",
  },
  {
    id: "conspiracy",
    name: "阴谋论暗示",
    patterns: [/幕后|黑手|操控|掩盖|隐瞒|真相被|不想让你知道|不可告人/],
    suggestion: "阴谋论暗示通常缺乏可验证的证据链。",
  },
  {
    id: "false_urgency",
    name: "虚假紧迫性",
    patterns: [/倒计时|最后.*天|即将|马上|立刻|再不.*就|来不及了/],
    suggestion: "制造虚假紧迫性是促使人们不经思考就传播信息的常见手段。",
  },
];

export function detectRumorIndicators(claim: string): RumorDetectionResult {
  const indicators: string[] = [];
  const matchedPatterns: string[] = [];

  for (const rule of RUMOR_PATTERNS) {
    const hasMatch = rule.patterns.some((pattern) => pattern.test(claim));
    const hasNegativeMatch = rule.negativePatterns
      ? rule.negativePatterns.some((pattern) => pattern.test(claim))
      : false;

    if (hasMatch && !hasNegativeMatch) {
      indicators.push(rule.name);
      matchedPatterns.push(rule.id);
    }
  }

  // 计算严重程度
  let severity: "low" | "medium" | "high" = "low";
  if (indicators.length >= 4) {
    severity = "high";
  } else if (indicators.length >= 2) {
    severity = "medium";
  }

  // 生成建议
  const suggestions = indicators.map((name, index) => {
    const rule = RUMOR_PATTERNS.find((r) => r.name === name);
    return rule?.suggestion || "";
  }).filter(Boolean);

  return { indicators, severity, suggestions };
}

/**
 * 快速检测：只返回特征名称列表，用于DiagnosisBanner展示
 */
export function quickDetectRumorFeatures(claim: string): string[] {
  return detectRumorIndicators(claim).indicators;
}

/**
 * 获取可信度评分（0-100）
 * 特征越多，可信度越低
 */
export function calculateRumorCredibilityScore(claim: string): number {
  const { indicators, severity } = detectRumorIndicators(claim);

  if (severity === "high") return 20;
  if (severity === "medium") return 50;
  if (indicators.length > 0) return 70;
  return 85;
}
