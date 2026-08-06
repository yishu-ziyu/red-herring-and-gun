/**
 * ResultView — 核查完成后的结果页（execution 与 result 分离）
 *
 * MissionControlView 只负责执行；本页只读 finalReport 做正式结论展示。
 */

import { useMemo, useState, useCallback } from "react";
import { humanizeVerdictType } from "../../../lib/missionShell";

export interface ResultViewProps {
  claim: string;
  finalReport: Record<string, unknown>;
  onBack: () => void;
  onCancel?: () => void;
  onReverify: () => void;
}

type ClaimListItem =
  | {
      kind: "verdict";
      key: string;
      text: string;
      verdictLabel: string;
      evidence: string;
      boundary: string;
      canSay: string[];
      cannotSay: string[];
      sources: Array<{ title: string; url: string; snippet?: string }>;
    }
  | {
      kind: "atom";
      key: string;
      text: string;
    };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function looksLikeInfrastructureError(text: string): boolean {
  // Provider/runtime diagnostics only. Do not treat public news paths like
  // /news/v1-release as infrastructure errors (require /v1/... or /api/... segment).
  return /ReportComposer|providers?\s+failed|API\s+error|quota\s+(?:exceeded|limit)|https?:\/\/\S+\/(?:v\d+|api)\/[A-Za-z0-9]/i.test(
    text
  );
}

function safePublicText(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  if (looksLikeInfrastructureError(text)) return "";
  return text;
}

function readClaimList(report: Record<string, unknown>): ClaimListItem[] {
  const subclaimVerdicts = Array.isArray(report.subclaimVerdicts) ? report.subclaimVerdicts : [];
  if (subclaimVerdicts.length > 0) {
    return subclaimVerdicts.map((raw, index) => {
      const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const supporting = Array.isArray(item.supportingSources) ? item.supportingSources : [];
      const sources = supporting
        .map((source) => {
          const row = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
          const url = asString(row.url);
          if (!url) return null;
          return {
            title: asString(row.title) || url,
            url,
            snippet: asString(row.snippet) || undefined,
          };
        })
        .filter((row): row is { title: string; url: string; snippet?: string } => Boolean(row));

      const canSay = asStringArray(item.canSay);
      const cannotSay = asStringArray(item.cannotSay);
      const boundary = safePublicText(item.boundary);
      if (boundary && cannotSay.length === 0) {
        cannotSay.push(boundary);
      }

      return {
        kind: "verdict" as const,
        key: `verdict-${index}`,
        text: safePublicText(item.claimAtom) || `命题 ${index + 1}`,
        verdictLabel: humanizeVerdictType(asString(item.verdict)),
        evidence: safePublicText(item.evidence),
        boundary,
        canSay,
        cannotSay,
        sources,
      };
    });
  }

  const claimAtoms = Array.isArray(report.claimAtoms) ? report.claimAtoms : [];
  if (claimAtoms.length > 0) {
    return claimAtoms.map((raw, index) => {
      if (typeof raw === "string") {
        return { kind: "atom" as const, key: `atom-${index}`, text: raw };
      }
      const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        kind: "atom" as const,
        key: `atom-${index}`,
        text: safePublicText(item.text) || safePublicText(item.claimAtom) || `要点 ${index + 1}`,
      };
    });
  }

  return [];
}

function readEvidenceChain(report: Record<string, unknown>): Array<{
  key: string;
  title: string;
  evidence: string;
  boundary: string;
  sources: string[];
}> {
  if (!Array.isArray(report.evidenceChain)) return [];
  return report.evidenceChain
    .map((raw, index) => {
      if (typeof raw === "string") {
        const text = safePublicText(raw);
        if (!text) return null;
        return {
          key: `chain-${index}`,
          title: text,
          evidence: "",
          boundary: "",
          sources: [],
        };
      }
      const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const title = safePublicText(item.finding) || safePublicText(item.layer) || `依据 ${index + 1}`;
      const evidence = safePublicText(item.evidence);
      const boundary = safePublicText(item.boundary);
      const sourceRefs = Array.isArray(item.sourceRefs)
        ? item.sourceRefs.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : [];
      if (!title && !evidence) return null;
      return {
        key: `chain-${index}`,
        title: title || `依据 ${index + 1}`,
        evidence,
        boundary,
        sources: sourceRefs,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export function ResultView({ claim, finalReport, onBack, onCancel, onReverify }: ResultViewProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [processOpen, setProcessOpen] = useState(false);

  const verdictType = asString(finalReport.verdictType);
  const verdictLabel = humanizeVerdictType(verdictType);
  const score = asNumber(finalReport.credibilityScore);
  const credibilityLabel = asString(finalReport.credibilityLabel);
  const conclusion =
    safePublicText(finalReport.conclusion) ||
    safePublicText(finalReport.summaryForPublic) ||
    "报告已收束，但还没有生成适合展示给用户的结论文本。";
  const recommendation = safePublicText(finalReport.recommendation);
  const claimItems = useMemo(() => readClaimList(finalReport), [finalReport]);
  const evidenceChain = useMemo(() => readEvidenceChain(finalReport), [finalReport]);
  const canSayTop = asStringArray(finalReport.canSay);
  const cannotSayTop = asStringArray(finalReport.cannotSay);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleBack = onCancel ?? onBack;

  return (
    <main className="result-view" aria-label="核查结果页">
      <header className="result-view-topbar">
        <div className="result-view-brand">
          <strong>红鲱鱼与枪</strong>
          <span>核查结果</span>
        </div>
        <div className="result-view-actions">
          <button type="button" className="result-view-btn result-view-btn--ghost" onClick={handleBack}>
            返回
          </button>
          <button type="button" className="result-view-btn result-view-btn--primary" onClick={onReverify}>
            重新核查
          </button>
        </div>
      </header>

      <div className="result-view-body">
        <section className="result-verdict-card mission-final-report" aria-label="最终核查判断">
          <div className="mission-final-report-head">
            <div>
              <span>核查结果</span>
              <strong>正式判断</strong>
            </div>
            <div className="mission-final-verdict-badges">
              {verdictLabel ? <em className="mission-final-verdict-primary">{verdictLabel}</em> : null}
              {credibilityLabel ? <em>{credibilityLabel}</em> : null}
              {score !== null ? <strong>{score}/100</strong> : null}
            </div>
          </div>

          <div className="mission-final-claim">
            <span>核查对象</span>
            <p>{claim}</p>
          </div>

          <div className="mission-final-conclusion">
            <span>一句话结论</span>
            <p>{conclusion}</p>
          </div>

          {recommendation ? (
            <div className="mission-share-advice" aria-label="转发建议">
              <span>转发建议</span>
              <p>{recommendation}</p>
            </div>
          ) : null}

          {(canSayTop.length > 0 || cannotSayTop.length > 0) && (
            <div className="result-boundary-grid">
              {canSayTop.length > 0 ? (
                <div>
                  <span>可以说</span>
                  <ul>
                    {canSayTop.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {cannotSayTop.length > 0 ? (
                <div>
                  <span>不能说</span>
                  <ul>
                    {cannotSayTop.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {claimItems.length > 0 ? (
          <section className="result-claim-list" aria-label="命题核查清单">
            <header className="result-section-head">
              <span>逐条核查</span>
              <strong>{claimItems.length} 项</strong>
            </header>
            <ul className="result-claim-items">
              {claimItems.map((item) => {
                if (item.kind === "atom") {
                  return (
                    <li key={item.key} className="result-claim-item result-claim-item--atom">
                      <p>{item.text}</p>
                    </li>
                  );
                }
                const open = expandedKeys.has(item.key);
                const hasDetail =
                  Boolean(item.evidence) ||
                  item.canSay.length > 0 ||
                  item.cannotSay.length > 0 ||
                  item.sources.length > 0;
                return (
                  <li key={item.key} className="result-claim-item">
                    <button
                      type="button"
                      className="result-claim-toggle"
                      onClick={() => hasDetail && toggleExpanded(item.key)}
                      aria-expanded={open}
                      disabled={!hasDetail}
                    >
                      <span className="result-claim-text">{item.text}</span>
                      <em className="result-claim-badge">{item.verdictLabel}</em>
                    </button>
                    {open && hasDetail ? (
                      <div className="result-claim-detail">
                        {item.evidence ? (
                          <p>
                            <span>证据</span>
                            {item.evidence}
                          </p>
                        ) : null}
                        {item.canSay.length > 0 ? (
                          <div>
                            <span>可以说</span>
                            <ul>
                              {item.canSay.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {item.cannotSay.length > 0 ? (
                          <div>
                            <span>不能说</span>
                            <ul>
                              {item.cannotSay.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {item.sources.length > 0 ? (
                          <div>
                            <span>来源</span>
                            <ul>
                              {item.sources.map((source) => (
                                <li key={source.url}>
                                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                                    {source.title}
                                  </a>
                                  {source.snippet ? <p>{source.snippet}</p> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {evidenceChain.length > 0 ? (
          <section className="result-evidence-list" aria-label="证据链">
            <header className="result-section-head">
              <span>依据</span>
              <strong>{evidenceChain.length} 条</strong>
            </header>
            <ul>
              {evidenceChain.map((item, index) => (
                <li key={item.key}>
                  <strong>
                    {index + 1}. {item.title}
                  </strong>
                  {item.evidence ? <p>{item.evidence}</p> : null}
                  {item.boundary ? <small>不能推出：{item.boundary}</small> : null}
                  {item.sources.length > 0 ? (
                    <ul className="result-source-links">
                      {item.sources.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="result-process-section" aria-label="回看核查过程">
          <button
            type="button"
            className="result-process-toggle"
            aria-expanded={processOpen}
            onClick={() => setProcessOpen((open) => !open)}
          >
            <span>回看核查过程</span>
            <em>{processOpen ? "收起" : "展开"}</em>
          </button>
          {processOpen ? (
            <div className="result-process-body">
              <p>
                过程记录保留在执行页时间线中。本页聚焦正式判断；若需逐步回看，请重新发起核查或从执行流导出。
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
