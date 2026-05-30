import { useState, useCallback } from "react";
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
  } | null;
  originalClaim?: string;
}

function getCredibilityLabel(score: number): string {
  if (score >= 80) return "可信";
  if (score >= 60) return "基本可信";
  if (score >= 40) return "部分可信";
  if (score >= 20) return "高度可疑";
  return "疑似谣言";
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
  const effectiveCredibilityScore = handoffResult?.credibilityScore ?? credibilityScore;
  const label = handoffResult?.credibilityLabel ?? getCredibilityLabel(effectiveCredibilityScore);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [archiveCount, setArchiveCount] = useState(() => getDoubtfulArchiveCount());

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
      <footer className="conclusion-dock" aria-label="Conclusion dock">
        <div className="strength-meter">
          <span>原始信息可信度</span>
          <strong>{handoffResult?.claim ?? originalClaim ?? report.originalClaim}</strong>
          <em>待核查</em>
        </div>
        <div className="dock-arrow" aria-hidden="true">
          →
        </div>
        <div className={`strength-meter ${exploring ? "" : "allowed"}`}>
          <span>核查后结论</span>
          <strong>
            {exploring
              ? "正在核查中..."
              : `${label} (${effectiveCredibilityScore}%)`}
          </strong>
          <em>{exploring ? `${explorationCount} 个节点已核查` : label}</em>
        </div>
        <p>
          {exploring
            ? "系统正在沿你选择的节点进行深度核查，调用中控 LLM 和子 Agent。"
            : handoffResult?.conclusion ?? report.rewrittenClaim.cautious}
        </p>

        {!exploring && (
          <div className="conclusion-actions">
            <button
              className="conclusion-action-btn"
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
