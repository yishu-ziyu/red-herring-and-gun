import { useState, useMemo, type CSSProperties } from "react";
import { useReasoning } from "../../../store/reasoningStore";
import type { AgentRun, RecursiveSearchRun, HandoffRun } from "../../../store/reasoningStore";
import type { HandoffStep } from "../../../lib/agentExpansion";
import { AGENT_CONTRACTS, type AgentContract } from "../../../lib/agentConfigs";

interface AgentProfile extends AgentContract {
  color: string;
  bgColor: string;
}

const AGENT_PROFILE_STYLES: Record<string, Pick<AgentProfile, "color" | "bgColor">> = {
  rumor_detector: { color: "#dc2626", bgColor: "rgba(239, 68, 68, 0.08)" },
  fact_checker: { color: "#2563eb", bgColor: "rgba(37, 99, 235, 0.08)" },
  source_validator: { color: "#7c3aed", bgColor: "rgba(124, 58, 237, 0.08)" },
  report_composer: { color: "#16a34a", bgColor: "rgba(22, 163, 74, 0.08)" },
};

const AGENT_PROFILES: AgentProfile[] = [
  AGENT_CONTRACTS.rumor_detector,
  AGENT_CONTRACTS.fact_checker,
  AGENT_CONTRACTS.source_validator,
  AGENT_CONTRACTS.report_composer,
].map((contract) => ({
  ...contract,
  ...(AGENT_PROFILE_STYLES[contract.id] ?? { color: "#64748b", bgColor: "rgba(100, 116, 139, 0.08)" }),
}));

const HANDOFF_OUTPUT_METADATA_KEYS = new Set([
  "timestamp",
  "latencyMs",
  "model",
  "agent",
  "agentTitle",
  "systemPrompt",
]);

const HANDOFF_EXPANDED_BODY_STYLE: CSSProperties = {
  maxHeight: "min(62vh, 520px)",
  overflowY: "auto",
  paddingRight: 6,
};

const HANDOFF_DETAIL_CONTENT_STYLE: CSSProperties = {
  borderBottom: "1px dashed #cbd5e1",
  marginBottom: 14,
};

const HANDOFF_DASHED_LINE_STYLE: CSSProperties = {
  background: "transparent",
  borderLeft: "1px dashed #cbd5e1",
  width: 0,
};

const HANDOFF_DETAIL_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 10,
};

const HANDOFF_DETAIL_META_STYLE: CSSProperties = {
  color: "#64748b",
  fontFamily: "monospace",
  fontSize: 11,
};

const HANDOFF_DETAIL_ROW_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  gap: 8,
  alignItems: "start",
  marginTop: 8,
};

const HANDOFF_DETAIL_LABEL_STYLE: CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 600,
};

const HANDOFF_DETAIL_TEXT_STYLE: CSSProperties = {
  color: "#334155",
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
  wordBreak: "break-word",
};

function inferAgentType(run: AgentRun): string {
  const modeMap: Record<string, string> = {
    rumor_check: "rumor_detector",
    search: "fact_checker",
    evidence_audit: "evidence_grader",
    counter: "fact_checker",
    rewrite: "report_composer",
  };
  return modeMap[run.mode] ?? "fact_checker";
}

function inferAgentTypeRecursive(run: RecursiveSearchRun): string {
  return "source_validator";
}

export function AgentPanel() {
  const { state } = useReasoning();
  const { agentRuns, recursiveSearchRuns, sherlockSearchRuns, handoffRuns, currentHandoffRun, isExpanding } = state;
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedHandoff, setExpandedHandoff] = useState<string | null>(null);

  const latestHandoff = handoffRuns[handoffRuns.length - 1];

  const agentStats = useMemo(() => {
    const stats: Record<string, { runs: AgentRun[]; recursions: RecursiveSearchRun[]; sherlocks: typeof sherlockSearchRuns; count: number }> = {};

    for (const profile of AGENT_PROFILES) {
      stats[profile.id] = { runs: [], recursions: [], sherlocks: [], count: 0 };
    }

    for (const run of agentRuns) {
      const type = run.agentType ?? inferAgentType(run);
      if (stats[type]) {
        stats[type].runs.push(run);
        stats[type].count++;
      }
    }

    for (const run of recursiveSearchRuns) {
      const type = inferAgentTypeRecursive(run);
      if (stats[type]) {
        stats[type].recursions.push(run);
        stats[type].count++;
      }
    }

    for (const run of sherlockSearchRuns) {
      // Sherlock searches are source validation tasks
      if (stats.source_validator) {
        stats.source_validator.sherlocks.push(run);
        stats.source_validator.count++;
      }
    }

    return stats;
  }, [agentRuns, recursiveSearchRuns]);

  const activeAgentId = isExpanding
    ? agentRuns.length > 0
      ? (agentRuns[agentRuns.length - 1].agentType ?? inferAgentType(agentRuns[agentRuns.length - 1]))
      : null
    : null;

  return (
    <section className="workspace-panel agent-panel" aria-label="Agent panel">
      <div className="panel-heading">
        <span>Agent</span>
        <strong>多 Agent 协作监控</strong>
      </div>

      <div className="panel-content">
        {/* Handoff Run 展示（包括实时 streaming） */}
        {(handoffRuns.length > 0 || currentHandoffRun) && (
          <div className="handoff-section">
            <div className="handoff-section-header">
              <span className="handoff-section-title">多 Agent Handoff 链路</span>
              <span className="handoff-section-count">
                {handoffRuns.length} 次完成
                {currentHandoffRun && (
                  <span className="handoff-streaming-badge">● 实时执行中</span>
                )}
              </span>
            </div>

            {/* 正在进行的 Streaming Handoff */}
            {currentHandoffRun && (
              <div className="handoff-run-card handoff-run-card--streaming">
                <div className="handoff-run-header">
                  <div className="handoff-run-title">
                    <span className="handoff-run-claim">{currentHandoffRun.claim.slice(0, 30)}...</span>
                    <span className="handoff-run-meta">实时执行中...</span>
                  </div>
                  <span className="streaming-pulse-dot" />
                </div>
                <div className="handoff-run-body">
                  <div className="handoff-steps">
                    {currentHandoffRun.steps.map((step, index) => (
                      <HandoffStepItem
                        key={step.agent}
                        step={step}
                        index={index}
                        isLast={index === currentHandoffRun.steps.length - 1}
                      />
                    ))}
                    {isExpanding && (
                      <div className="handoff-step handoff-step--pending">
                        <div className="handoff-step-connector">
                          <div className="handoff-step-dot handoff-step-dot--pulse" />
                        </div>
                        <div className="handoff-step-content">
                          <span className="handoff-step-pending-text">调度中...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 已完成的 Handoffs */}
            {handoffRuns.map((handoff) => (
              <HandoffRunCard
                key={handoff.id}
                handoff={handoff}
                isExpanded={expandedHandoff === handoff.id}
                onToggle={() => setExpandedHandoff(expandedHandoff === handoff.id ? null : handoff.id)}
              />
            ))}
          </div>
        )}
        {/* Agent 卡片网格 */}
        <div className="agent-grid">
          {AGENT_PROFILES.map((profile) => {
            const stat = agentStats[profile.id];
            const isActive = activeAgentId === profile.id;
            const hasWork = stat.count > 0;
            const isExpanded = expandedAgent === profile.id;

            return (
              <div
                key={profile.id}
                className={`agent-card ${isActive ? "agent-card--active" : ""} ${hasWork ? "agent-card--has-work" : ""}`}
                style={{ borderColor: profile.color + "25" }}
              >
                <button
                  className="agent-card-header"
                  onClick={() => setExpandedAgent(isExpanded ? null : profile.id)}
                  type="button"
                >
                  <div className="agent-card-icon" style={{ background: profile.bgColor }}>
                    {profile.icon}
                  </div>
                  <div className="agent-card-info">
                    <div className="agent-card-name-row">
                      <span className="agent-card-name">{profile.name}</span>
                      <span
                        className={`agent-status-dot ${isActive ? "agent-status-dot--running" : hasWork ? "agent-status-dot--done" : ""}`}
                        style={{ background: isActive ? profile.color : hasWork ? "#16a34a" : "#d1d5db" }}
                      />
                    </div>
                    <span className="agent-card-desc">{profile.roleTitle}</span>
                  </div>
                  <div className="agent-card-meta">
                    <span className="agent-card-count">{stat.count}</span>
                    <span className="agent-card-toggle">{isExpanded ? "▾" : "▸"}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="agent-card-body">
                    <div className="agent-contract-summary">
                      <p>{profile.mission}</p>
                      <div className="agent-contract-pills">
                        {profile.tools.slice(0, 4).map((tool) => (
                          <span key={tool.id}>{tool.name}</span>
                        ))}
                      </div>
                      <div className="agent-contract-boundary">
                        <strong>边界</strong>
                        <span>{profile.nonGoals.slice(0, 2).join("；")}</span>
                      </div>
                    </div>
                    {stat.count === 0 ? (
                      <p className="agent-card-empty">暂无调度记录</p>
                    ) : (
                      <>
                        {stat.runs.length > 0 && (
                          <div className="agent-task-list">
                            {stat.runs.map((run) => (
                              <div key={run.id} className="agent-task-item">
                                <div className="agent-task-header">
                                  <span className="agent-task-node">{run.nodeTitle}</span>
                                  <span className="agent-task-mode">{modeLabel(run.mode)}</span>
                                </div>
                                <p className="agent-task-note">{run.controllerNote}</p>
                                {run.canSay.length > 0 && (
                                  <p className="agent-task-cansay">✓ {run.canSay.join("；")}</p>
                                )}
                                {run.cannotSay.length > 0 && (
                                  <p className="agent-task-cannotsay">✗ {run.cannotSay.join("；")}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {stat.recursions.length > 0 && (
                          <div className="agent-task-list">
                            {stat.recursions.map((run) => (
                              <div key={run.id} className="agent-task-item">
                                <div className="agent-task-header">
                                  <span className="agent-task-node">{run.nodeTitle}</span>
                                  <span className="agent-task-mode">递归搜索</span>
                                </div>
                                <p className="agent-task-note">{run.controllerNote}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {stat.sherlocks.length > 0 && (
                          <div className="agent-task-list">
                            {/* Sherlock 统计概览 */}
                            <div className="sherlock-stats-overview">
                              <div className="sherlock-stat-row">
                                <span>累计命中平台</span>
                                <strong>
                                  {stat.sherlocks.reduce((sum, run) => sum + run.sourcesMatched, 0)} /
                                  {stat.sherlocks.reduce((sum, run) => sum + run.sourcesSearched, 0)}
                                </strong>
                              </div>
                              <div className="sherlock-stat-row">
                                <span>溯源次数</span>
                                <strong>{stat.sherlocks.length}</strong>
                              </div>
                              {stat.sherlocks.length > 0 && (
                                <div className="sherlock-stat-row">
                                  <span>上次搜索</span>
                                  <strong>刚刚</strong>
                                </div>
                              )}
                            </div>

                            {/* 命中平台列表 */}
                            {(() => {
                              const latestSherlock = stat.sherlocks[stat.sherlocks.length - 1];
                              return latestSherlock && latestSherlock.hits.length > 0 ? (
                                <div className="sherlock-platform-list">
                                  <p className="sherlock-platform-label">最近命中平台</p>
                                  <div className="sherlock-platform-chips">
                                    {latestSherlock.hits.map((hit) => (
                                      <span
                                        key={hit.sourceId}
                                        className={`sherlock-platform-chip sherlock-platform-chip--${hit.factCheckResult ?? "unverified"}`}
                                        title={hit.summary}
                                      >
                                        {hit.sourceIcon} {hit.sourceName}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null;
                            })()}

                            {stat.sherlocks.map((run) => (
                              <div key={run.id} className="agent-task-item">
                                <div className="agent-task-header">
                                  <span className="agent-task-node">{run.nodeTitle}</span>
                                  <span className="agent-task-mode">Sherlock溯源</span>
                                </div>
                                <p className="agent-task-note">{run.controllerNote}</p>
                                <p className="agent-task-cansay">命中 {run.sourcesMatched}/{run.sourcesSearched} 个平台</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 全局状态 */}
        <div className="agent-global-status">
          <div className="info-block">
            <h3>调度统计</h3>
            <div className="agent-stat-row">
              <span>Agent 调用</span>
              <strong>{agentRuns.length + handoffRuns.length}</strong>
            </div>
            <div className="agent-stat-row">
              <span>递归搜索</span>
              <strong>{recursiveSearchRuns.length}</strong>
            </div>
            <div className="agent-stat-row">
              <span>Sherlock 溯源</span>
              <strong>{sherlockSearchRuns.length}</strong>
            </div>
            <div className="agent-stat-row">
              <span>当前状态</span>
              <strong style={{ color: isExpanding ? "#d97706" : "#16a34a" }}>
                {isExpanding ? "运行中..." : "空闲"}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function modeLabel(mode: string): string {
  const labels: Record<string, string> = {
    search: "联网搜索",
    evidence_audit: "证据审计",
    counter: "反证生成",
    rewrite: "局部改写",
    rumor_check: "谣言核查",
  };
  return labels[mode] ?? mode;
}

// ───────────────────────────────────────────────────────────────
// Handoff Run Card
// ───────────────────────────────────────────────────────────────

function HandoffRunCard({
  handoff,
  isExpanded,
  onToggle,
}: {
  handoff: HandoffRun;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="handoff-run-card">
      <button className="handoff-run-header" onClick={onToggle} type="button">
        <div className="handoff-run-title">
          <span className="handoff-run-claim">{handoff.claim.slice(0, 30)}...</span>
          <span className="handoff-run-meta">
            {handoff.steps.length} 个 Agent · {handoff.totalLatencyMs}ms
          </span>
        </div>
        <span className="handoff-run-toggle">{isExpanded ? "▾" : "▸"}</span>
      </button>

      {isExpanded && (
        <div className="handoff-run-body" style={HANDOFF_EXPANDED_BODY_STYLE}>
          {/* Handoff Steps Timeline */}
          <div className="handoff-steps">
            {handoff.steps.map((step, index) => (
              <HandoffDetailStepItem
                key={`${step.agent}-${step.timestamp}-${index}`}
                step={step}
                isLast={index === handoff.steps.length - 1}
              />
            ))}
          </div>

          {/* Final Report */}
          {handoff.finalReport && (
            <div className="handoff-final-report">
              <div className="handoff-report-header">最终报告</div>
              <FinalReportContent report={handoff.finalReport} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HandoffDetailStepItem({
  step,
  isLast,
}: {
  step: HandoffStep;
  isLast: boolean;
}) {
  const profile = AGENT_PROFILES.find((p) => p.id === step.agent);
  const statusColor = step.status === "completed" ? "#16a34a" : step.status === "failed" ? "#dc2626" : "#d97706";
  const contextKeys = getHandoffContextKeys(step.output);

  return (
    <div className="handoff-step">
      <div className="handoff-step-connector">
        <div className="handoff-step-dot" style={{ background: statusColor }} />
        {!isLast && <div className="handoff-step-line" style={HANDOFF_DASHED_LINE_STYLE} />}
      </div>
      <div className="handoff-step-content" style={isLast ? undefined : HANDOFF_DETAIL_CONTENT_STYLE}>
        <div className="handoff-step-header" style={HANDOFF_DETAIL_HEADER_STYLE}>
          <span className="handoff-step-name">{step.agentName || profile?.name || step.agent}</span>
          <span aria-label={statusLabel(step.status)} title={statusLabel(step.status)}>
            {statusBadge(step.status)}
          </span>
          <span className="handoff-step-model" style={HANDOFF_DETAIL_META_STYLE}>
            {step.model || "unknown-model"}
          </span>
          <span className="handoff-step-latency" style={HANDOFF_DETAIL_META_STYLE}>
            {step.latencyMs}ms
          </span>
        </div>

        <div className="handoff-step-output" style={{ marginLeft: 0 }}>
          <div style={HANDOFF_DETAIL_ROW_STYLE}>
            <span style={HANDOFF_DETAIL_LABEL_STYLE}>输入</span>
            <p style={HANDOFF_DETAIL_TEXT_STYLE}>{getHandoffInputSummary(step)}</p>
          </div>
          <div style={HANDOFF_DETAIL_ROW_STYLE}>
            <span style={HANDOFF_DETAIL_LABEL_STYLE}>输出</span>
            <p style={HANDOFF_DETAIL_TEXT_STYLE}>{getHandoffOutputSummary(step)}</p>
          </div>
          {contextKeys.length > 0 && (
            <div style={HANDOFF_DETAIL_ROW_STYLE}>
              <span style={HANDOFF_DETAIL_LABEL_STYLE}>传递</span>
              <div className="handoff-output-tags" style={{ marginTop: 0 }}>
                {contextKeys.map((key) => (
                  <span key={key} className="handoff-output-tag handoff-output-tag--source">
                    {key}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HandoffStepItem({
  step,
  index,
  isLast,
}: {
  step: HandoffStep;
  index: number;
  isLast: boolean;
}) {
  const profile = AGENT_PROFILES.find((p) => p.id === step.agent);
  const statusColor = step.status === "completed" ? "#16a34a" : step.status === "failed" ? "#dc2626" : "#d97706";

  return (
    <div className="handoff-step">
      <div className="handoff-step-connector">
        <div className="handoff-step-dot" style={{ background: statusColor }} />
        {!isLast && <div className="handoff-step-line" />}
      </div>
      <div className="handoff-step-content">
        <div className="handoff-step-header">
          <span className="handoff-step-icon" style={{ background: profile?.bgColor || "#f3f4f6" }}>
            {step.agentIcon || profile?.icon || "🤖"}
          </span>
          <div className="handoff-step-info">
            <span className="handoff-step-name">{step.agentName || profile?.name || step.agent}</span>
            <span className="handoff-step-model">{step.model}</span>
          </div>
          <span className="handoff-step-latency">{step.latencyMs}ms</span>
        </div>

        {/* Output Summary */}
        {step.output && Object.keys(step.output).length > 0 && (
          <div className="handoff-step-output">
            <HandoffOutputSummary agentId={step.agent} output={step.output} />
          </div>
        )}
      </div>
    </div>
  );
}

function statusBadge(status: HandoffStep["status"]): string {
  if (status === "completed") return "✅完成";
  if (status === "failed") return "❌失败";
  return "⏳运行中";
}

function statusLabel(status: HandoffStep["status"]): string {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  return "运行中";
}

function getHandoffInputSummary(step: HandoffStep): string {
  const claim = step.input.claim;
  if (typeof claim === "string" && claim.trim().length > 0) return claim;
  return truncateText(safeStringify(step.input), 80);
}

function getHandoffOutputSummary(step: HandoffStep): string {
  const agentSummary = getHandoffStepSummary(step);
  if (agentSummary) return truncateText(agentSummary, 120);

  const conclusion = step.output.conclusion;
  if (typeof conclusion === "string" && conclusion.trim().length > 0) return truncateText(conclusion, 120);

  const summary = step.output.summary;
  if (typeof summary === "string" && summary.trim().length > 0) return truncateText(summary, 120);

  if (step.error) return truncateText(step.error, 120);
  return truncateText(safeStringify(step.output), 120);
}

function getHandoffStepSummary(step: HandoffStep): string | null {
  switch (step.agent) {
    case "rumor_detector": {
      const severity = step.output.severity;
      const indicators = Array.isArray(step.output.rumorIndicators) ? step.output.rumorIndicators : [];
      if (indicators.length === 0 && severity == null) return null;
      return `检测到 ${indicators.length} 个谣言特征 · 严重程度: ${String(severity ?? "未知")}`;
    }
    case "fact_checker": {
      const result = step.output.factCheckResult;
      const confidence = step.output.confidence;
      if (result == null && confidence == null) return null;
      return `核查结果: ${String(result ?? "未知")} · 置信度: ${String(confidence ?? "未知")}`;
    }
    case "source_validator": {
      const reliability = step.output.sourceReliability;
      const verified = Array.isArray(step.output.verifiedSources) ? step.output.verifiedSources.length : 0;
      if (verified === 0 && reliability == null) return null;
      return `信源可靠性: ${String(reliability ?? "未知")} · 已验证 ${verified} 个来源`;
    }
    case "report_composer": {
      const score = step.output.credibilityScore;
      const label = step.output.credibilityLabel;
      if (score == null && label == null) return null;
      return `可信度: ${String(score ?? "未知")}/100 · ${String(label ?? "未知")}`;
    }
    default:
      return null;
  }
}

function getHandoffContextKeys(output: Record<string, unknown>): string[] {
  return Object.keys(output).filter((key) => !HANDOFF_OUTPUT_METADATA_KEYS.has(key));
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    const text = JSON.stringify(value);
    return text ?? String(value);
  } catch {
    return String(value);
  }
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function HandoffOutputSummary({ agentId, output }: { agentId: string; output: Record<string, unknown> }) {
  switch (agentId) {
    case "rumor_detector":
      return (
        <div className="handoff-output-rumor">
          <div className="handoff-output-row">
            <span>严重程度</span>
            <strong className={`severity-${output.severity}`}>{String(output.severity ?? "")}</strong>
          </div>
          {Array.isArray(output.rumorIndicators) && output.rumorIndicators.length > 0 && (
            <div className="handoff-output-tags">
              {output.rumorIndicators.map((indicator: string, i: number) => (
                <span key={i} className="handoff-output-tag handoff-output-tag--rumor">
                  {indicator}
                </span>
              ))}
            </div>
          )}
          {typeof output.analysis === "string" && <p className="handoff-output-text">{output.analysis.slice(0, 120)}...</p>}
        </div>
      );
    case "fact_checker":
      return (
        <div className="handoff-output-fact">
          <div className="handoff-output-row">
            <span>核查结果</span>
            <strong className={`result-${output.factCheckResult}`}>{String(output.factCheckResult ?? "")}</strong>
          </div>
          <div className="handoff-output-row">
            <span>置信度</span>
            <strong>{String(output.confidence ?? "")}</strong>
          </div>
          {Array.isArray(output.sources) && output.sources.length > 0 && (
            <div className="handoff-output-tags">
              {output.sources.slice(0, 3).map((source: string, i: number) => (
                <span key={i} className="handoff-output-tag handoff-output-tag--source">
                  {source}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case "source_validator":
      return (
        <div className="handoff-output-source">
          <div className="handoff-output-row">
            <span>信源可靠性</span>
            <strong className={`reliability-${output.sourceReliability}`}>{String(output.sourceReliability ?? "")}</strong>
          </div>
          {Array.isArray(output.verifiedSources) && output.verifiedSources.length > 0 && (
            <div className="handoff-output-tags">
              {output.verifiedSources.slice(0, 3).map((source: string, i: number) => (
                <span key={i} className="handoff-output-tag handoff-output-tag--verified">
                  {source}
                </span>
              ))}
            </div>
          )}
          {typeof output.verificationNotes === "string" && (
            <p className="handoff-output-text">{output.verificationNotes.slice(0, 120)}...</p>
          )}
        </div>
      );
    case "report_composer":
      return (
        <div className="handoff-output-report">
          <div className="handoff-output-row">
            <span>可信度评分</span>
            <strong className="credibility-score">{String(output.credibilityScore ?? "")}/100</strong>
          </div>
          <div className="handoff-output-row">
            <span>标签</span>
            <strong>{String(output.credibilityLabel ?? "")}</strong>
          </div>
          {typeof output.conclusion === "string" && <p className="handoff-output-text">{output.conclusion}</p>}
        </div>
      );
    default:
      return (
        <div className="handoff-output-generic">
          {Object.entries(output)
            .slice(0, 3)
            .map(([key, value]) => (
              <div key={key} className="handoff-output-row">
                <span>{key}</span>
                <strong>{typeof value === "string" ? value : JSON.stringify(value).slice(0, 40)}</strong>
              </div>
            ))}
        </div>
      );
  }
}

function FinalReportContent({ report }: { report: Record<string, unknown> }) {
  return (
    <div className="handoff-report-body">
      {typeof report.conclusion === "string" && (
        <div className="handoff-report-section">
          <label>结论</label>
          <p>{report.conclusion}</p>
        </div>
      )}
      {typeof report.credibilityScore === "number" && (
        <div className="handoff-report-section">
          <label>可信度评分</label>
          <div className="credibility-bar">
            <div
              className="credibility-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(0, report.credibilityScore as number))}%`,
                background:
                  (report.credibilityScore as number) >= 60
                    ? "#16a34a"
                    : (report.credibilityScore as number) >= 40
                      ? "#d97706"
                      : "#dc2626",
              }}
            />
            <span>{report.credibilityScore}/100</span>
          </div>
        </div>
      )}
      {typeof report.recommendation === "string" && (
        <div className="handoff-report-section">
          <label>建议</label>
          <p>{report.recommendation}</p>
        </div>
      )}
      {typeof report.summaryForPublic === "string" && (
        <div className="handoff-report-section">
          <label>公众版摘要</label>
          <p>{report.summaryForPublic}</p>
        </div>
      )}
    </div>
  );
}
