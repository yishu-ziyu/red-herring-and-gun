/**
 * Dashboard.tsx — 真探 Agent 首页仪表盘
 *
 * 设计决策：
 * - 参照 Flowith 分层入口模式，提供中央输入 + 快速体验两种进入方式
 * - 顶部品牌区 + 中央输入区 + 下方 Demo 卡片区
 * - 整体居中布局，最大宽度 900px
 */

import { useState, useCallback } from "react";

interface DashboardProps {
  onStartAnalysis: (claim: string, caseId?: string, orchestrate?: boolean) => void;
}

const DEMO_CASES = [
  {
    id: "health-overnight-vegetables",
    title: "隔夜菜会致癌，吃了等于吃毒药",
    description: "健康类谣言：将隔夜菜中的亚硝酸盐与癌症直接关联，使用极端比喻制造恐慌。",
    tags: ["健康", "因果", "恐惧诉求"],
    rumorType: "健康",
  },
  {
    id: "social-metro-shutdown",
    title: "某城市地铁即将停运，内部消息",
    description: "社会类谣言：利用「内部消息」制造权威假象，煽动公众焦虑并诱导转发。",
    tags: ["社会", "匿名信源", "煽动传播"],
    rumorType: "社会",
  },
  {
    id: "tech-5g-radiation",
    title: "5G信号塔辐射导致周边居民头晕失眠",
    description: "科技类谣言：混淆电磁辐射与电离辐射概念，制造无科学依据的健康恐慌。",
    tags: ["科技", "概念偷换", "伪科学"],
    rumorType: "科技",
  },
  {
    id: "finance-rmb-devalue",
    title: "人民币即将大幅贬值，赶紧换美元",
    description: "财经类谣言：利用经济焦虑制造恐慌，诱导非理性投资行为。",
    tags: ["财经", "预测", "煽动行动"],
    rumorType: "财经",
  },
];

const MODEL_OPTIONS = [
  { value: "minimax", label: "MiniMax-M2.7" },
  { value: "gpt-4", label: "GPT-4" },
  { value: "claude", label: "Claude" },
];

export function Dashboard({ onStartAnalysis }: DashboardProps) {
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4");

  const handleStart = useCallback(
    (orchestrate = false) => {
      const claim = inputValue.trim();
      if (claim) {
        onStartAnalysis(claim, undefined, orchestrate);
      }
    },
    [inputValue, onStartAnalysis]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleStart(false);
      }
    },
    [handleStart]
  );

  const handleDemoClick = useCallback(
    (claim: string, caseId: string, orchestrate = false) => {
      onStartAnalysis(claim, caseId, orchestrate);
    },
    [onStartAnalysis]
  );

  const handleDemoKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, claim: string, caseId: string) => {
      if (e.target !== e.currentTarget) {
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleDemoClick(claim, caseId, false);
      }
    },
    [handleDemoClick]
  );

  const handleDemoModeClick = useCallback(
    (
      e: React.MouseEvent<HTMLButtonElement>,
      claim: string,
      caseId: string,
      orchestrate: boolean
    ) => {
      e.stopPropagation();
      handleDemoClick(claim, caseId, orchestrate);
    },
    [handleDemoClick]
  );

  return (
    <div className="dashboard">
      <div className="dashboard-content">
        {/* Brand Header */}
        <div className="dashboard-brand">
          <h1 className="dashboard-brand-title">真探 Agent</h1>
          <p className="dashboard-brand-subtitle">
            信息真相猎人 — AI驱动的谣言核查与事实追踪
          </p>
        </div>

        {/* Central Input Area */}
        <div className="dashboard-input-card">
          <div className="dashboard-input-wrapper">
            <textarea
              id="dashboard-claim-input"
              name="claim"
              className="dashboard-input"
              placeholder="输入一条你看到的疑似谣言或信息..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
            />
            <div className="dashboard-submit-actions">
              <button
                className="dashboard-submit-btn"
                onClick={() => handleStart(false)}
                type="button"
                disabled={!inputValue.trim()}
              >
                开始分析
              </button>
              <button
                className="dashboard-submit-btn dashboard-submit-btn--deep"
                onClick={() => handleStart(true)}
                type="button"
                disabled={!inputValue.trim()}
                title="深度核查：串行调用 RumorDetector → FactChecker → ReportComposer"
              >
                深度核查
              </button>
            </div>
          </div>

          <div className="dashboard-input-footer">
            <div className="dashboard-model-selector">
              <span className="dashboard-model-label">模型</span>
              <div className="dashboard-model-pills">
                {MODEL_OPTIONS.map((model) => (
                  <button
                    key={model.value}
                    className={`dashboard-model-pill ${
                      selectedModel === model.value ? "active" : ""
                    }`}
                    onClick={() => setSelectedModel(model.value)}
                    type="button"
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Experience Section */}
        <div className="dashboard-demo-section">
          <div className="dashboard-demo-header">
            <span className="dashboard-demo-label">快速体验</span>
            <span className="dashboard-demo-hint">
              点击卡片，直接进入该案例的分析
            </span>
          </div>

          <div className="dashboard-demo-cards">
            {DEMO_CASES.map((demo) => (
              <div
                key={demo.id}
                className="dashboard-demo-card"
                onClick={() => handleDemoClick(demo.title, demo.id, false)}
                onKeyDown={(e) => handleDemoKeyDown(e, demo.title, demo.id)}
                role="button"
                tabIndex={0}
              >
                <div className="demo-card-header">
                  <h3 className="demo-card-title">{demo.title}</h3>
                  <div className="demo-card-tags">
                    <span className="demo-card-tag demo-card-tag--type">
                      {demo.rumorType}
                    </span>
                    {demo.tags.map((tag) => (
                      <span key={tag} className="demo-card-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="demo-card-description">{demo.description}</p>
                <div className="dashboard-demo-mode-bar" aria-label={`${demo.title} 体验模式`}>
                  <button
                    className="dashboard-demo-mode-btn active"
                    onClick={(e) =>
                      handleDemoModeClick(e, demo.title, demo.id, false)
                    }
                    type="button"
                  >
                    快速分析
                  </button>
                  <button
                    className="dashboard-demo-mode-btn"
                    onClick={(e) =>
                      handleDemoModeClick(e, demo.title, demo.id, true)
                    }
                    type="button"
                  >
                    深度核查
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="dashboard-footer">
          <span className="dashboard-powered-by">
            Powered by MiniMax-M2.7 via Anthropic Proxy
          </span>
        </div>
      </div>
    </div>
  );
}
