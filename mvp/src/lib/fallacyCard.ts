/**
 * fallacyCard.ts — Plan P1-5 · 逻辑谬误诊断卡
 *
 * 借鉴 Master Fallacy / logicalfallies.org 的 50+ 谬误类型。
 * 我们聚焦 5 类最常见的科普/媒体语境谬误：
 *   - strawman：扭曲对方观点
 *   - false_cause：相关 ≠ 因果
 *   - hasty_gen：以个案推总体
 *   - ad_hominem：人身攻击代替论证
 *   - appeal_to_authority：滥用权威
 *
 * 闸门（plan §4）：
 *   - 不得从缺证据自动推断谬误（防止"无法验证 → 标谬误"）
 *   - span 必须可追溯到原文（offset / quote）
 */

export type FallacyType =
  | "strawman"
  | "false_cause"
  | "hasty_gen"
  | "ad_hominem"
  | "appeal_to_authority";

export interface FallacyFinding {
  type: FallacyType;
  /** 触发短语（原文子串） */
  quote: string;
  /** 原文字符偏移（可选；不可定位时为 null） */
  charOffsetStart: number | null;
  charOffsetEnd: number | null;
  /** 触发理由（一句话解释） */
  rationale: string;
  /** 0-1 confidence */
  confidence: number;
}

export interface FallacyCard {
  findings: FallacyFinding[];
  /** 全文是否有任何谬误命中 */
  hasFallacy: boolean;
  /** 命中数量 */
  count: number;
}

const FALLACY_HINTS: Array<{
  type: FallacyType;
  patterns: RegExp[];
  rationale: string;
}> = [
  {
    type: "strawman",
    patterns: [
      /说白了.*?就是/,
      /其实就是说/,
      /意思就是/,
      /换句话说.*?其实/,
      /他们想要.*?其实就是/,
    ],
    rationale: "用更弱/夸张版本重述对方观点再反驳",
  },
  {
    type: "false_cause",
    patterns: [
      /因为.*?所以/,
      /导致了|引发|造成|催生/,
      /正是因为.*?才/,
    ],
    rationale: "仅展示相关性/时间相邻，未给出因果机制或反事实",
  },
  {
    type: "hasty_gen",
    patterns: [
      /某地某事.*?所以.*?都/,
      /看到.*?就说明/,
      /这就是/,
    ],
    rationale: "从单一案例或个别现象推出总体结论",
  },
  {
    type: "ad_hominem",
    patterns: [
      /某某人.*?(蠢|坏|别有用心|动机不纯|不配)/,
      /说这种话的人.*?/,
    ],
    rationale: "针对发言者身份而非论证内容进行攻击",
  },
  {
    type: "appeal_to_authority",
    patterns: [
      /权威人士.*?说/,
      /专家.*?指出/,
      /根据.*?(教授|院士|首席科学家)/,
    ],
    rationale: "引用权威身份作为唯一论据，未引用具体证据",
  },
];

/**
 * 在一段文本里检测谬误。
 *
 * MVP：基于关键词/正则 + 字符偏移定位。
 * 注意：**绝不** 因"证据不足"自动推断"必然谬误"。
 */
export function detectFallacies(text: string): FallacyCard {
  const t = text ?? "";
  if (t.length === 0) return { findings: [], hasFallacy: false, count: 0 };

  const findings: FallacyFinding[] = [];

  for (const hint of FALLACY_HINTS) {
    for (const pat of hint.patterns) {
      const match = pat.exec(t);
      if (!match) continue;
      const start = match.index;
      const end = match.index + match[0].length;
      // 防重复：同 type 同 span 跳过
      if (
        findings.some(
          (f) => f.type === hint.type && f.charOffsetStart === start && f.charOffsetEnd === end,
        )
      ) {
        continue;
      }
      // confidence：按匹配长度 / 全文长度近似，长引文置信度高
      const confidence = Math.max(
        0.4,
        Math.min(0.95, match[0].length / 14),
      );
      findings.push({
        type: hint.type,
        quote: match[0],
        charOffsetStart: start,
        charOffsetEnd: end,
        rationale: hint.rationale,
        confidence,
      });
    }
  }

  // 按 confidence 降序
  findings.sort((a, b) => b.confidence - a.confidence);

  return {
    findings,
    hasFallacy: findings.length > 0,
    count: findings.length,
  };
}

/** 单条谬误的人类可读中文标签 */
export const FALLACY_TYPE_LABELS: Record<FallacyType, string> = {
  strawman: "稻草人谬误",
  false_cause: "相关≠因果",
  hasty_gen: "以偏概全",
  ad_hominem: "人身攻击",
  appeal_to_authority: "诉诸权威",
};