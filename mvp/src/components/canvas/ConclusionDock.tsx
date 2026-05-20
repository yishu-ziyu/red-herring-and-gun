import type { FinalReport } from "../../lib/schemas";

interface ConclusionDockProps {
  report: FinalReport;
  revealStage: number;
  explorationCount?: number;
}

export function ConclusionDock({ report, revealStage, explorationCount = 0 }: ConclusionDockProps) {
  const finished = revealStage >= 5;
  const exploring = explorationCount > 0 && !finished;

  return (
    <footer className="conclusion-dock" aria-label="Conclusion dock">
      <div className="strength-meter">
        <span>原句强度</span>
        <strong>{report.originalClaim}</strong>
        <em>过强</em>
      </div>
      <div className="dock-arrow" aria-hidden="true">
        →
      </div>
      <div className="strength-meter allowed">
        <span>证据允许强度</span>
        <strong>{finished ? "AI 可能是影响因素之一" : exploring ? "正在局部发散，暂不收束总答案" : "等待你选择节点继续发散"}</strong>
        <em>{finished ? "谨慎" : exploring ? `${explorationCount} 次节点调用` : "用户主导"}</em>
      </div>
      <p>
        {finished
          ? report.rewrittenClaim.cautious
          : "系统先搭出问题空间，后续只在你选择的节点上调用中控 LLM 和子 Agent。"}
      </p>
    </footer>
  );
}
