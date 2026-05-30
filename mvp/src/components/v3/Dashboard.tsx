/**
 * Dashboard.tsx — 红鲱鱼与枪首页落地页
 *
 * 设计方向：
 * - 品牌优先：Logo + 品牌名醒目展示
 * - 红黑配色源自 Logo：ink-black + crimson-red
 * - 衬线标题 + 无衬线正文，esther-design-system 风格
 * - 单页落地页：Hero → Input → Features → Footer
 */

import { useState, useCallback } from "react";

interface DashboardProps {
  onStartAnalysis: (claim: string, caseId?: string, orchestrate?: boolean) => void;
  onStartConsensusDemo?: () => void;
}

const FEATURES = [
  {
    icon: "🔍",
    title: "多引擎交叉验证",
    desc: "360 Search / AnySearch / Metaso 并行检索，自动去重与来源分级",
  },
  {
    icon: "🧠",
    title: "实时流式推理",
    desc: "Claim 拆解 → 搜索策略 → 共识评估 → FIRE 置信度，全过程可视",
  },
  {
    icon: "⚡",
    title: "国产大模型链路",
    desc: "StepFun 3.7 / MiMo 2.5 / DeepSeek 多模型协同，无结论预设",
  },
  {
    icon: "🛡️",
    title: "证据边界审计",
    desc: "每一条结论都有明确的证据支撑范围，不可说的绝不强说",
  },
];

export function Dashboard({ onStartAnalysis, onStartConsensusDemo }: DashboardProps) {
  const [inputValue, setInputValue] = useState("");

  const handleStart = useCallback(() => {
    const claim = inputValue.trim();
    if (claim) {
      onStartAnalysis(claim, undefined, true);
    }
  }, [inputValue, onStartAnalysis]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleStart();
      }
    },
    [handleStart]
  );

  return (
    <div className="landing-page">
      {/* ── Hero Section ── */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          {/* Logo */}
          <div className="landing-brand">
            <img
              src="/logo.png"
              alt="红鲱鱼与枪"
              className="landing-logo"
            />
            <h1 className="landing-title">
              <span className="landing-title-dark">红鲱鱼</span>
              <span className="landing-title-red">与枪</span>
            </h1>
          </div>

          {/* Tagline */}
          <p className="landing-tagline">
            信息真相猎人
          </p>
          <p className="landing-subtitle">
            AI 驱动的谣言核查与事实追踪系统
            <br />
            每一条结论都有证据边界，不可说的绝不强说
          </p>
        </div>
      </section>

      {/* ── Input Section ── */}
      <section className="landing-input-section">
        <div className="landing-input-card">
          <label htmlFor="claim-input" className="landing-input-label">
            输入一条你看到的疑似谣言或信息
          </label>
          <textarea
            id="claim-input"
            name="claim"
            className="landing-input"
            placeholder="例如：清华大学食堂推出「AI营养师」配餐系统，学生使用后营养不良率下降30%..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={4}
          />
          <div className="landing-input-actions">
            <button
              className="landing-submit-btn"
              onClick={handleStart}
              type="button"
              disabled={!inputValue.trim()}
            >
              <span className="landing-submit-icon">🔎</span>
              启动真实核查
            </button>
            {onStartConsensusDemo && (
              <button
                className="landing-demo-btn"
                onClick={onStartConsensusDemo}
                type="button"
              >
                <span className="landing-submit-icon">🔬</span>
                体验交叉验证 Demo
              </button>
            )}
          </div>
          <p className="landing-input-hint">
            真实 Agent 链路：RumorDetector → FactChecker → SourceValidator → ReportComposer
            <br />
            多搜索引擎：360 Search / AnySearch / Metaso / Tavily / Exa
          </p>
        </div>
      </section>

      {/* ── Features Section ── */}
      <section className="landing-features">
        <div className="landing-features-grid">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="landing-feature-card">
              <span className="landing-feature-icon">{feature.icon}</span>
              <h3 className="landing-feature-title">{feature.title}</h3>
              <p className="landing-feature-desc">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <img src="/logo.png" alt="" className="landing-footer-logo" />
          <span>红鲱鱼与枪</span>
        </div>
        <p className="landing-footer-powered">
          Powered by StepFun / MiMo / DeepSeek + 360 / AnySearch / Metaso
        </p>
      </footer>
    </div>
  );
}
