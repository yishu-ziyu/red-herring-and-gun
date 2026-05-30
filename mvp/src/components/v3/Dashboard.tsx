/**
 * Dashboard.tsx — 红鲱鱼与枪首页仪表盘
 *
 * 设计决策：
 * - 真实产品入口只接受用户输入，不展示预置案例或预置结论
 * - 顶部品牌区 + 中央输入区 + 真实 Agent/工具链提示
 * - 整体居中布局，最大宽度 900px
 */

import { useState, useCallback } from "react";

interface DashboardProps {
  onStartAnalysis: (claim: string, caseId?: string, orchestrate?: boolean) => void;
}

const MODEL_OPTIONS = [
  { value: "stepfun", label: "StepFun 3.7" },
  { value: "mimo", label: "MiMo 2.5" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "search", label: "360 / AnySearch / Metaso / Tavily / Exa" },
];

export function Dashboard({ onStartAnalysis }: DashboardProps) {
  const [inputValue, setInputValue] = useState("");

  const handleStart = useCallback(
    () => {
      const claim = inputValue.trim();
      if (claim) {
        onStartAnalysis(claim, undefined, true);
      }
    },
    [inputValue, onStartAnalysis]
  );

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
    <div className="dashboard">
      <div className="dashboard-content">
        {/* Brand Header */}
        <div className="dashboard-brand">
          <h1 className="dashboard-brand-title">红鲱鱼与枪</h1>
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
                className="dashboard-submit-btn dashboard-submit-btn--deep"
                onClick={handleStart}
                type="button"
                disabled={!inputValue.trim()}
                title="启动真实 Agent 核查：模型输出和工具结果返回前不生成静态结论"
              >
                启动真实核查
              </button>
            </div>
          </div>

          <div className="dashboard-input-footer">
            <div className="dashboard-model-selector">
              <span className="dashboard-model-label">真实 Agent 链路</span>
              <div className="dashboard-model-pills">
                {MODEL_OPTIONS.map((model) => (
                  <span
                    key={model.value}
                    className="dashboard-model-pill"
                  >
                    {model.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="dashboard-footer">
          <span className="dashboard-powered-by">
            Powered by StepFun / MiMo / DeepSeek + 360 / AnySearch / Metaso / Tavily / Exa Search
          </span>
        </div>
      </div>
    </div>
  );
}
