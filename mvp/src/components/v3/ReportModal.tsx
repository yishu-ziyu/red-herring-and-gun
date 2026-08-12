import { useState, useCallback } from "react";
import type { DemoCase, FinalReport, SubclaimVerdict } from "../../lib/schemas";
import {
  exportToMarkdown,
  exportToJSON,
  copyToClipboard,
  downloadFile,
  calculateCredibilityScore,
  type VerificationResult,
  getVerificationLabel,
  getVerificationColor,
} from "../../lib/reportExporter";
import { InlineCitations } from "./InlineCitations";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: FinalReport;
  caseData: DemoCase;
  verificationResult?: VerificationResult;
  onSetVerification?: (result: VerificationResult) => void;
}

export function ReportModal({
  isOpen,
  onClose,
  report,
  caseData,
  verificationResult,
  onSetVerification,
}: ReportModalProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "evidence" | "raw">("summary");
  const [copied, setCopied] = useState(false);
  const [expandedVerdicts, setExpandedVerdicts] = useState<Set<number>>(new Set());

  const credibility = calculateCredibilityScore(caseData, report);

  const toggleVerdict = useCallback((index: number) => {
    setExpandedVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const verdicts = report.subclaimVerdicts ?? [];
  const nonVerifiableAtoms = report.nonVerifiableAtoms ?? [];
  const stanceClaimType = report.stanceClaimType;
  // 排除层：整句判定为立场/价值/预测/规范型（verifiable=false）时，报告顶部显示"立场型"横幅
  const showStanceBanner = !!stanceClaimType && stanceClaimType.verifiable === false;
  // 逐命题清单：服务端预交错的 claimItems 已按原句序排好，前端零匹配直接渲染。
  let claimItems: Array<
    | { kind: "verdict"; key: string; claimAtom: string; verdict: SubclaimVerdict }
    | { kind: "stance"; key: string; text: string; type: string }
  >;
  if (Array.isArray(report.claimItems) && report.claimItems.length > 0) {
    claimItems = report.claimItems.map((it, i) =>
      it && it.verdict
        ? { kind: "verdict", key: `v-${i}`, claimAtom: it.text, verdict: it.verdict }
        : { kind: "stance", key: `n-${i}`, text: it.text, type: it.type }
    );
  } else {
    // 兜底：claimItems 缺失（旧数据/中间态）时回退到拼接行为，保证不崩。
    claimItems = [
      ...verdicts.map((v, i) => ({ kind: "verdict" as const, key: `v-${i}`, claimAtom: v.claimAtom, verdict: v })),
      ...nonVerifiableAtoms.map((n, i) => ({ kind: "stance" as const, key: `n-${i}`, text: n.text, type: n.type })),
    ];
  }
  const VERDICT_LABELS: Record<string, string> = {
    true: "属实",
    false: "不实",
    partial: "部分属实",
    exaggerated: "夸大",
    unverified: "未判定·待补证",
  };

  const handleCopyMarkdown = useCallback(() => {
    const md = exportToMarkdown(report, caseData, verificationResult);
    copyToClipboard(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [report, caseData, verificationResult]);

  const handleDownloadMarkdown = useCallback(() => {
    const md = exportToMarkdown(report, caseData, verificationResult);
    const filename = `红鲱鱼与枪核查报告_${caseData.originalClaim.slice(0, 20)}.md`;
    downloadFile(md, filename, "text/markdown;charset=utf-8");
  }, [report, caseData, verificationResult]);

  if (!isOpen) return null;

  const VERIFICATION_OPTIONS: { value: VerificationResult; label: string }[] = [
    { value: "true", label: "真" },
    { value: "false", label: "假" },
    { value: "partial", label: "部分真" },
    { value: "unknown", label: "无法核实" },
  ];

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-header">
          <h2>核查报告</h2>
          <button className="report-modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="report-modal-tabs">
          {(["summary", "evidence", "raw"] as const).map((tab) => (
            <button
              key={tab}
              className={`report-modal-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === "summary" && "摘要"}
              {tab === "evidence" && "证据链"}
              {tab === "raw" && "原始数据"}
            </button>
          ))}
        </div>

        <div className="report-modal-body">
          {activeTab === "summary" && (
            <div className="report-summary">
              {showStanceBanner && (
                <div className="report-stance-banner" role="note">
                  <span className="stance-banner-pill">立场型</span>
                  <span className="stance-banner-text">
                    本说法属立场/价值/预测型，不适用于事实核查；可核查部分照常判定，价值/预测原子原位标注、不订真/假。
                  </span>
                </div>
              )}
              <div className="report-credibility-card">
                <div className="report-credibility-score">
                  <span className="score-value">{credibility.score}%</span>
                  <span className="score-label">{credibility.label}</span>
                </div>
                <div className="score-factors">
                  {credibility.factors.map((f) => (
                    <div key={f.factor} className="score-factor">
                      <span>{f.factor}</span>
                      <span className={f.impact >= 0 ? "positive" : "negative"}>
                        {f.impact >= 0 ? "+" : ""}
                        {f.impact}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="report-section">
                <h3>原始信息</h3>
                <p className="report-claim">{report.originalClaim}</p>
                <p className="report-meta">
                  类型：{caseData.rumorType ?? "未分类"} · 场景：{caseData.useContext}
                </p>
              </div>

              {caseData.diagnosis.rumorIndicators && caseData.diagnosis.rumorIndicators.length > 0 && (
                <div className="report-section">
                  <h3>谣言特征</h3>
                  <div className="report-indicators">
                    {caseData.diagnosis.rumorIndicators.map((ri) => (
                      <span key={ri} className="report-indicator-tag">
                        {ri}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="report-section">
                <h3>逐条判定</h3>
                {claimItems.length > 0 ? (
                  <div className="report-verdicts">
                    {claimItems.map((item, idx) => {
                      if (item.kind === "stance") {
                        return (
                          <div key={idx} className="report-verdict-item report-verdict-stance-item">
                            <div className="verdict-header">
                              <span className="verdict-claim">{item.text}</span>
                              <span className="verdict-header-right">
                                <span className="verdict-badge verdict-stance">立场型</span>
                              </span>
                            </div>
                            <p className="verdict-stance-note">不适用真/假判断</p>
                          </div>
                        );
                      }
                      const v = item.verdict;
                      const i = idx;
                      const isOpen = expandedVerdicts.has(i);
                      const hasDetail =
                        (v.supportingSources?.length ?? 0) > 0 ||
                        (v.contradictingSources?.length ?? 0) > 0 ||
                        (v.evidenceGaps?.length ?? 0) > 0;
                      return (
                        <div key={i} className="report-verdict-item">
                          <button
                            type="button"
                            className="verdict-header"
                            onClick={() => toggleVerdict(i)}
                            aria-expanded={isOpen}
                            aria-controls={`verdict-detail-${i}`}
                          >
                            <span className="verdict-claim">{v.claimAtom}</span>
                            <span className="verdict-header-right">
                              {hasDetail && (
                                <span
                                  className={`verdict-chevron${isOpen ? " open" : ""}`}
                                  aria-hidden="true"
                                >
                                  ▸
                                </span>
                              )}
                              <span className={`verdict-badge verdict-${v.verdict}`}>
                                {VERDICT_LABELS[v.verdict] ?? v.verdict}
                              </span>
                            </span>
                          </button>
                          {(v.evidence || (v.supportingSources?.length ?? 0) > 0) && (
                            <div className="verdict-evidence">
                              <span className="verdict-field-label">证据</span>
                              <InlineCitations
                                text={v.evidence ?? ""}
                                sources={v.supportingSources ?? []}
                                relatedOnly={(v as { sourcesRelatedOnly?: boolean }).sourcesRelatedOnly === true}
                              />
                            </div>
                          )}
                          {v.boundary && (
                            <p className="verdict-boundary">
                              <span className="verdict-field-label">边界</span>
                              {v.boundary}
                            </p>
                          )}
                          {isOpen && (
                            <div id={`verdict-detail-${i}`} className="verdict-detail">
                              {(v.supportingSources?.some((s) => s.snippet) ?? false) && (
                                <div className="verdict-subsection">
                                  <h4 className="verdict-subsection-title">支撑证据</h4>
                                  <ul className="verdict-source-list">
                                    {v.supportingSources!.map((s, si) =>
                                      s.snippet ? (
                                        <li key={si} className="verdict-source-item">
                                          <a
                                            href={s.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="verdict-source-link"
                                          >
                                            {s.title || s.url}
                                          </a>
                                          <p className="verdict-source-snippet">{s.snippet}</p>
                                        </li>
                                      ) : null
                                    )}
                                  </ul>
                                </div>
                              )}
                              {(v.contradictingSources?.length ?? 0) > 0 && (
                                <div className="verdict-subsection">
                                  <h4 className="verdict-subsection-title">反证 / 质疑</h4>
                                  <ul className="verdict-source-list">
                                    {v.contradictingSources!.map((s, si) => (
                                      <li key={si} className="verdict-source-item">
                                        <a
                                          href={s.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="verdict-source-link"
                                        >
                                          {s.title || s.url}
                                        </a>
                                        {s.snippet ? (
                                          <p className="verdict-source-snippet">{s.snippet}</p>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {(v.evidenceGaps?.length ?? 0) > 0 && (
                                <div className="verdict-subsection">
                                  <h4 className="verdict-subsection-title">证据缺口</h4>
                                  <ul className="verdict-gap-list">
                                    {v.evidenceGaps!.map((g, gi) => (
                                      <li key={gi}>{g}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="report-verdicts-empty">本次未生成逐条判定</p>
                )}
              </div>

              <div className="report-section">
                <h3>子命题核查状态</h3>
                <div className="report-subclaims">
                  {report.subclaimStatuses.map((s) => (
                    <div key={s.subclaimId} className="report-subclaim-item">
                      <div className="subclaim-header">
                        <span className="subclaim-id">{s.subclaimId}</span>
                        <span className={`subclaim-status status-${s.status.replace(/\//g, "-")}`}>
                          {s.status}
                        </span>
                      </div>
                      <p className="subclaim-text">{s.subclaim}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="report-section">
                <h3>建议改写</h3>
                <div className="report-rewrites">
                  <div className="rewrite-item">
                    <label>谨慎版</label>
                    <p>{report.rewrittenClaim.cautious}</p>
                  </div>
                  <div className="rewrite-item">
                    <label>面向公众版</label>
                    <p>{report.rewrittenClaim.publicFacing}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "evidence" && (
            <div className="report-evidence">
              <div className="report-section">
                <h3>证据链</h3>
                <ul className="evidence-chain-list">
                  {report.evidenceChain.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>

              <div className="report-section">
                <h3>不可做出的推断</h3>
                <ul className="donot-infer-list">
                  {report.doNotInfer.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>

              <div className="report-section">
                <h3>下一步需补充的证据</h3>
                <ul className="next-evidence-list">
                  {report.nextEvidenceNeeded.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {activeTab === "raw" && (
            <div className="report-raw">
              <pre className="report-json">
                {JSON.stringify(
                  {
                    originalClaim: report.originalClaim,
                    overallStatus: report.overallStatus,
                    claimDiagnosis: report.claimDiagnosis,
                    subclaimStatuses: report.subclaimStatuses,
                    evidenceChain: report.evidenceChain,
                    rewrittenClaim: report.rewrittenClaim,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>

        <div className="report-modal-footer">
          <div className="report-verification">
            <span className="verification-label">标记结果：</span>
            <div className="verification-options">
              {VERIFICATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`verification-btn ${verificationResult === opt.value ? "active" : ""}`}
                  onClick={() => onSetVerification?.(opt.value)}
                  type="button"
                  style={
                    verificationResult === opt.value
                      ? { backgroundColor: getVerificationColor(opt.value), color: "#fff" }
                      : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="report-actions">
            <button
              className="report-action-btn"
              onClick={handleCopyMarkdown}
              type="button"
            >
              {copied ? "已复制" : "复制报告"}
            </button>
            <button
              className="report-action-btn primary"
              onClick={handleDownloadMarkdown}
              type="button"
            >
              下载 Markdown
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
