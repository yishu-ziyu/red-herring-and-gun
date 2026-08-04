/**
 * scoreFreshness.ts — Plan P2-4 · 时间衰减策略
 *
 * 设计原则（plan §4）：
 *   - 默认不写入主公式（computeCredibilityScore 不变）
 *   - 历史事实类证据（地质/历史/政策）应豁免衰减
 *   - 未来日期视为"发布期未到"→ freshness=0（不可信）
 *   - 缺失日期按"未知"处理，不假装评分
 */

export type DomainType = "news" | "research" | "policy" | "historical" | "unknown";

export interface FreshnessInputs {
  /** 信息发布日期（ISO） */
  publishedAt?: string;
  /** 当前评估时间（ISO，可注入测试） */
  now?: string;
  /** 领域类型（影响衰减策略） */
  domain?: DomainType;
}

export interface FreshnessScore {
  /** 0-1；越新越接近 1 */
  score: number;
  /** 距今天数（仅 news/research 有效；historical/policy 为 null） */
  ageDays: number | null;
  /** 应用的衰减函数名（便于 UI 显示） */
  policy: string;
  /** 闸门不变量：未来日期 / 缺日期 / 错误输入的处理结果 */
  flags: {
    futureDate: boolean;
    missingDate: boolean;
    historicalExempt: boolean;
  };
}

export interface FreshnessPolicy {
  /** 半衰期（天）：新度减到 50% 的时间 */
  halfLifeDays: number;
  /** 最长有效期（天）：超过此值 score=0 */
  maxAgeDays: number;
  /** 是否豁免衰减 */
  exempt: boolean;
}

const DEFAULT_POLICIES: Record<DomainType, FreshnessPolicy> = {
  news: { halfLifeDays: 14, maxAgeDays: 365, exempt: false },
  research: { halfLifeDays: 365, maxAgeDays: 1825, exempt: false },
  policy: { halfLifeDays: 365, maxAgeDays: 1825, exempt: false },
  historical: { halfLifeDays: Infinity, maxAgeDays: Infinity, exempt: true },
  unknown: { halfLifeDays: 180, maxAgeDays: 1095, exempt: false },
};

/**
 * 给定发布时间和当前时间 + 领域类型，计算 freshness score。
 *
 * 算法（指数衰减）：
 *   score = 0.5 ^ (ageDays / halfLifeDays)
 *
 * 特殊 case：
 *   - 历史事实类（historical）：exempt=true，score=1 不计 age
 *   - 未来日期：score=0 + futureDate flag
 *   - 缺日期：score=0 + missingDate flag（不假装评分）
 *   - age > maxAgeDays：score=0
 */
export function scoreFreshnessFromTimestamp(inputs: FreshnessInputs): FreshnessScore {
  const policy = DEFAULT_POLICIES[inputs.domain ?? "unknown"];
  const flags = {
    futureDate: false,
    missingDate: false,
    historicalExempt: policy.exempt,
  };

  if (!inputs.publishedAt) {
    return {
      score: 0,
      ageDays: null,
      policy: inputs.domain ?? "unknown",
      flags: { ...flags, missingDate: true },
    };
  }

  const pubTime = new Date(inputs.publishedAt).getTime();
  const nowTime = inputs.now ? new Date(inputs.now).getTime() : Date.now();
  if (!Number.isFinite(pubTime) || !Number.isFinite(nowTime)) {
    return {
      score: 0,
      ageDays: null,
      policy: inputs.domain ?? "unknown",
      flags: { ...flags, missingDate: true },
    };
  }

  const ageDays = Math.floor((nowTime - pubTime) / (1000 * 60 * 60 * 24));

  if (ageDays < 0) {
    return {
      score: 0,
      ageDays,
      policy: inputs.domain ?? "unknown",
      flags: { ...flags, futureDate: true },
    };
  }

  if (policy.exempt) {
    return { score: 1, ageDays, policy: inputs.domain ?? "unknown", flags };
  }

  if (ageDays >= policy.maxAgeDays) {
    return { score: 0, ageDays, policy: inputs.domain ?? "unknown", flags };
  }

  // 指数衰减
  const score = Math.pow(0.5, ageDays / policy.halfLifeDays);
  return {
    score: Math.max(0, Math.min(1, score)),
    ageDays,
    policy: inputs.domain ?? "unknown",
    flags,
  };
}

/**
 * 简易字符串描述（用于 UI 显示）。
 */
export function describeFreshness(score: FreshnessScore): string {
  if (score.flags.missingDate) return "发布日期未知";
  if (score.flags.futureDate) return "发布日期在未来，不可信";
  if (score.flags.historicalExempt) return "历史/事实类证据，豁免衰减";
  if (score.score >= 0.8) return `${score.ageDays} 天前（较新）`;
  if (score.score >= 0.4) return `${score.ageDays} 天前（中等新度）`;
  if (score.score > 0) return `${score.ageDays} 天前（偏旧）`;
  return `${score.ageDays} 天前（已超过有效期）`;
}