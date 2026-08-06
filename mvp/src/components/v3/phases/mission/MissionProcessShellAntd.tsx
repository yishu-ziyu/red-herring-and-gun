/**
 * MissionProcessShellAntd — optional Ant Design X ThoughtChain shell.
 *
 * Maps MissionShellModel.thoughtItems → ThoughtChain items.
 * Scoped under XProvider (includes antd ConfigProvider) so landing /
 * global tree is not polluted until this component mounts.
 *
 * Used only when MissionProcessShell variant="antdx".
 * Does NOT import MissionProcessShell (avoids circular dep).
 *
 * Status map (Shell → ThoughtChain):
 *   loading → loading (+ blink)
 *   success → success
 *   error   → error
 *   pending → omitted (ThoughtChain has loading|success|error|abort only)
 */
import { useMemo } from "react";
import { ThoughtChain, XProvider } from "@ant-design/x";
import type { ThoughtChainItemType } from "@ant-design/x";
import { theme } from "antd";
import type {
  MissionShellModel,
  ShellAgentChip,
  ShellNodeStatus,
  ShellThoughtItem,
  ShellToolItem,
} from "../../../../lib/missionShell";
import { formatReviewIssue, humanizeVerdictType } from "../../../../lib/missionShell/labels";

export interface MissionProcessShellAntdProps {
  model: MissionShellModel;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onSelectTool?: (toolKey: string) => void;
  className?: string;
}

/** Stable theme object — avoid XProvider re-init loops on every render */
const MPS_X_THEME = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#7eb8ff",
    colorBgContainer: "#1a1d24",
    colorText: "#e8eaef",
    colorTextSecondary: "#9aa3b2",
    colorBorder: "#2a2f3a",
    borderRadius: 10,
    fontFamily: '"SF Pro Text", "PingFang SC", system-ui, sans-serif',
  },
} as const;

function mapThoughtStatus(
  status: ShellNodeStatus
): ThoughtChainItemType["status"] | undefined {
  if (status === "loading") return "loading";
  if (status === "success") return "success";
  if (status === "error") return "error";
  // pending: no ThoughtChain equivalent — omit status icon
  return undefined;
}

/** Pure mapper: ShellThoughtItem[] → ThoughtChain items (exported for tests). */
export function mapShellThoughtsToAntdItems(
  items: ShellThoughtItem[]
): ThoughtChainItemType[] {
  return items.map((item) => ({
    key: item.key,
    title: item.title,
    description: item.description,
    status: mapThoughtStatus(item.status),
    // blink can thrash re-renders in some X versions; keep off for stability
    blink: false,
  }));
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
              {agent.status === "loading"
                ? "进行中"
                : agent.status === "error"
                  ? "失败"
                  : agent.status === "success"
                    ? "完成"
                    : "等待"}
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

function AntdThoughtChain({ items }: { items: ShellThoughtItem[] }) {
  const chainItems = useMemo(() => mapShellThoughtsToAntdItems(items), [items]);
  if (items.length === 0) {
    return <p className="mps-empty">核查开始后，过程会逐步出现在这里。</p>;
  }
  return (
    <ThoughtChain
      className="mps-antd-chain"
      items={chainItems}
      line="solid"
    />
  );
}

/**
 * Full process shell using real @ant-design/x ThoughtChain.
 * XProvider is local: only this subtree gets antd/x theme tokens.
 */
export function MissionProcessShellAntd({
  model,
  selectedAgentId,
  onSelectAgent,
  onSelectTool,
  className,
}: MissionProcessShellAntdProps) {
  const visibleThoughts = selectedAgentId
    ? model.thoughtItems.filter(
        (item) =>
          item.agentId === selectedAgentId ||
          item.kind === "planner" ||
          item.kind === "report" ||
          item.kind === "review"
      )
    : model.thoughtItems;

  return (
    <XProvider theme={MPS_X_THEME as never}>
      <section
        className={`mps-root mps-root--antdx${className ? ` ${className}` : ""}`}
        data-live={model.live ? "1" : "0"}
        data-error={model.errorMessage ? "1" : "0"}
        data-variant="antdx"
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
        <AgentCluster
          agents={model.agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
        {selectedAgentId ? (
          <p className="mps-filter-hint">
            已筛选角色过程
            <button type="button" className="mps-filter-clear" onClick={() => onSelectAgent?.("")}>
              显示全部
            </button>
          </p>
        ) : null}
        <AntdThoughtChain items={visibleThoughts} />

        {model.verdict.present ? (
          <div className="mps-verdict">
            <div className="mps-verdict-label">结论</div>
            <div className="mps-verdict-type">{humanizeVerdictType(model.verdict.verdictType)}</div>
            {typeof model.verdict.credibilityScore === "number" ? (
              <div className="mps-verdict-score">可信度 {model.verdict.credibilityScore}</div>
            ) : null}
            {model.verdict.conclusion ? (
              <p className="mps-verdict-text">{model.verdict.conclusion}</p>
            ) : null}
            {typeof model.verdict.reviewPassed === "boolean" ? (
              <div
                className={`mps-review ${model.verdict.reviewPassed ? "mps-review--ok" : "mps-review--warn"}`}
              >
                报告审稿 · {model.verdict.reviewPassed ? "通过" : "需补证"}
                {typeof model.verdict.reviewScore === "number"
                  ? ` · ${model.verdict.reviewScore}`
                  : ""}
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
    </XProvider>
  );
}

export default MissionProcessShellAntd;
