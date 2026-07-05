import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E for v4-ui: 用 file inspection 验证设计令牌 / cinema motion library / 零 framer-motion 引入。
 * 因为 v4 主要是 CSS 重构,grep 是最高 seam。
 */

const PROJECT_ROOT = resolve(__dirname, "../../..");
const STYLES = resolve(PROJECT_ROOT, "mvp/src/styles.css");

describe("v4-ui E2E: 设计令牌", () => {
  it("8 档动效时长全部就位", () => {
    const css = readFileSync(STYLES, "utf-8");
    const tiers = ["instant", "quick", "base", "soft", "narrative", "cinema", "epic", "reveal"];
    for (const t of tiers) {
      expect(css).toMatch(new RegExp(`--t-${t}\\s*:`));
    }
  });

  it("7 组动效组合全部就位 (peer spec 修正后)", () => {
    const css = readFileSync(STYLES, "utf-8");
    const combos = ["pop", "fade", "rise", "cinematic", "epic", "reveal", "glide"];
    for (const c of combos) {
      expect(css).toMatch(new RegExp(`--motion-${c}\\s*:`));
    }
  });

  it("8 档排版层级全部就位", () => {
    const css = readFileSync(STYLES, "utf-8");
    const tiers = ["display", "headline", "title", "subtitle", "body", "meta", "caption", "micro"];
    for (const t of tiers) {
      expect(css).toMatch(new RegExp(`--type-${t}\\s*:`));
    }
  });

  it("4 级深度全部就位", () => {
    const css = readFileSync(STYLES, "utf-8");
    for (const d of ["paper", "card", "float", "cinematic"]) {
      expect(css).toMatch(new RegExp(`--depth-${d}\\s*:`));
    }
  });

  it("6 组渐变全部就位", () => {
    const css = readFileSync(STYLES, "utf-8");
    for (const g of ["narrative", "veil", "amber", "ink", "success", "alert"]) {
      expect(css).toMatch(new RegExp(`--gradient-${g}\\s*:`));
    }
  });
});

describe("v4-ui E2E: Cinema Motion Library", () => {
  it("8 个 keyframes 全部存在", () => {
    const css = readFileSync(STYLES, "utf-8");
    for (const k of ["rise", "fall", "veil", "traverse", "glide", "glow", "shimmer", "breath"]) {
      expect(css).toContain(`@keyframes cinema-${k}`);
    }
  });

  it("motion-blur 隐喻存在 (rise 用 blur+saturate 联动)", () => {
    const css = readFileSync(STYLES, "utf-8");
    const riseMatch = css.match(/@keyframes cinema-rise\s*{([^}]*)}/s);
    expect(riseMatch).not.toBeNull();
    expect(riseMatch![1]).toContain("blur(");
    expect(riseMatch![1]).toContain("saturate(");
  });

  it("stagger nth-child 自动错峰", () => {
    const css = readFileSync(STYLES, "utf-8");
    expect(css).toMatch(/\.cinema-stagger\s*>\s*\*\s*{[\s\S]*?animation-delay/);
    expect(css).toMatch(/\.cinema-stagger\s*>\s*\*:nth-child\(1\)/);
    expect(css).toMatch(/\.cinema-stagger\s*>\s*\*:nth-child\(8\)/);
  });
});

describe("v4-ui E2E: v4 改动的零 framer-motion / gsap 依赖", () => {
  it("v4 改动的 tsx 文件不引入 framer-motion 或 gsap", () => {
    const result = execSync(
      `git diff 3f96e0c..HEAD -- mvp/src/components/v3/ConclusionDockV3.tsx mvp/src/components/v3/auth/LoginView.tsx mvp/src/components/v3/Dashboard.tsx mvp/src/components/v3/settings/PrivacyPolicy.tsx mvp/src/components/v3/panels/InferenceLicensePanel.tsx mvp/src/components/v3/panels/ReasoningTracePanel.tsx mvp/src/components/v3/mission/AgentStatusDot.tsx`,
      { cwd: PROJECT_ROOT, encoding: "utf-8" }
    );
    expect(result).not.toMatch(/framer-motion|gsap/);
  });
});

// 不在测试里递归 npm test,该回归通过 CI 验证 (102 + 11) = 113 tests pass