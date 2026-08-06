/**
 * MissionProcessShell — Phase 1 process layer for Ant Design X mapping.
 *
 * Renders MissionShellModel (from streamAdapter).
 * Default `variant="token"`: pure CSS ThoughtChain-like UI (no antd/x).
 * Optional `variant="antdx"`: real ThoughtChain via MissionProcessShellAntd.
 * Does not own SSE — parent feeds `model`.
 */
import type { MissionShellModel, ShellAgentChip, ShellThoughtItem, ShellToolItem } from "../../../../lib/missionShell";
import { formatReviewIssue, humanizeVerdictType } from "../../../../lib/missionShell/labels";
import { MissionProcessShellAntd } from "./MissionProcessShellAntd";

export type MissionProcessShellVariant = "token" | "antdx";

export interface MissionProcessShellProps {
  model: MissionShellModel;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onSelectTool?: (toolKey: string) => void;
  className?: string;
  /**
   * `token` (default): pure CSS chain — used by MissionShellPreview + tests.
   * `antdx`: @ant-design/x ThoughtChain under scoped XProvider.
   */
  variant?: MissionProcessShellVariant;
}

function statusDotClass(status: ShellThoughtItem["status"]): string {
  if (status === "loading") return "mps-dot mps-dot--loading";
  if (status === "error") return "mps-dot mps-dot--error";
  if (status === "success") return "mps-dot mps-dot--success";
  return "mps-dot mps-dot--pending";
}

function AgentCluster({
  agents,
  selectedAgentId,
  onSelectAgent,
}: {
  agents: ShellAgentChip[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <div className="mps-cluster" role="list" aria-label="协作角色">
      {agents.map((agent) => {
        const active = selectedAgentId === agent.agentId;
        return (
          <button
            key={agent.agentId}
            type="button"
            role="listitem"
            className={`mps-chip${active ? " mps-chip--active" : ""} mps-chip--${agent.status}`}
            onClick={() => onSelectAgent?.(agent.agentId)}
          >
            <span className="mps-chip-name">{agent.name}</span>
            <span className="mps-chip-status">
              {agent.status === "loading" ? "进行中" : agent.status === "error" ? "失败" : agent.status === "success" ? "完成" : "等待"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ToolStrip({
  tools,
  onSelectTool,
}: {
  tools: ShellToolItem[];
  onSelectTool?: (toolKey: string) => void;
}) {
  if (tools.length === 0) return null;
  return (
    <div className="mps-tools" role="list" aria-label="过程动作">
      {tools.map((tool) => (
        <button
          key={tool.key}
          type="button"
          role="listitem"
          className={`mps-tool mps-tool--${tool.status}`}
          onClick={() => onSelectTool?.(tool.key)}
        >
          <span className="mps-tool-title">{tool.title}</span>
          {tool.detail ? <span className="mps-tool-detail">{tool.detail}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Pure-CSS ThoughtChain stand-in (default; no @ant-design/x). */
function TokenThoughtChain({ items }: { items: ShellThoughtItem[] }) {
  if (items.length === 0) {
    return <p className="mps-empty">核查开始后，过程会逐步出现在这里。</p>;
  }
  return (
    <ol className="mps-chain">
      {items.map((item, index) => (
        <li key={item.key} className={`mps-step mps-step--${item.status} mps-step--${item.kind}`}>
          <div className="mps-step-rail">
            <span className={statusDotClass(item.status)} aria-hidden />
            {index < items.length - 1 ? <span className="mps-step-line" aria-hidden /> : null}
          </div>
          <div className="mps-step-body">
            <div className="mps-step-title">{item.title}</div>
            {item.description ? <div className="mps-step-desc">{item.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MissionProcessShell({
  model,
  selectedAgentId,
  onSelectAgent,
  onSelectTool,
  className,
  variant = "token",
}: MissionProcessShellProps) {
  if (variant === "antdx") {
    const antd = (
      <MissionProcessShellAntd
        model={model}
        selectedAgentId={selectedAgentId ?? null}
        onSelectAgent={onSelectAgent}
        onSelectTool={onSelectTool}
      />
    );
    if (!className) return antd;
    return <div className={className}>{antd}</div>;
  }

  const visibleThoughts =
    selectedAgentId
      ? model.thoughtItems.filter(
          (item) =>
            item.agentId === selectedAgentId ||
            item.kind === "planner" ||
            item.kind === "report" ||
            item.kind === "review"
        )
      : model.thoughtItems;

  return (
    <section
      className={`mps-root${className ? ` ${className}` : ""}`}
      data-live={model.live ? "1" : "0"}
      data-error={model.errorMessage ? "1" : "0"}
      data-variant="token"
    >
      <header className="mps-header">
        <div className="mps-phase">{model.phaseLabel}</div>
        {model.claim ? <div className="mps-claim">{model.claim}</div> : null}
        {model.errorMessage ? (
          <div className="mps-live mps-live--error">已中断</div>
        ) : model.live ? (
          <div className="mps-live">进行中</div>
        ) : (
          <div className="mps-live mps-live--done">已完成</div>
        )}
      </header>

      <ToolStrip tools={model.tools} onSelectTool={onSelectTool} />
      <AgentCluster agents={model.agents} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} />
      {selectedAgentId ? (
        <p className="mps-filter-hint">
          已筛选角色过程
          <button type="button" className="mps-filter-clear" onClick={() => onSelectAgent?.("")}>
            显示全部
          </button>
        </p>
      ) : null}
      <TokenThoughtChain items={visibleThoughts} />

      {model.verdict.present ? (
        <div className="mps-verdict">
          <div className="mps-verdict-label">结论</div>
          <div className="mps-verdict-type">{humanizeVerdictType(model.verdict.verdictType)}</div>
          {typeof model.verdict.credibilityScore === "number" ? (
            <div className="mps-verdict-score">可信度 {model.verdict.credibilityScore}</div>
          ) : null}
          {model.verdict.conclusion ? <p className="mps-verdict-text">{model.verdict.conclusion}</p> : null}
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
      ) : null}

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
