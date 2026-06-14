/**
 * DiagnosisBanner.tsx — 诊断卡横幅
 *
 * 设计决策：
 * - 顶部固定横幅，展示混合判断诊断结果
 * - 支持展开/收起：展开时显示完整诊断信息，收起后变为顶部细条
 * - 细条状态点击可展开回顾
 * - "进入分析"按钮触发初始化，将诊断数据注入全局状态
 */

import { useState, useCallback } from "react";
import type { ClaimDiagnosis } from "../../lib/schemas";

interface DiagnosisBannerProps {
  originalClaim: string;
  diagnosis: ClaimDiagnosis;
  onEnterAnalysis: () => void;
}

export function DiagnosisBanner({
  originalClaim,
  diagnosis,
  onEnterAnalysis,
}: DiagnosisBannerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showContrast, setShowContrast] = useState(false);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  if (collapsed) {
    return (
      <div
        className="diagnosis-banner-collapsed"
        onClick={() => setCollapsed(false)}
        role="button"
        tabIndex={0}
        aria-label="展开诊断结果"
      >
        <span className="banner-pulse-dot" aria-hidden="true" />
        <span className="banner-collapsed-text">
          混合判断：{diagnosis.mixedJudgments.join("、")}
        </span>
        <span className="banner-hint">点击展开</span>
      </div>
    );
  }

  return (
    <header className="diagnosis-banner" aria-label="诊断结果">
      <div className="banner-content">
        <div className="banner-header-row">
          <h2 className="banner-title">语境化可核查分解</h2>
          <button
            className="banner-collapse-btn"
            onClick={toggleCollapse}
            type="button"
            aria-label="收起诊断"
          >
            收起
          </button>
        </div>

        <div className="banner-original-claim">
          <span className="banner-label">原句</span>
          <p className="banner-claim-text">{originalClaim}</p>
        </div>

        <div className="banner-judgments">
          <span className="banner-label">混合判断类型</span>
          <div className="judgment-tags">
            {diagnosis.mixedJudgments.map((type) => (
              <span key={type} className="judgment-tag">
                {type}
              </span>
            ))}
          </div>
        </div>

        <div className="banner-risk">
          <span className="banner-label">风险说明</span>
          <p className="banner-risk-text">{diagnosis.risk}</p>
          <p className="banner-risk-why">{diagnosis.whyNotDirectFactCheck}</p>
        </div>

        <div className="banner-contrast-toggle">
          <button
            className="contrast-toggle-btn"
            onClick={() => setShowContrast((prev) => !prev)}
            type="button"
          >
            {showContrast ? "收起对照" : "看看传统搜索会怎么回答？"}
          </button>
        </div>

        {showContrast ? (
          <div className="banner-contrast">
            <div className="contrast-card contrast-traditional">
              <div className="contrast-header">
                <span className="contrast-badge">传统搜索 / ChatGPT</span>
              </div>
              <div className="contrast-body">
                <p>
                  "是的，AI 确实在替代初级内容岗位。研究显示写作职业对大语言模型暴露度较高，某招聘平台数据显示相关岗位下降，多个企业案例证实 AI 减少了文案外包需求..."
                </p>
                <div className="contrast-warning">
                  <strong>问题</strong>
                  <span>把"暴露度"、"岗位下降"、"企业案例"混为一谈，直接推出"AI 导致"。每份材料的证据强度没有被区分。</span>
                </div>
              </div>
            </div>

            <div className="contrast-divider">vs</div>

            <div className="contrast-card contrast-agent">
              <div className="contrast-header">
                <span className="contrast-badge">溯证 Agent</span>
              </div>
              <div className="contrast-body">
                <ul className="contrast-evidence-list">
                  <li>
                    <strong>暴露度研究</strong>
                    <span className="can">能支持：任务结构可能变化</span>
                    <span className="cannot">不能支持：岗位已经减少</span>
                  </li>
                  <li>
                    <strong>招聘数据</strong>
                    <span className="can">能支持：某口径下岗位下降</span>
                    <span className="cannot">不能支持：下降原因（缺少 AI 采用变量）</span>
                  </li>
                  <li>
                    <strong>企业案例</strong>
                    <span className="can">能支持：单个企业流程变化</span>
                    <span className="cannot">不能支持：行业趋势</span>
                  </li>
                </ul>
                <div className="contrast-conclusion">
                  <strong>结论</strong>
                  <span>现有证据不能支持"导致"，建议改写为"AI 可能是影响因素之一"</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="banner-actions">
          <button
            className="banner-enter-btn"
            onClick={onEnterAnalysis}
            type="button"
          >
            进入分析
          </button>
        </div>
      </div>
    </header>
  );
}
