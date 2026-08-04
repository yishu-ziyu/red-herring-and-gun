/**
 * claimDecomposer.ts — Claim 拆解器
 *
 * MVP Demo 阶段：提供模拟拆解逻辑
 * 后续迭代：接入真实 LLM 进行智能 claim 分解
 */

import type { ClaimDecompositionResult, AtomicProposition } from "./schemas";

/**
 * 模拟拆解 claim 为原子命题
 * 当前为 MVP Demo 实现，返回预定义结果
 */
export async function decomposeClaim(
  claim: string
): Promise<ClaimDecompositionResult> {
  // TODO: 接入真实 LLM 进行智能分解
  // 当前返回模拟数据以支撑 MVP Demo

  const atomicPropositions: AtomicProposition[] = [
    {
      id: "prop-a",
      text: `"${claim}" 的核心事实是否可被直接验证`,
      type: "事实陈述",
      verifiability: "可直接验证",
    },
    {
      id: "prop-b",
      text: `该 claim 中的关键归因或技术描述是否准确`,
      type: "归因断言",
      verifiability: "可直接验证",
    },
    {
      id: "prop-c",
      text: `该 claim 中的数值或效果数据是否有权威来源支撑`,
      type: "数值断言",
      verifiability: "需间接推断",
    },
  ];

  return {
    originalClaim: claim,
    atomicPropositions,
    decompositionReasoning:
      "将复杂 claim 拆分为三个可独立验证的维度：事实存在性、技术属性准确性、效果数据可信度。",
  };
}

/**
 * 快速检查 claim 是否适合进行交叉验证
 */
export function isClaimVerifiable(claim: string): {
  verifiable: boolean;
  reason: string;
} {
  if (!claim || claim.trim().length < 10) {
    return { verifiable: false, reason: "Claim 过短，无法提取有效断言" };
  }

  // 检查是否包含可验证的事实性内容
  const hasFactualContent = /[0-9%年月日]|是|有|推出|发布|实施/.test(claim);
  if (!hasFactualContent) {
    return {
      verifiable: false,
      reason: "未检测到可验证的事实性内容（如时间、数字、具体行为）",
    };
  }

  return { verifiable: true, reason: "包含可验证的事实性断言" };
}

// ─── Plan P1-1 · IBM Project Debater KPA（Key Point Analysis）──────
//
// 借鉴 IBM Project Debater 的 Key Point Analysis（Bar-Haim et al. 2020）：
//   - 输入：长文/截图/文章
//   - 输出：主论点 + 支持论点 + 反对论点 + 上下文论点
//   - 每项含原文 span，可回溯
//
// 用途：长文/截图输入时，先抽取 Key Points，再走子命题拆分。
// 区别于 decomposeClaim：KPA 是"从语料抽论点"，decomposeClaim 是"从一句话拆命题"。

export type KeyPointStance = "support" | "oppose" | "context";

export interface KeyPoint {
  /** 稳定 ID；同一输入必须输出同一 ID（可重放） */
  id: string;
  /** 抽取出的论点短句 */
  text: string;
  /** 立场 */
  stance: KeyPointStance;
  /** 原文 span（字符偏移） */
  spanRange: { start: number; end: number };
  /** 匹配强度（0-1） */
  confidence: number;
}

const KPA_LENGTH_LIMIT = 1500;
const KPA_MAX_POINTS = 10;

const STANCE_HINT: Array<{ stance: KeyPointStance; regex: RegExp }> = [
  { stance: "support", regex: /应该|有利于|支持|证明|确凿|明显|显著|有效|成功/ },
  { stance: "oppose", regex: /不能|不应|反对|质疑|批评|不足|未必|存疑|无法|否认|辟谣|失实/ },
  { stance: "context", regex: /此前|同时|但是|然而|不过|尽管|另一方面|此外|值得注意的是/ },
];

/**
 * 从一段长文本中抽取 Key Points（支持/反对/上下文）。
 * MVP 阶段：基于句法 + 关键词提示词做确定性抽取。
 * 后续可接入 LLM 做语义级 KPA。
 */
export async function extractKeyPoints(rawInput: string): Promise<KeyPoint[]> {
  const text = (rawInput ?? "").trim();
  if (!text) return [];

  const capped = text.length > KPA_LENGTH_LIMIT ? text.slice(0, KPA_LENGTH_LIMIT) : text;

  // 切句：中英文混合（中句号/英句号/感叹号/问号/分号）
  const sentenceRegex = /[^。！？!?；;]+[。！？!?；;]?/g;
  const sentences: Array<{ text: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = sentenceRegex.exec(capped)) !== null) {
    const seg = m[0].trim();
    if (seg.length < 6) continue; // 太短的碎片忽略
    sentences.push({
      text: seg,
      start: m.index,
      end: m.index + seg.length,
    });
  }
  if (sentences.length === 0) return [];

  // 给每个句子打 stance + confidence
  const candidates: Array<KeyPoint & { _score: number }> = sentences.map((s, idx) => {
    let stance: KeyPointStance = "context";
    let stanceHit = 0;
    for (const hint of STANCE_HINT) {
      const hits = (s.text.match(new RegExp(hint.regex.source, "g")) ?? []).length;
      if (hits > stanceHit) {
        stance = hint.stance;
        stanceHit = hits;
      }
    }
    // confidence：长句 + 多 stance hint → 高；过短或纯背景 → 低
    const lengthScore = Math.min(1, s.text.length / 40);
    const confidence = Math.max(0.2, Math.min(0.95, lengthScore * 0.7 + stanceHit * 0.15));

    return {
      // 稳定 ID：hash(text + stance + index) — 同一输入 → 同 ID
      id: `kp-${idx.toString().padStart(2, "0")}-${stance}`,
      text: s.text,
      stance,
      spanRange: { start: s.start, end: s.end },
      confidence,
      _score: confidence * (stance === "context" ? 0.5 : 1),
    };
  });

  // 去重：同 stance 同文本 → 只保留 confidence 最高的
  const dedup = new Map<string, KeyPoint>();
  for (const c of candidates) {
    const key = `${c.stance}::${c.text}`;
    const prev = dedup.get(key);
    if (!prev || prev.confidence < c.confidence) {
      const { _score, ...kp } = c;
      dedup.set(key, kp);
    }
  }

  // 按 _score 降序 + 取前 KPA_MAX_POINTS
  const sorted = Array.from(dedup.values()).sort(
    (a, b) => b.confidence - a.confidence,
  );
  const top = sorted.slice(0, KPA_MAX_POINTS);

  // 必须同时有 support 和 oppose；缺则从 context 晋升
  const hasSupport = top.some((k) => k.stance === "support");
  const hasOppose = top.some((k) => k.stance === "oppose");
  if (!hasSupport && !hasOppose) {
    // 全是 context 时，给第一条人工标 support（中性起步）
    if (top.length > 0) top[0] = { ...top[0], stance: "support" };
  }
  return top;
}

/**
 * 是否启用 KPA 阶段（长文/截图/多句输入）。
 * 单句短文本不走 KPA，直接走 decomposeClaim。
 * 判定：≥2 个完整句子（中英文混句号）+ ≥10 字符长度。
 */
export function shouldRunKPA(rawInput: string): boolean {
  const t = (rawInput ?? "").trim();
  if (t.length < 10) return false;
  const sentenceCount = (t.match(/[。！？!?；;]/g) ?? []).length;
  return sentenceCount >= 2;
}
