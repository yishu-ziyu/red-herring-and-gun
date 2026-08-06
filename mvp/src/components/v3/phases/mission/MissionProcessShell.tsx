/**
 * MissionProcessShell — single narrative process stream (token renderer).
 *
 * No inner claim/phase/live chrome. No top-level ToolStrip or AgentCluster.
 * Tools nest under steps; agents are actor attribution. Shared narrative model
 * via buildVisibleProcessRows (antdx uses the same).
 */
import { useMemo, useState } from "react";
import type { MissionShellModel } from "../../../../lib/missionShell";
import {
  buildVisibleProcessRows,
  formatReviewIssue,
  humanizeVerdictType,
  type VisibleProcessNarrative,
  type VisibleProcessRow,
} from "../../../../lib/missionShell";
import { MissionProcessShellAntd } from "./MissionProcessShellAntd";

export type MissionProcessShellVariant = "token" | "antdx";

export interface MissionProcessShellProps {
  model: MissionShellModel;
  /** @deprecated filtering via agent chips removed; kept for call-site compat */
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onSelectTool?: (toolKey: string) => void;
  className?: string;
  variant?: MissionProcessShellVariant;
  /** When true, claim is already shown by parent — shell never re-prints it */
  claimInParent?: boolean;
}

function statusDotClass(status: VisibleProcessRow["status"]): string {
  if (status === "loading") return "mps-dot mps-dot--loading mps-orb";
  if (status === "error") return "mps-dot mps-dot--error";
  if (status === "success") return "mps-dot mps-dot--success";
  return "mps-dot mps-dot--pending";
}

function ProcessRowView({
  row,
  onSelectTool,
}: {
  row: VisibleProcessRow;
  onSelectTool?: (toolKey: string) => void;
}) {
  return (
    <li
      key={row.key}
      className={`mps-step mps-step--${row.status} mps-step--${row.kind}${row.isCurrent ? " mps-step--current" : ""}`}
      aria-current={row.isCurrent ? "step" : undefined}
      data-row-key={row.key}
    >
      <div className="mps-step-rail">
        <span className={statusDotClass(row.status)} aria-hidden />
        <span className="mps-step-line" aria-hidden />
      </div>
      <div className="mps-step-body">
        <div className="mps-step-title-row">
          {row.status === "success" && !row.isCurrent ? (
            <span className="mps-step-check" aria-hidden>
              ✓
            </span>
          ) : null}
          <div className="mps-step-title">{row.title}</div>
        </div>
        {row.summary ? <div className="mps-step-desc">{row.summary}</div> : null}
        {row.actor ? (
          <div className="mps-step-actor">{row.actor.name}</div>
        ) : null}
        {row.activities.length > 0 ? (
          <ul className="mps-activities" aria-label="步骤活动">
            {row.activities.map((act) => (
              <li key={act.key} className={`mps-activity mps-activity--${act.status}`}>
                {onSelectTool && act.toolKey ? (
                  <button
                    type="button"
                    className="mps-activity-btn"
                    onClick={() => onSelectTool(act.toolKey!)}
                  >
                    <span className="mps-activity-title">{act.title}</span>
                    {act.detail ? <span className="mps-activity-detail">{act.detail}</span> : null}
                  </button>
                ) : (
                  <div className="mps-activity-static">
                    <span className="mps-activity-title">{act.title}</span>
                    {act.detail ? <span className="mps-activity-detail">{act.detail}</span> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {row.nextHint ? <div className="mps-step-next">下一步：{row.nextHint}</div> : null}
      </div>
    </li>
  );
}

function NarrativeStream({
  narrative,
  onSelectTool,
  forceExpandAll,
}: {
  narrative: VisibleProcessNarrative;
  onSelectTool?: (toolKey: string) => void;
  forceExpandAll: boolean;
}) {
  const visible = narrative.rows.filter((r) => forceExpandAll || r.expanded);

  if (narrative.rows.length === 0 && !narrative.errorMessage && !narrative.deferredReview) {
    return <p className="mps-empty">核查开始后，过程会逐步出现在这里。</p>;
  }

  return (
    <ol className="mps-chain mps-chain--narrative">
      {visible.map((row) => (
        <ProcessRowView key={row.key} row={row} onSelectTool={onSelectTool} />
      ))}
    </ol>
  );
}

function VerdictBlock({ narrative, model }: { narrative: VisibleProcessNarrative; model: MissionShellModel }) {
  if (narrative.deferredReview) {
    return (
      <div className="mps-deferred" role="status">
        <div className="mps-deferred-label">结论暂缓，正在补证</div>
        <p className="mps-deferred-text">
          审查发现目前证据不足或结论过强，暂不发布最终判断。
          {typeof model.verdict.reviewScore === "number" ? `（审稿 ${model.verdict.reviewScore}）` : ""}
        </p>
        {model.verdict.reviewIssues && model.verdict.reviewIssues.length > 0 ? (
          <ul className="mps-review-issues">
            {model.verdict.reviewIssues.slice(0, 3).map((issue, index) => (
              <li key={issue.code || index} className="mps-review-issue">
                {formatReviewIssue(issue)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (!narrative.showVerdict || !model.verdict.present) return null;

  const findings = model.verdict.keyFindings?.filter(Boolean).slice(0, 4) ?? [];
  const sources = model.verdict.topSources?.slice(0, 3) ?? [];

  return (
    <div className="mps-verdict mps-verdict--hero" role="region" aria-label="核查结论">
      <div className="mps-verdict-label">现在可以怎么看</div>
      <div className="mps-verdict-badges">
        <div className="mps-verdict-type">{humanizeVerdictType(model.verdict.verdictType)}</div>
        {typeof model.verdict.credibilityScore === "number" ? (
          <div className="mps-verdict-score">可信度 {model.verdict.credibilityScore}</div>
        ) : null}
      </div>
      {model.verdict.conclusion ? <p className="mps-verdict-text">{model.verdict.conclusion}</p> : null}
      {model.verdict.shareAdvice ? (
        <div className="mps-share-advice" aria-label="转发建议">
          <span className="mps-share-advice-label">转发建议</span>
          <p className="mps-share-advice-text">{model.verdict.shareAdvice}</p>
        </div>
      ) : null}
      {findings.length > 0 ? (
        <ul className="mps-findings" aria-label="关键发现">
          {findings.map((item) => (
            <li key={item.slice(0, 48)} className="mps-finding-chip">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {sources.length > 0 ? (
        <div className="mps-top-sources" aria-label="关键来源">
          <span className="mps-top-sources-label">关键来源</span>
          <ul className="mps-top-sources-list">
            {sources.map((src) => (
              <li key={(src.url || src.title).slice(0, 80)}>
                {src.url ? (
                  <a href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.title}
                  </a>
                ) : (
                  <span>{src.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mps-top-sources-empty">本案未挂接可点开的稳定来源链接；详见完整报告与过程记录。</p>
      )}
      {typeof model.verdict.reviewPassed === "boolean" ? (
        <div className={`mps-review ${model.verdict.reviewPassed ? "mps-review--ok" : "mps-review--warn"}`}>
          报告审稿 · {model.verdict.reviewPassed ? "通过" : "需补证"}
          {typeof model.verdict.reviewScore === "number" ? ` · ${model.verdict.reviewScore}` : ""}
          {model.verdict.reviewIssues && model.verdict.reviewIssues.length > 0 ? (
            <ul className="mps-review-issues">
              {model.verdict.reviewIssues.slice(0, 3).map((issue, index) => (
                <li key={issue.code || index} className="mps-review-issue">
                  {formatReviewIssue(issue)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MissionProcessShell({
  model,
  onSelectTool,
  className,
  variant = "token",
  claimInParent = true,
}: MissionProcessShellProps) {
  const narrative = useMemo(() => buildVisibleProcessRows(model), [model]);
  const [expandAll, setExpandAll] = useState(false);

  if (variant === "antdx") {
    const antd = (
      <MissionProcessShellAntd
        model={model}
        narrative={narrative}
        onSelectTool={onSelectTool}
        claimInParent={claimInParent}
        expandAll={expandAll}
        onToggleExpand={() => setExpandAll((v) => !v)}
        onExpandAll={() => setExpandAll(true)}
      />
    );
    if (!className) return antd;
    return <div className={className}>{antd}</div>;
  }

  const showCollapseToggle = narrative.collapsedCount > 0 && !expandAll;

  return (
    <section
      className={`mps-root mps-root--narrative${className ? ` ${className}` : ""}`}
      data-live={model.live ? "1" : "0"}
      data-error={model.errorMessage ? "1" : "0"}
      data-mode={narrative.mode}
      data-variant="token"
      data-claim-in-parent={claimInParent ? "1" : "0"}
    >
      {/* No inner claim / phase / live pill — parent Mission Control owns those */}

      {narrative.showVerdict || narrative.deferredReview ? (
        <VerdictBlock narrative={narrative} model={model} />
      ) : null}

      {narrative.mode === "complete" ? (
        <div className="mps-process-fold">
          <button
            type="button"
            className="mps-process-fold-btn"
            onClick={() => setExpandAll((v) => !v)}
            aria-expanded={expandAll}
          >
            {expandAll ? "收起核查过程" : `回看核查过程 · ${narrative.rows.length} 步`}
          </button>
        </div>
      ) : null}

      {(narrative.mode !== "complete" || expandAll) && (
        <>
          {showCollapseToggle ? (
            <button type="button" className="mps-expand-collapsed" onClick={() => setExpandAll(true)}>
              已完成 {narrative.collapsedCount} 步 · 展开
            </button>
          ) : null}
          <NarrativeStream
            narrative={narrative}
            onSelectTool={onSelectTool}
            forceExpandAll={expandAll || narrative.mode === "error"}
          />
        </>
      )}

      {model.errorMessage ? (
        <div className="mps-error" role="alert">
          <div className="mps-error-label">过程中断</div>
          <p className="mps-error-text">{model.errorMessage}</p>
        </div>
      ) : null}
    </section>
  );
}

export default MissionProcessShell;
