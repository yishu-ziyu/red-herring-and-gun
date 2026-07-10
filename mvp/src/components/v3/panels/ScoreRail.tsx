import { useMemo } from "react";

/**
 * ScoreRail — 可信度评分的可视化栏目
 *
 * 设计语言:
 * - 顶部:大号 display 字号总分 + 等级标签
 * - 中部:主条 (0..100 单极)+ 刻度标记 (0/20/40/60/80/100)
 * - 下部:三轴分量 (-1..+1 双极,0 基线居中)
 * - 底栏:风险标签 (基于阈值)
 *
 * 数据契约:
 *   scoreBreakdown = { factCheckSignal, searchSignal, sourceSignal } in [-1, 1]
 *   credibilityScore = 0..100
 *   credibilityLabel = 中文等级 ("谣言" / "高度可疑" / "部分可信" / "基本可信" / "可信")
 */

interface ScoreRailProps {
  scoreBreakdown: Record<string, number>;
  credibilityScore: number;
  credibilityLabel: string;
}

interface ComponentSpec {
  key: keyof typeof SIGNAL_LABELS;
  label: string;
  short: string;
  hint: string;
}

const SIGNAL_LABELS = {
  factCheckSignal: "事实核查",
  searchSignal: "搜索证据",
  sourceSignal: "来源可靠",
} as const;

const COMPONENT_ORDER: ComponentSpec[] = [
  { key: "factCheckSignal", label: "事实核查", short: "核查", hint: "Agent 跑核心命题的真伪" },
  { key: "searchSignal", label: "搜索证据", short: "搜索", hint: "公开网络的支持 / 反证密度" },
  { key: "sourceSignal", label: "来源可靠", short: "来源", hint: "原始材料可信度均值" },
];

const TICK_POSITIONS = [0, 20, 40, 60, 80, 100];

function classifyByScore(score: number): { tier: "danger" | "warn" | "ok" | "great"; tierLabel: string } {
  if (score < 20) return { tier: "danger", tierLabel: "谣言高危" };
  if (score < 40) return { tier: "warn", tierLabel: "高度可疑" };
  if (score < 70) return { tier: "ok", tierLabel: "部分可信" };
  return { tier: "great", tierLabel: "基本可信" };
}

function deriveRiskChips(breakdown: Record<string, number>, score: number): { kind: "danger" | "warn" | "neutral"; label: string }[] {
  const chips: { kind: "danger" | "warn" | "neutral"; label: string }[] = [];
  const src = breakdown.sourceSignal ?? 0;
  const fc = breakdown.factCheckSignal ?? 0;
  const sr = breakdown.searchSignal ?? 0;

  if (score < 40) chips.push({ kind: "danger", label: "整体证据不足" });
  if (src < -0.2) chips.push({ kind: "danger", label: "主流来源缺失" });
  if (src < 0.2) chips.push({ kind: "warn", label: "来源稳定性偏低" });
  if (Math.abs(sr) < 0.15) chips.push({ kind: "warn", label: "反证覆盖不足" });
  if (fc < -0.1) chips.push({ kind: "danger", label: "核心事实被推翻" });
  if (score >= 70 && fc > 0.3 && src > 0.2) chips.push({ kind: "neutral", label: "近期主流媒体有覆盖" });
  return chips.length > 0 ? chips : [{ kind: "neutral", label: "本次评估未触发风险标志" }];
}

export function ScoreRail({ scoreBreakdown, credibilityScore, credibilityLabel }: ScoreRailProps) {
  const { tier, tierLabel } = useMemo(
    () => classifyByScore(credibilityScore),
    [credibilityScore],
  );

  const riskChips = useMemo(
    () => deriveRiskChips(scoreBreakdown, credibilityScore),
    [scoreBreakdown, credibilityScore],
  );

  return (
    <section className={`score-rail score-rail--${tier}`} aria-label="可信度评分">
      {/* 顶部:总条 */}
      <header className="score-rail-head">
        <div className="score-rail-head-label">
          <span className="small-caps">总体可信度</span>
          <span className={`score-rail-tier-pill score-rail-tier-pill--${tier}`}>{tierLabel}</span>
        </div>
        <div className="score-rail-head-figure">
          <strong className="score-rail-figure">{credibilityScore}</strong>
          <span className="score-rail-figure-denominator">/100</span>
          <span className="score-rail-label">{credibilityLabel}</span>
        </div>
      </header>

      {/* 主条 + 刻度 */}
      <div className="score-rail-main">
        <div className="score-rail-main-track">
          <div
            className="score-rail-main-fill"
            style={{ width: `${Math.max(0, Math.min(100, credibilityScore))}%` }}
          />
          {/* 阈值标记 */}
          <span className="score-rail-tick score-rail-tick--20" style={{ left: "20%" }} />
          <span className="score-rail-tick score-rail-tick--40" style={{ left: "40%" }} />
          <span className="score-rail-tick score-rail-tick--60" style={{ left: "60%" }} />
          <span className="score-rail-tick score-rail-tick--80" style={{ left: "80%" }} />
        </div>
        <ol className="score-rail-ticks" aria-hidden="true">
          {TICK_POSITIONS.map((t) => (
            <li key={t} className="score-rail-ticks-item" style={{ left: `${t}%` }}>
              <span className="score-rail-ticks-num">{t}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* 三轴分量 (双极 -1..+1) */}
      <div className="score-rail-signals">
        <div className="score-rail-signals-title small-caps">三项分量</div>
        <ul className="score-rail-signals-list">
          {COMPONENT_ORDER.map((spec, idx) => {
            const raw = scoreBreakdown[spec.key];
            const value = typeof raw === "number" ? raw : 0;
            // 双极轴: 0 = 中间, -1 = 最左, +1 = 最右
            const positionPct = 50 + value * 50;
            const verdict =
              value > 0.2 ? "supports" : value < -0.2 ? "opposes" : "neutral";
            return (
              <li
                key={spec.key}
                className={`score-rail-signal score-rail-signal--${verdict}`}
                style={{ animationDelay: `${idx * 120 + 280}ms` }}
              >
                <div className="score-rail-signal-label">
                  <span className="score-rail-signal-name">{spec.label}</span>
                  <span className="score-rail-signal-hint">{spec.hint}</span>
                </div>
                <div className="score-rail-signal-axis" aria-hidden="true">
                  <span className="score-rail-signal-zero" />
                  <span
                    className="score-rail-signal-mark"
                    style={{ left: `${positionPct}%` }}
                  >
                    <span className="score-rail-signal-dot" />
                  </span>
                </div>
                <div className="score-rail-signal-num">
                  {value >= 0 ? "+" : ""}
                  {value.toFixed(2)}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 风险标签 */}
      <footer className="score-rail-risks">
        <span className="score-rail-risks-label small-caps">风险标签</span>
        <div className="score-rail-chips">
          {riskChips.map((chip, i) => (
            <span
              key={`${chip.label}-${i}`}
              className={`score-rail-chip score-rail-chip--${chip.kind}`}
            >
              {chip.kind === "danger" ? "⚠ " : chip.kind === "warn" ? "△ " : "· "}
              {chip.label}
            </span>
          ))}
        </div>
      </footer>
    </section>
  );
}