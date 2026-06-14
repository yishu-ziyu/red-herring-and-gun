import { useState, useCallback } from "react";
import type { DemoCase, FinalReport } from "../../lib/schemas";
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

  const credibility = calculateCredibilityScore(caseData, report);

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
