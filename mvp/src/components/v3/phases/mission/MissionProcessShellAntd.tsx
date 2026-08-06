/**
 * MissionProcessShellAntd — Ant Design X ThoughtChain renderer.
 * Same VisibleProcessNarrative as token shell; visual only differs.
 */
import { useMemo } from "react";
import { ThoughtChain, XProvider } from "@ant-design/x";
import type { ThoughtChainItemType } from "@ant-design/x";
import { theme } from "antd";
import type { MissionShellModel } from "../../../../lib/missionShell";
import {
  formatReviewIssue,
  humanizeVerdictType,
  type VisibleProcessNarrative,
  type VisibleProcessRow,
} from "../../../../lib/missionShell";

export interface MissionProcessShellAntdProps {
  model: MissionShellModel;
  narrative: VisibleProcessNarrative;
  onSelectTool?: (toolKey: string) => void;
  className?: string;
  claimInParent?: boolean;
  expandAll?: boolean;
  onExpandAll?: () => void;
  onToggleExpand?: () => void;
}

const MPS_X_THEME = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: "#2563eb",
    colorBgContainer: "transparent",
    colorText: "#18181b",
    colorTextSecondary: "#71717a",
    colorBorder: "#e4e4e7",
    borderRadius: 10,
    fontFamily: '"SF Pro Text", "PingFang SC", system-ui, sans-serif',
  },
} as const;

function mapStatus(status: VisibleProcessRow["status"]): ThoughtChainItemType["status"] | undefined {
  if (status === "loading") return "loading";
  if (status === "success") return "success";
  if (status === "error") return "error";
  return undefined;
}

/** Map narrative rows → ThoughtChain items (exported for tests). */
export function mapNarrativeRowsToAntdItems(rows: VisibleProcessRow[]): ThoughtChainItemType[] {
  return rows.map((row) => {
    const activityLine =
      row.activities.length > 0
        ? row.activities
            .map((a) => `${a.title}${a.detail ? ` · ${a.detail}` : ""}`)
            .join("；")
        : undefined;
    const parts = [row.summary, row.actor ? row.actor.name : null, activityLine, row.nextHint ? `下一步：${row.nextHint}` : null].filter(
      Boolean
    );
    return {
      key: row.key,
      title: row.title,
      description: parts.length ? parts.join(" · ") : undefined,
      status: mapStatus(row.status),
      blink: false,
    };
  });
}

export function MissionProcessShellAntd({
  model,
  narrative,
  onSelectTool,
  className,
  claimInParent = true,
  expandAll = false,
  onExpandAll,
  onToggleExpand,
}: MissionProcessShellAntdProps) {
  const visibleRows = useMemo(
    () => narrative.rows.filter((r) => expandAll || narrative.mode === "error" || r.expanded),
    [narrative, expandAll]
  );
  const chainItems = useMemo(() => mapNarrativeRowsToAntdItems(visibleRows), [visibleRows]);

  return (
    <XProvider theme={MPS_X_THEME as never}>
      <section
        className={`mps-root mps-root--antdx mps-root--narrative${className ? ` ${className}` : ""}`}
        data-live={model.live ? "1" : "0"}
        data-error={model.errorMessage ? "1" : "0"}
        data-mode={narrative.mode}
        data-variant="antdx"
        data-claim-in-parent={claimInParent ? "1" : "0"}
      >
        {narrative.deferredReview ? (
          <div className="mps-deferred" role="status">
            <div className="mps-deferred-label">结论暂缓，正在补证</div>
            <p className="mps-deferred-text">
              审查发现目前证据不足或结论过强，暂不发布最终判断。
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
        ) : null}

        {narrative.showVerdict && model.verdict.present ? (
          <div className="mps-verdict">
            <div className="mps-verdict-label">结论</div>
            <div className="mps-verdict-type">{humanizeVerdictType(model.verdict.verdictType)}</div>
            {model.verdict.conclusion ? (
              <p className="mps-verdict-text">{model.verdict.conclusion}</p>
            ) : null}
          </div>
        ) : null}

        {narrative.mode === "complete" ? (
          <div className="mps-process-fold">
            <button
              type="button"
              className="mps-process-fold-btn"
              onClick={onToggleExpand || onExpandAll}
              aria-expanded={expandAll}
            >
              {expandAll ? "收起核查过程" : `回看核查过程 · ${narrative.rows.length} 步`}
            </button>
          </div>
        ) : null}

        {(narrative.mode !== "complete" || expandAll) && (
          <>
            {narrative.collapsedCount > 0 && !expandAll ? (
              <button type="button" className="mps-expand-collapsed" onClick={onExpandAll}>
                已完成 {narrative.collapsedCount} 步 · 展开
              </button>
            ) : null}
            {visibleRows.length === 0 ? (
              <p className="mps-empty">核查开始后，过程会逐步出现在这里。</p>
            ) : (
              <div className="mps-antd-narrative">
                <ThoughtChain className="mps-antd-chain" items={chainItems} line="solid" />
                {/* Nested activities as plain list for click targets */}
                {visibleRows.map((row) =>
                  row.activities.length > 0 ? (
                    <ul key={`act-${row.key}`} className="mps-activities mps-activities--antd" aria-label={`${row.title} 活动`}>
                      {row.activities.map((act) => (
                        <li key={act.key} className={`mps-activity mps-activity--${act.status}`}>
                          {onSelectTool && act.toolKey ? (
                            <button
                              type="button"
                              className="mps-activity-btn"
                              onClick={() => onSelectTool(act.toolKey!)}
                            >
                              <span className="mps-activity-title">{act.title}</span>
                              {act.detail ? (
                                <span className="mps-activity-detail">{act.detail}</span>
                              ) : null}
                            </button>
                          ) : (
                            <div className="mps-activity-static">
                              <span className="mps-activity-title">{act.title}</span>
                              {act.detail ? (
                                <span className="mps-activity-detail">{act.detail}</span>
                              ) : null}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null
                )}
                {/* Current step marker for a11y parity with token */}
                {visibleRows.some((r) => r.isCurrent) ? (
                  <span className="mps-sr-only" aria-current="step">
                    {visibleRows.find((r) => r.isCurrent)?.title}
                  </span>
                ) : null}
              </div>
            )}
          </>
        )}

        {model.errorMessage ? (
          <div className="mps-error" role="alert">
            <div className="mps-error-label">过程中断</div>
            <p className="mps-error-text">{model.errorMessage}</p>
          </div>
        ) : null}
      </section>
    </XProvider>
  );
}
