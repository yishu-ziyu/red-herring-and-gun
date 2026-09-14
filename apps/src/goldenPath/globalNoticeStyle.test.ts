/**
 * W4（契约 docs/evals/2026-09-12-evidence-base.md Part 0）：历史打开失败/超时的全局提示
 * `gp-global-notice` 要有最小可读样式，且不动布局。
 * jsdom 不排版，这里守 CSS 契约（同 followUpSection.test.tsx 的 P2-1 做法）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

const baseBlock = () => css.match(/\.gp-global-notice\s*\{([^}]*)\}/)![1]!;
const alertBlock = () => css.match(/\.gp-global-notice\[role="alert"\]\s*\{([^}]*)\}/)![1]!;

describe("W4 gp-global-notice 最小可读样式", () => {
  it("类名真的挂在提示上，样式给到字号/行高/颜色/内边距/圆角", () => {
    expect(app).toContain('className="gp-global-notice"');

    const block = baseBlock();
    expect(block).toContain("font-size: 13px");
    expect(block).toContain("line-height: 1.6");
    expect(block).toContain("padding:");
    expect(block).toMatch(/color:\s*var\(--gp-ink-2\)/);
    expect(block).toMatch(/border-radius:\s*var\(--gp-radius-sm\)/);
    expect(block).toContain("width:");
  });

  it("失败/超时（role=alert）在既有语义色体系内，和普通状态行区分得开", () => {
    const alert = alertBlock();
    expect(alert).toMatch(/color:\s*var\(--gp-accent-deep\)/);
    expect(alert).toMatch(/background:\s*var\(--gp-accent-subtle\)/);
    expect(alert).toMatch(/border-color:\s*var\(--gp-accent\)/);
  });

  it("不动布局：不新增定位与层级", () => {
    const block = baseBlock();
    expect(block).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    expect(block).not.toContain("z-index");
  });
});
