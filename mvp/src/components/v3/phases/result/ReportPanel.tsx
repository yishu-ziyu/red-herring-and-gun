import { useState, useEffect } from "react";
import type { HandoffStep } from "../../../../lib/agentExpansion";
import { CredibilityBadge } from "./CredibilityBadge";
import { SourceList, type Source } from "./SourceList";

interface ReportPanelProps {
  claim: string;
  rumorType?: string;
  conclusion: string;
  credibilityScore: number;
  credibilityLabel: string;
  summaryForPublic: string;
  steps: HandoffStep[];
  onSourceClick?: (sourceId: string) => void;
}

const STEP_TITLES: Record<string, string> = {
  rumor_detector: "谣言特征识别",
  fact_checker: "事实核查",
  source_validator: "信源验证",
  report_composer: "报告生成",
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  rumor_detector: "识别文本里的夸张、匿名信源、恐惧诉求和传播诱导。",
  fact_checker: "拆出可核查事实，并整理支持、反驳和无法确认的部分。",
  source_validator: "检查来源可靠性，区分可用证据和仍需补证的位置。",
  report_composer: "综合前序输出，生成面向公众的核查结论。",
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getCredibilityClass(score: number): string {
  if (score >= 80) return "conclusion-card--high";
  if (score >= 60) return "conclusion-card--good";
  if (score >= 40) return "conclusion-card--medium";
  if (score >= 20) return "conclusion-card--low";
  return "conclusion-card--critical";
}

function sourceFromString(text: string, index: number, reliability?: Source["reliability"]): Source {
  const trimmed = text.trim();
  const maybeUrl = trimmed.match(/https?:\/\/\S+/)?.[0];

  return {
    id: `E${index + 1}`,
    title: maybeUrl ? trimmed.replace(maybeUrl, "").trim() || maybeUrl : trimmed,
    url: maybeUrl,
    reliability,
    type: "Agent 输出",
  };
}

function uniqueSources(sources: Source[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.title}-${source.url ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSources(steps: HandoffStep[]): Source[] {
  const rawSources: Source[] = [];
  const sourceValidator = steps.find((step) => step.agent === "source_validator");
  const reliabilityValue = sourceValidator?.output.sourceReliability;
  const reliability =
    reliabilityValue === "high" ||
    reliabilityValue === "medium" ||
    reliabilityValue === "low" ||
    reliabilityValue === "unverified"
      ? reliabilityValue
      : undefined;

  steps.forEach((step) => {
    const sources = toStringArray(step.output.sources);
    const verifiedSources = toStringArray(step.output.verifiedSources);
    const questionableSources = toStringArray(step.output.questionableSources);

    [...sources, ...verifiedSources].forEach((source) => {
      rawSources.push(sourceFromString(source, rawSources.length, reliability ?? "medium"));
    });

    questionableSources.forEach((source) => {
      rawSources.push(sourceFromString(source, rawSources.length, "low"));
    });
  });

  return uniqueSources(rawSources).map((source, index) => ({
    ...source,
    id: `E${index + 1}`,
  }));
}

function renderCitation(source: Source, onSourceClick?: (sourceId: string) => void) {
  return (
    <button
      key={source.id}
      className="source-citation"
      type="button"
      onClick={() => onSourceClick?.(source.id)}
      title={source.title}
    >
      [{source.id}]
    </button>
  );
}

function getStepHighlights(step: HandoffStep) {
  const output = step.output;

  switch (step.agent) {
    case "rumor_detector":
      return [
        getString(output.analysis),
        ...toStringArray(output.rumorIndicators).map((item) => `谣言特征：${item}`),
        ...toStringArray(output.detectedPatterns).map((item) => `匹配模式：${item}`),
      ].filter(Boolean);
    case "fact_checker":
      return [
        getString(output.factCheckResult) ? `核查结果：${getString(output.factCheckResult)}` : "",
        getString(output.confidence) ? `置信度：${getString(output.confidence)}` : "",
        ...toStringArray(output.keyFindings),
        ...toStringArray(output.counterEvidence).map((item) => `反向证据：${item}`),
      ].filter(Boolean);
    case "source_validator":
      return [
        getString(output.sourceReliability) ? `信源可靠性：${getString(output.sourceReliability)}` : "",
        getString(output.verificationNotes),
        ...toStringArray(output.missingSources).map((item) => `缺失证据：${item}`),
      ].filter(Boolean);
    case "report_composer":
      return [
        getString(output.conclusion),
        getString(output.recommendation) ? `建议：${getString(output.recommendation)}` : "",
        getNumber(output.credibilityScore) !== null
          ? `可信度评分：${getNumber(output.credibilityScore)}/100`
          : "",
      ].filter(Boolean);
    default:
      return Object.entries(output)
        .slice(0, 4)
        .map(([key, value]) => `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
}

export function ReportPanel({
  claim,
  rumorType,
  conclusion,
  credibilityScore,
  credibilityLabel,
  summaryForPublic,
  steps,
  onSourceClick,
}: ReportPanelProps) {
  const sources = collectSources(steps);
  const completedSteps = steps.filter((step) => step.status === "completed");
  const [stampVisible, setStampVisible] = useState(false);

  useEffect(() => {
    if (completedSteps.length >= 3) {
      const timer = setTimeout(() => setStampVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, [completedSteps.length]);

  return (
    <article className="report-panel">
      <header className="report-panel-hero">
        <div className="report-panel-claim">
          <span>待核查信息</span>
          <h1>{claim}</h1>
          {rumorType ? <em>{rumorType}</em> : null}
        </div>
        <CredibilityBadge score={credibilityScore} label={credibilityLabel} />
      </header>

      <section className={`conclusion-card ${getCredibilityClass(credibilityScore)}`}>
        <div className="conclusion-header">
          <div>
            <div className="conclusion-score">{credibilityScore}</div>
            <div className="conclusion-label">{credibilityLabel}</div>
          </div>
          <div className={`truth-stamp ${stampVisible ? "visible" : ""} ${credibilityScore >= 60 ? "verified" : ""}`}>
            <span className="truth-stamp-text">
              {credibilityScore >= 60 ? "已核查" : "存疑"}
            </span>
          </div>
        </div>
        <p className="conclusion-text">{conclusion}</p>
        <p className="conclusion-summary">{summaryForPublic}</p>
        {sources.length > 0 ? (
          <div className="report-citations" aria-label="报告引用">
            {sources.slice(0, 4).map((source) => renderCitation(source, onSourceClick))}
          </div>
        ) : null}
      </section>

      <section className="report-steps-panel">
        <div className="report-section-heading">
          <span>Process</span>
          <h3>核查过程</h3>
        </div>
        <div className="report-step-list">
          {completedSteps.length > 0 ? (
            completedSteps.map((step, index) => {
              const stepSources = sources.slice(index, index + 2);
              const highlights = getStepHighlights(step).slice(0, 5);

              return (
                <section key={`${step.agent}-${step.timestamp}`} className="report-step-card">
                  <div className="report-step-header">
                    <span className="report-step-index">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h4>{STEP_TITLES[step.agent] ?? step.agentName}</h4>
                      <p>{STEP_DESCRIPTIONS[step.agent] ?? step.agentName}</p>
                    </div>
                  </div>
                  {highlights.length > 0 ? (
                    <ul>
                      {highlights.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="report-step-empty">该 Agent 未返回可展示的结构化摘要。</p>
                  )}
                  {stepSources.length > 0 ? (
                    <div className="report-citations">
                      {stepSources.map((source) => renderCitation(source, onSourceClick))}
                    </div>
                  ) : null}
                </section>
              );
            })
          ) : (
            <p className="report-step-empty">暂无深度核查步骤，当前展示 Demo 管线的结构化报告。</p>
          )}
        </div>
      </section>

      <SourceList sources={sources} />

      <footer className="report-panel-footer">
        本报告由真探 Agent 自动生成，仅供辅助判断；关键结论仍需以权威信源和原始材料为准。
      </footer>
    </article>
  );
}
