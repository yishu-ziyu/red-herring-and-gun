/**
 * intakeMode.ts — Plan P2-5 · 编辑室 / 学术特化模式
 *
 * 借鉴 Full Fact 大选直播核查 + Consensus 学术模式：
 *   - "general"：普通用户提交说法（默认）
 *   - "newsroom"：编辑室批量核查 + 人工批准工作流
 *   - "research"：学术研究模式（DOI 优先 + APA/MLA 导出）
 *
 * 设计原则（plan §4）：
 *   - 不改 grounding 硬约束（plan §4 冻结项）
 *   - mode 只调整：输出格式 + 证据权重 + 后续动作建议
 *   - 模式间互斥（同一 case 不可同时 general + research）
 */

export type IntakeMode = "general" | "newsroom" | "research";

export interface IntakeModeConfig {
  /** 默认评分阈值（低于此值需要人工审核） */
  humanReviewThreshold: number;
  /** 引用导出格式 */
  citationFormat: "none" | "apa" | "mla";
  /** 是否启用 DOI 优先通道 */
  preferAcademicSources: boolean;
  /** 是否允许批量提交 */
  allowBatch: boolean;
  /** 完成后建议动作 */
  suggestedActions: ReadonlyArray<"share_public" | "archive_doubt" | "follow_up" | "needs_review">;
  /** UI 标签 */
  label: string;
}

export const INTAKE_MODE_CONFIGS: Record<IntakeMode, IntakeModeConfig> = {
  general: {
    humanReviewThreshold: 30,
    citationFormat: "none",
    preferAcademicSources: false,
    allowBatch: false,
    suggestedActions: ["share_public", "archive_doubt"],
    label: "普通核查",
  },
  newsroom: {
    humanReviewThreshold: 50, // 编辑室对中分也谨慎
    citationFormat: "none",
    preferAcademicSources: false,
    allowBatch: true,
    suggestedActions: ["needs_review", "share_public", "archive_doubt", "follow_up"],
    label: "编辑室模式",
  },
  research: {
    humanReviewThreshold: 20,
    citationFormat: "apa",
    preferAcademicSources: true,
    allowBatch: true,
    suggestedActions: ["archive_doubt", "follow_up"],
    label: "学术研究模式",
  },
};

/**
 * 取得指定 mode 的配置；未知 mode 兜底 general。
 */
export function getIntakeModeConfig(mode: string): IntakeModeConfig {
  if (mode in INTAKE_MODE_CONFIGS) {
    return INTAKE_MODE_CONFIGS[mode as IntakeMode];
  }
  return INTAKE_MODE_CONFIGS.general;
}

/**
 * 判定 report 是否需要人工审核。
 */
export function needsHumanReview(score: number, mode: IntakeMode): boolean {
  const cfg = INTAKE_MODE_CONFIGS[mode];
  return score < cfg.humanReviewThreshold;
}

/**
 * 模式间互斥校验：同一 intake 不可同时选 2 个 mode。
 */
export function validateIntakeModes(modes: ReadonlyArray<IntakeMode>): {
  valid: boolean;
  reason?: string;
} {
  if (modes.length === 0) return { valid: false, reason: "至少选择 1 个 mode" };
  if (modes.length > 1) return { valid: false, reason: "同一 case 不可选多个 mode（互斥）" };
  return { valid: true };
}