import { useState, useCallback, useEffect } from "react";
import type { FinalReport, DemoCase } from "../../lib/schemas";
import type { VerificationResult } from "../../lib/reportExporter";
import {
  archiveDoubtful,
  buildRebuttalCardMarkdown,
  calculateCredibilityScore,
  downloadFile,
  exportToMarkdown,
  getDoubtfulArchiveCount,
  shareVerification,
  type ClosureReportPayload,
} from "../../lib/reportExporter";
import { ReportModal } from "./ReportModal";
import { InferenceLicensePanel } from "./panels/InferenceLicensePanel";
import { getTraceCollector } from "../../lib/reasoningTrace";

interface ConclusionDockV3Props {
  report: FinalReport;
  caseData: DemoCase;
  explorationCount?: number;
  credibilityScore?: number;
  verificationResult?: VerificationResult | null;
  onSetVerification?: (result: VerificationResult) => void;
  handoffResult?: {
    claim: string;
    conclusion?: string;
    credibilityScore?: number;
    credibilityLabel?: string;
    recommendation?: string;
    canSay?: string[];
    cannotSay?: string[];
    scoreBreakdown?: Record<string, number>;
  } | null;
  originalClaim?: string;
}

function getCredibilityLabel(score: number): string {
  if (score >= 80) return "可信";
  if (score >= 60) return "基本可信";
  if (score >= 40) return "部分可信";
  if (score >= 20) return "高度可疑";
  return "谣言";
}

function isLowCredibilityLabel(label: string) {
  return /不实|谣言|虚假|错误|高度可疑/.test(label);
}

function normalizeCredibilityScore(score: number, label: string) {
  const bounded = Math.max(0, Math.min(100, score));
  return isLowCredibilityLabel(label) && bounded > 50 ? 100 - bounded : bounded;
}

export function ConclusionDockV3({
  report,
  caseData,
  explorationCount = 0,
  credibilityScore = 0,
  verificationResult,
  onSetVerification,
  handoffResult,
  originalClaim,
}: ConclusionDockV3Props) {
  const exploring = explorationCount > 0;
  const rawCredibilityScore = handoffResult?.credibilityScore ?? credibilityScore;
  const rawLabel = handoffResult?.credibilityLabel ?? getCredibilityLabel(rawCredibilityScore);
  const effectiveCredibilityScore = normalizeCredibilityScore(rawCredibilityScore, rawLabel);
  const confidenceScore = isLowCredibilityLabel(rawLabel) ? 100 - effectiveCredibilityScore : effectiveCredibilityScore;
  const label = handoffResult?.credibilityLabel ?? getCredibilityLabel(effectiveCredibilityScore);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [archiveCount, setArchiveCount] = useState(() => getDoubtfulArchiveCount());

  // v2-iteration 2026-07-04: PR-3 Site C — emit terminal trace when report finalized (review P2-2 + P3-1 + P3-3 fix)
  useEffect(() => {
    if (!exploring && effectiveCredibilityScore > 0 && label) {
      getTraceCollector().emit({
        agent: "report_composer",
        action: "report_complete",
        status: "completed",
        timestamp: Date.now(),
        meta: {
          credibilityScore: effectiveCredibilityScore,
          credibilityLabel: label,
        },
      });
    }
  }, [exploring, effectiveCredibilityScore, label]);

  const buildPayload = useCallback((): ClosureReportPayload => ({
    claim: handoffResult?.claim ?? originalClaim ?? report.originalClaim,
    conclusion: handoffResult?.conclusion ?? report.rewrittenClaim.cautious,
    credibilityScore: effectiveCredibilityScore,
    credibilityLabel: label,
    summaryForPublic: handoffResult?.recommendation ?? report.rewrittenClaim.publicFacing,
    sources: report.evidenceChain.slice(0, 8),
  }), [effectiveCredibilityScore, handoffResult, label, originalClaim, report]);

  const handleExport = useCallback(() => {
    const md = exportToMarkdown(report, caseData, verificationResult ?? undefined);
    const filename = `红鲱鱼与枪核查报告_${caseData.originalClaim.slice(0, 20)}.md`;
    downloadFile(md, filename, "text/markdown;charset=utf-8");
    setActionMessage("报告已导出。");
  }, [report, caseData, verificationResult]);

  const handleRebuttalCard = useCallback(() => {
    const payload = buildPayload();
    const md = buildRebuttalCardMarkdown(payload);
    downloadFile(md, `红鲱鱼与枪辟谣卡片_${payload.claim.slice(0, 18)}.md`, "text/markdown;charset=utf-8");
    setActionMessage("辟谣卡片已生成。");
  }, [buildPayload]);

  const handleArchive = useCallback(() => {
    archiveDoubtful(buildPayload());
    const nextCount = getDoubtfulArchiveCount();
    setArchiveCount(nextCount);
    setActionMessage(`已存疑归档，当前共 ${nextCount} 条。`);
  }, [buildPayload]);

  const handleShare = useCallback(async () => {
    const entry = await shareVerification(buildPayload());
    setActionMessage(entry.channel === "native-share" ? "已调用系统分享。" : "已复制分享文本。");
  }, [buildPayload]);

  return (
    <>
      <footer className="conclusion-dock editorial" aria-label="Conclusion dock">
        <div className="strength-meter cinema-rise">
          <span className="small-caps">原始命题</span>
          <strong>{handoffResult?.claim ?? originalClaim ?? report.originalClaim}</strong>
          <em className="state-tag state-quiet">待核查</em>
        </div>
        <div className="dock-arrow cinema-breath" aria-hidden="true">
          <span className="dock-arrow-glyph">→</span>
        </div>
        <div className={`strength-meter cinema-rise cinema-rise-d1 ${exploring ? "" : "allowed"}`}>
          <span className="small-caps">核查后结论</span>
          <strong>
            {exploring
              ? "正在核查中…"
              : `${label}（判断置信度 ${confidenceScore}%）`}
          </strong>
          <em className="state-tag">
            {exploring ? `${explorationCount} 个节点已核查` : `原信息可信度 ${effectiveCredibilityScore}%`}
          </em>
        </div>

        <p className="conclusion-lede cinema-rise cinema-rise-d2">
          {exploring
            ? "系统正在沿你选择的节点进行深度核查，调用中控 LLM 和子 Agent。"
            : handoffResult?.conclusion ?? report.rewrittenClaim.cautious}
        </p>

        {(handoffResult?.canSay || handoffResult?.cannotSay) && !exploring && (
          <div className="boundary-panel cinema-rise cinema-rise-d3">
            <div className="boundary-col boundary-col--allowed">
              <h4 className="boundary-col-title">
                <span className="boundary-col-dot boundary-col-dot--allowed" />
                可以说
              </h4>
              <ul className="boundary-list">
                {(handoffResult.canSay ?? []).map((item, i) => (
                  <li key={i} className="boundary-list-item">{item}</li>
                ))}
              </ul>
            </div>
            <div className="boundary-col boundary-col--blocked">
              <h4 className="boundary-col-title">
                <span className="boundary-col-dot boundary-col-dot--blocked" />
                不能说
              </h4>
              <ul className="boundary-list">
                {(handoffResult.cannotSay ?? []).map((item, i) => (
                  <li key={i} className="boundary-list-item">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* v2-iteration 2026-07-04: PR-1 报告级推理许可聚合 */}
        {!exploring && report.inferenceLicense ? (
          <InferenceLicensePanel license={report.inferenceLicense} />
        ) : null}

        {handoffResult?.scoreBreakdown && !exploring && (
          <div className="score-breakdown cinema-rise cinema-rise-d4">
            <span className="breakdown-label small-caps">可信度分解</span>
            <div className="breakdown-bars">
              {(["factCheckSignal", "searchSignal", "sourceSignal"] as const).map((key, idx) => {
                const val = handoffResult.scoreBreakdown![key];
                if (typeof val !== "number") return null;
                const pct = Math.round((val + 1) / 2 * 100);
                return (
                  <div
                    key={key}
                    className="breakdown-bar-row"
                    style={{ animationDelay: `${idx * 80}ms` }}
                  >
                    <span className="breakdown-bar-label">{key.replace("Signal", "")}</span>
                    <div className="breakdown-bar-track">
                      <div
                        className={`breakdown-bar-fill ${val >= 0 ? "positive" : "negative"}`}
                        style={{
                          width: `${Math.max(0, Math.min(100, pct))}%`,
                          animationDelay: `${idx * 100 + 200}ms`,
                        }}
                      />
                    </div>
                    <span className="breakdown-bar-value">{val.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!exploring && (
          <div className="conclusion-actions cinema-rise cinema-rise-d5">
            <button
              className="conclusion-action-btn conclusion-action-btn--primary"
              onClick={() => setIsModalOpen(true)}
              type="button"
            >
              查看报告
            </button>
            <button
              className="conclusion-action-btn"
              onClick={handleRebuttalCard}
              type="button"
            >
              辟谣卡片
            </button>
            <button
              className="conclusion-action-btn"
              onClick={handleArchive}
              type="button"
            >
              存疑归档
            </button>
            <button
              className="conclusion-action-btn"
              onClick={handleShare}
              type="button"
            >
              分享核查
            </button>
            <button
              className="conclusion-action-btn primary"
              onClick={handleExport}
              type="button"
            >
              导出报告
            </button>
            {actionMessage ? <span className="conclusion-action-message">{actionMessage}</span> : null}
            {archiveCount > 0 ? <span className="conclusion-action-message">存疑 {archiveCount}</span> : null}
          </div>
        )}
      </footer>

      <ReportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        report={report}
        caseData={caseData}
        verificationResult={verificationResult ?? undefined}
        onSetVerification={onSetVerification}
      />
    </>
  );
}
