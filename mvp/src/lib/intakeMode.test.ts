/**
 * intakeMode.test.ts — Plan P2-5 · 编辑室 / 学术特化模式
 *
 * 关键校验：
 *   - 3 种 mode 配置完整（general/newsroom/research）
 *   - 不改 grounding 硬约束（plan §4 冻结）
 *   - needsHumanReview 阈值符合各自定位
 *   - validateIntakeModes 互斥校验
 */

import { describe, expect, it } from "vitest";
import {
  getIntakeModeConfig,
  INTAKE_MODE_CONFIGS,
  needsHumanReview,
  validateIntakeModes,
  type IntakeMode,
} from "./intakeMode";

describe("Plan P2-5 · INTAKE_MODE_CONFIGS", () => {
  it("三种 mode 完整：general/newsroom/research", () => {
    expect(Object.keys(INTAKE_MODE_CONFIGS).sort()).toEqual(
      ["general", "newsroom", "research"].sort(),
    );
  });

  it("research 启用 APA 引用 + DOI 优先", () => {
    expect(INTAKE_MODE_CONFIGS.research.citationFormat).toBe("apa");
    expect(INTAKE_MODE_CONFIGS.research.preferAcademicSources).toBe(true);
  });

  it("newsroom 启用 batch + 多 suggestedActions", () => {
    expect(INTAKE_MODE_CONFIGS.newsroom.allowBatch).toBe(true);
    expect(INTAKE_MODE_CONFIGS.newsroom.suggestedActions.length).toBeGreaterThan(
      INTAKE_MODE_CONFIGS.general.suggestedActions.length,
    );
  });

  it("闸门：research 仍不绕过 grounding（suggestedActions 中不应包含自动批准）", () => {
    expect(INTAKE_MODE_CONFIGS.research.suggestedActions).not.toContain("share_public");
  });

  it("newsroom 阈值 > general 阈值（编辑室更谨慎）", () => {
    expect(INTAKE_MODE_CONFIGS.newsroom.humanReviewThreshold).toBeGreaterThan(
      INTAKE_MODE_CONFIGS.general.humanReviewThreshold,
    );
  });
});

describe("Plan P2-5 · getIntakeModeConfig", () => {
  it("合法 mode 返回正确配置", () => {
    expect(getIntakeModeConfig("research").label).toContain("学术");
    expect(getIntakeModeConfig("newsroom").label).toContain("编辑室");
  });

  it("未知 mode 兜底 general", () => {
    const cfg = getIntakeModeConfig("unknown-mode-xyz");
    expect(cfg).toEqual(INTAKE_MODE_CONFIGS.general);
  });
});

describe("Plan P2-5 · needsHumanReview", () => {
  it("general mode：score < 30 需人审", () => {
    expect(needsHumanReview(29, "general")).toBe(true);
    expect(needsHumanReview(30, "general")).toBe(false);
  });

  it("newsroom mode：score < 50 需人审（更谨慎）", () => {
    expect(needsHumanReview(49, "newsroom")).toBe(true);
    expect(needsHumanReview(51, "newsroom")).toBe(false);
  });

  it("research mode：score < 20 需人审（学术容忍度更低）", () => {
    expect(needsHumanReview(19, "research")).toBe(true);
    expect(needsHumanReview(25, "research")).toBe(false);
  });
});

describe("Plan P2-5 · validateIntakeModes", () => {
  it("单 mode 有效", () => {
    expect(validateIntakeModes(["general"]).valid).toBe(true);
    expect(validateIntakeModes(["research"]).valid).toBe(true);
    expect(validateIntakeModes(["newsroom"]).valid).toBe(true);
  });

  it("多 mode 互斥失败", () => {
    const r = validateIntakeModes(["general", "research"]);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("互斥");
  });

  it("空数组无效", () => {
    const r = validateIntakeModes([]);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("至少");
  });
});