/**
 * ReportFooter.tsx — 结论操作区（存成长图 / 结论文异反馈），共享给结果页与过程页。
 */
import { useState } from "react";

export function ReportFooter({
  claim,
  verdictType,
  score,
}: {
  claim: string;
  verdictType: string;
  score?: number;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState("");

  const downloadLongImage = async () => {
    try {
      const { createShareLongImage } = await import("../../lib/shareLongImage");
      const url = createShareLongImage({ claim, verdictLabel: verdictType, score, timestamp: Date.now() });
      const a = document.createElement("a");
      a.href = url;
      a.download = `核查-${claim.slice(0, 12) || "结论"}.png`;
      a.click();
    } catch (error) {
      // F2：导出失败不打扰主结论，但留现场
      console.error("[feedback] 长图导出失败", error);
    }
  };

  const submit = async () => {
    if (!reason.trim()) return;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: claim.slice(0, 2000),
          verdictType,
          score,
          reason: reason.trim().slice(0, 2000),
        }),
      });
      if (!res.ok) throw new Error(`feedback HTTP ${res.status}`);
      setSent(true);
      setFailed(false);
    } catch (error) {
      // F2：不再谎报「已记录」——异议确实没存上，用户必须知道并能重试
      console.error("[feedback] 异议提交失败", error);
      setFailed(true);
    }
  };

  if (sent) {
    return (
      <p className="report-feedback report-feedback--sent">
        已记录。核查结论会随新证据变化，但这条异议会进评测集。
      </p>
    );
  }

  return (
    <div className="report-feedback">
      {open ? (
        <div className="report-feedback__form">
          <label htmlFor="rhg-feedback-reason">这个判断可能有误——哪里不对？</label>
          <textarea
            id="rhg-feedback-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="例如：配文断章取义 / 来源已失效 / 截图是旧闻…"
          />
          <button type="button" className="result-view-btn" onClick={submit} disabled={!reason.trim()}>
            提交异议
          </button>
          {failed ? (
            <p className="report-feedback__error" role="alert">
              没能提交成功，内容还留在框里，可以再试一次。
            </p>
          ) : null}
        </div>
      ) : (
        <div className="report-feedback__actions">
          <button type="button" className="report-feedback__link" onClick={downloadLongImage}>
            存成长图
          </button>
          <button type="button" className="report-feedback__link" onClick={() => setOpen(true)}>
            这个判断可能有误
          </button>
        </div>
      )}
    </div>
  );
}