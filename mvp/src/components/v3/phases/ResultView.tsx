/**
 * ResultView — 核查完成后的结果页（execution 与 result 分离）
 *
 * MissionControlView 只负责执行；本页只读 finalReport 做正式结论展示。
 */

import { useMemo, useState, useCallback } from "react";
import { humanizeVerdictType } from "../../../lib/missionShell";
import { InlineCitations } from "../InlineCitations";
import {
  buildGlobalSources,
  sourcesFromStringRefs,
  type CiteSource,
} from "../../../lib/citationBinding";

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
      sources: CiteSource[];
      sourcesRelatedOnly: boolean;
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
        .filter((row): row is CiteSource => Boolean(row));

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
        sourcesRelatedOnly: item.sourcesRelatedOnly === true,
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
    "有结论了，但还没有适合展示的结论文本。";
  const recommendation = safePublicText(finalReport.recommendation);
  const claimItems = useMemo(() => readClaimList(finalReport), [finalReport]);
  const evidenceChain = useMemo(() => readEvidenceChain(finalReport), [finalReport]);
  /**
   * Global conclusion numbering: first-seen unique cited sources (skip related-only fills).
   * Prefer server-normalized citationSources when present.
   */
  const conclusionSources = useMemo(() => {
    if (Array.isArray(finalReport.citationSources)) {
      return (finalReport.citationSources as unknown[])
        .map((raw) => {
          const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
          const url = asString(row.url);
          if (!url) return null;
          return {
            title: asString(row.title) || url,
            url,
            snippet: asString(row.snippet) || undefined,
          };
        })
        .filter((row): row is CiteSource => Boolean(row));
    }
    return buildGlobalSources(
      claimItems
        .filter((item): item is Extract<ClaimListItem, { kind: "verdict" }> => item.kind === "verdict")
        .map((item) => ({ sources: item.sources, relatedOnly: item.sourcesRelatedOnly }))
    );
  }, [finalReport, claimItems]);
  const canSayTop = asStringArray(finalReport.canSay);
  const cannotSayTop = asStringArray(finalReport.cannotSay);

  /** Compact process footprint for result-page audit (DESIGN: Footprints). */
  const processFootprint = useMemo(() => {
    const verdictCount = claimItems.filter((item) => item.kind === "verdict").length;
    const atomCount = claimItems.length;
    const boundSourceCount = claimItems
      .filter((item): item is Extract<ClaimListItem, { kind: "verdict" }> => item.kind === "verdict")
      .filter((item) => !item.sourcesRelatedOnly && item.sources.length > 0).length;
    const relatedOnlyCount = claimItems
      .filter((item): item is Extract<ClaimListItem, { kind: "verdict" }> => item.kind === "verdict")
      .filter((item) => item.sourcesRelatedOnly && item.sources.length > 0).length;
    const chainCount = evidenceChain.length;
    const globalCiteCount = conclusionSources.length;
    return {
      atomCount,
      verdictCount,
      boundSourceCount,
      relatedOnlyCount,
      chainCount,
      globalCiteCount,
    };
  }, [claimItems, evidenceChain, conclusionSources]);

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
            <span>结论</span>
            <InlineCitations text={conclusion} sources={conclusionSources} />
            {conclusionSources.length > 0 ? (
              <p className="result-cite-hint" role="note">
                句内编号对应下方来源；点开可核对原文。相关检索不等于句内支撑。
              </p>
            ) : (
              <p className="result-cite-hint" role="note">
                没有来源，就不要当成已经证实。
              </p>
            )}
          </div>

          {recommendation ? (
            <div className="mission-share-advice" aria-label="能不能信">
              <span>能不能信</span>
              <p>{recommendation}</p>
            </div>
          ) : null}

          {(canSayTop.length > 0 || cannotSayTop.length > 0) && (
            <div className="result-boundary-grid">
              {canSayTop.length > 0 ? (
                <div>
                  <span>能信</span>
                  <ul>
                    {canSayTop.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {cannotSayTop.length > 0 ? (
                <div>
                  <span>不能信</span>
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
                        {item.evidence || item.sources.length > 0 ? (
                          <div>
                            <span>证据与来源</span>
                            <InlineCitations
                              text={item.evidence}
                              sources={item.sources}
                              relatedOnly={item.sourcesRelatedOnly}
                            />
                          </div>
                        ) : null}
                        {item.canSay.length > 0 ? (
                          <div>
                            <span>能信</span>
                            <ul>
                              {item.canSay.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {item.cannotSay.length > 0 ? (
                          <div>
                            <span>不能信</span>
                            <ul>
                              {item.cannotSay.map((line) => (
                                <li key={line}>{line}</li>
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
              {evidenceChain.map((item, index) => {
                const titleByUrl = new Map(
                  conclusionSources.map((s) => [s.url, { title: s.title, snippet: s.snippet }] as const)
                );
                // Prefer server-normalized _citeSources when present on the raw chain item.
                const rawChain = Array.isArray(finalReport.evidenceChain)
                  ? (finalReport.evidenceChain as unknown[])[index]
                  : null;
                const prebound =
                  rawChain &&
                  typeof rawChain === "object" &&
                  Array.isArray((rawChain as Record<string, unknown>)._citeSources)
                    ? ((rawChain as Record<string, unknown>)._citeSources as CiteSource[])
                    : null;
                const chainSources =
                  prebound && prebound.length > 0
                    ? prebound
                    : sourcesFromStringRefs(item.sources, titleByUrl);
                return (
                  <li key={item.key}>
                    <strong>
                      {index + 1}. {item.title}
                    </strong>
                    {item.evidence || chainSources.length > 0 ? (
                      <InlineCitations text={item.evidence} sources={chainSources} />
                    ) : null}
                    {item.boundary ? <small>不能推出：{item.boundary}</small> : null}
                  </li>
                );
              })}
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
            <span>核查足迹</span>
            <em>{processOpen ? "收起" : "展开"}</em>
          </button>
          {processOpen ? (
            <div className="result-process-body">
              <ol className="result-process-footprint" aria-label="本页可核对的核查足迹">
                <li>
                  <strong>主张</strong>
                  <span>{claim}</span>
                </li>
                <li>
                  <strong>拆题</strong>
                  <span>
                    {processFootprint.atomCount > 0
                      ? `共 ${processFootprint.atomCount} 条可核对要点${
                          processFootprint.verdictCount > 0
                            ? `，其中 ${processFootprint.verdictCount} 条已给出判断`
                            : ""
                        }`
                      : "本报告未附带拆题清单"}
                  </span>
                </li>
                <li>
                  <strong>来源</strong>
                  <span>
                    {processFootprint.globalCiteCount > 0
                      ? `结论层 ${processFootprint.globalCiteCount} 个已绑定来源`
                      : "结论层暂无句内绑定来源"}
                    {processFootprint.boundSourceCount > 0
                      ? ` · ${processFootprint.boundSourceCount} 条命题有支撑来源`
                      : ""}
                    {processFootprint.relatedOnlyCount > 0
                      ? ` · ${processFootprint.relatedOnlyCount} 条仅为相关检索`
                      : ""}
                  </span>
                </li>
                <li>
                  <strong>依据链</strong>
                  <span>
                    {processFootprint.chainCount > 0
                      ? `${processFootprint.chainCount} 条依据`
                      : "未附带分层依据"}
                  </span>
                </li>
                <li>
                  <strong>判断</strong>
                  <span>
                    {[verdictLabel, credibilityLabel, score !== null ? `${score}/100` : ""]
                      .filter(Boolean)
                      .join(" · ") || "见上方正式判断"}
                  </span>
                </li>
              </ol>
              <p className="result-process-note">
                完整步骤时间线在执行页。本页足迹只保留与正式判断直接相关、可核对的摘要。
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
