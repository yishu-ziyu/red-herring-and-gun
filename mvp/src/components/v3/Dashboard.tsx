/**
 * Dashboard.tsx — 红鲱鱼与枪首页仪表盘
 *
 * 设计决策：
 * - 参照 Flowith 分层入口模式，提供中央输入 + 快速体验两种进入方式
 * - 顶部品牌区 + 中央输入区 + 下方 Demo 卡片区
 * - 整体居中布局，最大宽度 900px
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { entertainmentRumorCase, politicalRumorCase } from "../../data/rumorCases";
import { createKnowledgeBase } from "../../lib/knowledgeBase";
import type { KnowledgeBaseEntry, KnowledgeBaseStats } from "../../lib/schemas";

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
  {
    id: "political-policy-rumor",
    title: politicalRumorCase.originalClaim,
    description: "政治政策类谣言：用「内部文件」和模糊发布主体制造制度性恐慌。",
    tags: ["政治", "政策误读", "匿名信源"],
    rumorType: "政治",
  },
  {
    id: "entertainment-celebrity-rumor",
    title: entertainmentRumorCase.originalClaim,
    description: "娱乐类谣言：用匿名爆料和截图暗示违法封杀，容易造成名誉损害。",
    tags: ["娱乐", "截图断章", "名誉风险"],
    rumorType: "娱乐",
  },
];

const MODEL_OPTIONS = [
  { value: "stepfun", label: "StepFun 3.7" },
  { value: "mimo", label: "MiMo 2.5" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "search360", label: "360 智搜" },
];

export function Dashboard({ onStartAnalysis }: DashboardProps) {
  const [inputValue, setInputValue] = useState("");
  const [kbStats, setKbStats] = useState<KnowledgeBaseStats | null>(null);
  const [similarCases, setSimilarCases] = useState<KnowledgeBaseEntry[]>([]);
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);

  useEffect(() => {
    let cancelled = false;
    knowledgeBase.getStats().then((stats) => {
      if (!cancelled) setKbStats(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [knowledgeBase]);

  useEffect(() => {
    const claim = inputValue.trim();
    let cancelled = false;

    if (claim.length < 4) {
      setSimilarCases([]);
      return;
    }

    knowledgeBase.findSimilarCases(claim, 3).then((cases) => {
      if (!cancelled) setSimilarCases(cases);
    });

    return () => {
      cancelled = true;
    };
  }, [inputValue, knowledgeBase]);

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
                className="dashboard-submit-btn"
                onClick={() => handleStart(false)}
                type="button"
                disabled={!inputValue.trim()}
                title="快速分析：先进入结果页，再用国产大模型在后台刷新报告"
              >
                开始分析
              </button>
              <button
                className="dashboard-submit-btn dashboard-submit-btn--deep"
                onClick={() => handleStart(true)}
                type="button"
                disabled={!inputValue.trim()}
                title="深度核查：串行调用 RumorDetector → FactChecker → SourceValidator → ReportComposer"
              >
                深度核查
              </button>
            </div>
          </div>

          <div className="dashboard-input-footer">
            <div className="dashboard-model-selector">
              <span className="dashboard-model-label">国产链路</span>
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

          <div className="dashboard-knowledge-strip" aria-label="本地知识库状态">
            <span>本地案例 {kbStats?.totalCases ?? 0}</span>
            <span>证据线索 {kbStats?.totalEvidence ?? 0}</span>
            {Object.entries(kbStats?.typeDistribution ?? {}).slice(0, 4).map(([type, count]) => (
              <span key={type}>{type} {count}</span>
            ))}
          </div>

          {similarCases.length > 0 ? (
            <div className="dashboard-similar-cases" aria-label="相似历史案例">
              <strong>相似历史案例</strong>
              {similarCases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="dashboard-similar-case"
                  onClick={() => onStartAnalysis(item.claim, undefined, false)}
                >
                  <span>{item.rumorType}</span>
                  <em>{item.claim}</em>
                  <small>{item.credibilityScore}% · {item.tags.slice(0, 3).join(" / ")}</small>
                </button>
              ))}
            </div>
          ) : null}
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
            Powered by StepFun / MiMo / DeepSeek + 360 AI Search
          </span>
        </div>
      </div>
    </div>
  );
}
