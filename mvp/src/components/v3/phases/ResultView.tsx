/**
 * ResultView — 核查完成后的结果页（execution 与 result 分离）
 *
 * page：判断 / 轨迹两层。判断是结论；轨迹是全量 hops 收据，默认不打开。
 * dossier：只保留判断，不显示轨迹。
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import { humanizeVerdictType } from "../../../lib/missionShell";
import { InlineCitations } from "../InlineCitations";
import { ReportFooter } from "../ReportFooter";
import {
  buildGlobalSources,
  sourcesFromStringRefs,
  type CiteSource,
} from "../../../lib/citationBinding";
import { hopsFromReport } from "../../../lib/evidencePursuitUi";
import { ResultTrace } from "./ResultTrace";
import { MemoryCandidatePanel } from "../MemoryCandidatePanel";
import { createKnowledgeBase } from "../../../lib/knowledgeBase";
import { updateMemoryCandidateStatus } from "../../../lib/agentExpansion";
import type { MemoryCandidate, MemoryCandidateStatus } from "../../../lib/memoryCandidateTypes";

export interface ResultViewProps {
  claim: string;
  finalReport: Record<string, unknown>;
  onBack: () => void;
  onCancel?: () => void;
  onReverify: () => void;
  /** page = 独立结果页，含判断 / 轨迹两层；dossier = 嵌进右侧卷宗，不显示轨迹 */
  variant?: "page" | "dossier";
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
      kind: "stance";
      key: string;
      text: string;
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
  return /ReportComposer|FactChecker|search360|Tavily|MiniMax|工具调用|providers?\s+failed|API\s+error|quota\s+(?:exceeded|limit)|https?:\/\/\S+\/(?:v\d+|api)\/[A-Za-z0-9]/i.test(
    text
  );
}

function safePublicText(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  if (looksLikeInfrastructureError(text)) return "";
  return text;
}

function sourcesFromVerdict(item: Record<string, unknown>): CiteSource[] {
  const buckets = [
    ...(Array.isArray(item.supportingSources) ? item.supportingSources : []),
    ...(Array.isArray(item.contradictingSources) ? item.contradictingSources : []),
  ];
  const seen = new Set<string>();
  const out: CiteSource[] = [];
  for (const source of buckets) {
    const row = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
    const url = asString(row.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: asString(row.title) || url,
      url,
      snippet: asString(row.snippet) || undefined,
    });
  }
  return out;
}

function verdictItemFromRecord(
  item: Record<string, unknown>,
  index: number,
  textFallback = ""
): ClaimListItem {
  const canSay = asStringArray(item.canSay);
  const cannotSay = asStringArray(item.cannotSay);
  const boundary = safePublicText(item.boundary);
  if (boundary && cannotSay.length === 0) {
    cannotSay.push(boundary);
  }
  return {
    kind: "verdict",
    key: `verdict-${index}`,
    text: textFallback || safePublicText(item.claimAtom) || `命题 ${index + 1}`,
    verdictLabel: humanizeVerdictType(asString(item.verdict)),
    evidence: safePublicText(item.evidence),
    boundary,
    canSay,
    cannotSay,
    sources: sourcesFromVerdict(item),
    sourcesRelatedOnly: item.sourcesRelatedOnly === true,
  };
}

function readClaimList(report: Record<string, unknown>): ClaimListItem[] {
  const claimItems = Array.isArray(report.claimItems) ? report.claimItems : [];
  if (claimItems.length > 0) {
    return claimItems.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const rec = raw as Record<string, unknown>;
      if (rec.verifiable === false) {
        return [
          {
            kind: "stance" as const,
            key: `stance-${index}`,
            text: safePublicText(rec.text) || `立场 ${index + 1}`,
          },
        ];
      }
      const verdict =
        rec.verdict && typeof rec.verdict === "object"
          ? (rec.verdict as Record<string, unknown>)
          : rec;
      return [verdictItemFromRecord(verdict, index, safePublicText(rec.text))];
    });
  }

  const subclaimVerdicts = Array.isArray(report.subclaimVerdicts) ? report.subclaimVerdicts : [];
  if (subclaimVerdicts.length > 0) {
    return subclaimVerdicts.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      return [verdictItemFromRecord(raw as Record<string, unknown>, index)];
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

function isInterruptedReport(report: Record<string, unknown>): boolean {
  return report._source === "error-boundary";
}

function interruptedSourceLinks(report: Record<string, unknown>): Array<{ title: string; url: string }> {
  if (!Array.isArray(report.citationSources)) return [];
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  for (const raw of report.citationSources) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const url = asString(row.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: asString(row.title) || url, url });
  }
  return out;
}

export function ResultView({
  claim,
  finalReport,
  onBack,
  onCancel,
  onReverify,
  variant = "page",
}: ResultViewProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [layer, setLayer] = useState<"judgment" | "trace">("judgment");
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);
  const interrupted = isInterruptedReport(finalReport);
  const embedded = variant === "dossier";

  const verdictType = asString(finalReport.verdictType);
  const verdictLabel = asString(finalReport.faceVerdict) || humanizeVerdictType(verdictType);
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
        .map((raw): CiteSource | null => {
          const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
          const url = asString(row.url);
          if (!url) return null;
          return {
            title: asString(row.title) || url,
            url,
            snippet: asString(row.snippet) || undefined,
          };
        })
        .filter((row): row is CiteSource => row !== null);
    }
    return buildGlobalSources(
      claimItems
        .filter((item): item is Extract<ClaimListItem, { kind: "verdict" }> => item.kind === "verdict")
        .map((item) => ({ sources: item.sources, relatedOnly: item.sourcesRelatedOnly }))
    );
  }, [finalReport, claimItems]);
  const canSayTop = asStringArray(finalReport.canSay);
  const cannotSayTop = asStringArray(finalReport.cannotSay);

  const pursuitHops = useMemo(() => hopsFromReport(finalReport), [finalReport]);
  const traceItems = useMemo(
    () =>
      claimItems.map((item) => ({
        key: item.key,
        kind: item.kind,
        text: item.text,
        verdictLabel: item.kind === "verdict" ? item.verdictLabel : undefined,
        sources: item.kind === "verdict" ? item.sources : [],
        sourcesRelatedOnly: item.kind === "verdict" ? item.sourcesRelatedOnly : false,
      })),
    [claimItems]
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!embedded || interrupted) {
      setMemoryCandidates([]);
      return;
    }
    let cancelled = false;
    void knowledgeBase.listMemoryCandidates().then((listed) => {
      if (cancelled) return;
      setMemoryCandidates(listed.filter((candidate) => candidate.provenance.claim === claim));
    });
    return () => {
      cancelled = true;
    };
  }, [embedded, interrupted, claim, knowledgeBase]);

  const handleMemoryCandidateStatus = useCallback(
    async (id: string, status: MemoryCandidateStatus) => {
      try {
        const updated = await updateMemoryCandidateStatus(id, status);
        await knowledgeBase.saveMemoryCandidate(updated);
        setMemoryCandidates((prev) =>
          prev.map((candidate) => (candidate.id === id ? updated : candidate))
        );
      } catch {
        // Remote status did not change; keep proposed in the panel.
      }
    },
    [knowledgeBase]
  );

  const handleBack = onCancel ?? onBack;
  const interruptedSources = interrupted ? interruptedSourceLinks(finalReport) : [];

  if (interrupted) {
    return (
      <main
        className={`result-view${embedded ? " result-view--dossier" : ""}`}
        aria-label={embedded ? "核查判断" : "核查结果页"}
      >
        {embedded ? null : (
          <header className="result-view-topbar">
            <div className="result-view-brand">
              <strong>红鲱鱼与枪</strong>
              <span>核查结果</span>
            </div>
            <div className="result-view-actions">
              <button type="button" className="result-view-btn result-view-btn--ghost" onClick={handleBack}>
                返回
              </button>
            </div>
          </header>
        )}
        <div className="result-view-body">
          <section className="result-verdict-card mission-final-report mission-final-report--interrupted" aria-label="最终核查判断">
            <p className="mission-final-verdict-word" data-verdict="interrupted">
              这次没查完
            </p>
            <p className="mission-final-lede">
              {interruptedSources.length > 0
                ? "结论还没写出来。已经找到的来源可以点开看。"
                : "结论还没写出来。可以再查一次。"}
            </p>
            <button type="button" className="mission-retry-btn" onClick={onReverify}>
              再查一次
            </button>
            {embedded ? null : (
              <div className="mission-final-claim">
                <span>核查对象</span>
                <p>{claim}</p>
              </div>
            )}
            {interruptedSources.length > 0 ? (
              <div className="mission-source-links" aria-label="已找到的来源">
                {interruptedSources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`result-view${embedded ? " result-view--dossier" : ""}`}
      aria-label={embedded ? "核查判断" : "核查结果页"}
    >
      {embedded ? null : (
        <header className="result-view-topbar">
          <div className="result-view-leading">
            <div className="result-view-brand">
              <strong>红鲱鱼与枪</strong>
            </div>
            <div className="result-layer-switch" role="tablist" aria-label="结果分层">
              <button
                type="button"
                role="tab"
                id="result-tab-judgment"
                aria-selected={layer === "judgment"}
                aria-controls="result-panel-judgment"
                className="result-layer-tab"
                onClick={() => setLayer("judgment")}
              >
                判断
              </button>
              <button
                type="button"
                role="tab"
                id="result-tab-trace"
                aria-selected={layer === "trace"}
                aria-controls="result-panel-trace"
                className="result-layer-tab"
                onClick={() => setLayer("trace")}
              >
                轨迹
              </button>
            </div>
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
      )}

      <div className={`result-view-body${layer === "trace" && !embedded ? " result-view-body--trace" : ""}`}>

        {!embedded && layer === "trace" ? (
          <div role="tabpanel" id="result-panel-trace" aria-labelledby="result-tab-trace">
            <ResultTrace
              claim={claim}
              items={traceItems}
              hops={pursuitHops}
              sources={conclusionSources}
            />
          </div>
        ) : (
        <div
          role={embedded ? undefined : "tabpanel"}
          id={embedded ? undefined : "result-panel-judgment"}
          aria-labelledby={embedded ? undefined : "result-tab-judgment"}
        >
        <section className="result-verdict-card mission-final-report" aria-label="最终核查判断">
          <div className="mission-final-report-head">
            <div>
              <strong>{verdictLabel || "正式判断"}</strong>
              {credibilityLabel || score !== null ? (
                <p className="result-verdict-meta">
                  {credibilityLabel ? <span>{credibilityLabel}</span> : null}
                  {credibilityLabel && score !== null ? <i aria-hidden="true">·</i> : null}
                  {score !== null ? <span>{score}/100</span> : null}
                </p>
              ) : null}
            </div>
          </div>

          {embedded ? null : (
            <div className="mission-final-claim">
              <span>核查对象</span>
              <p>{claim}</p>
            </div>
          )}

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

        {embedded ? (
          <MemoryCandidatePanel
            candidates={memoryCandidates}
            onStatusChange={(id, status) => {
              void handleMemoryCandidateStatus(id, status);
            }}
          />
        ) : null}

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
                if (item.kind === "stance") {
                  return (
                    <li key={item.key} className="result-claim-item result-claim-item--stance">
                      <div className="result-claim-toggle" aria-disabled="true">
                        <span className="result-claim-text">{item.text}</span>
                        <em className="result-claim-badge result-claim-badge--stance">立场型</em>
                      </div>
                      <p className="result-claim-stance-note">不适用真/假判断</p>
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

        {embedded ? (
          <button type="button" className="result-view-btn result-view-btn--primary" onClick={onReverify}>
            重新核查
          </button>
        ) : null}
        {!embedded ? (
          <ReportFooter
            claim={claim}
            verdictType={verdictType}
            score={Number.isFinite(score) ? (score as number) : undefined}
          />
        ) : null}
        </div>
        )}
      </div>
    </main>
  );
}
