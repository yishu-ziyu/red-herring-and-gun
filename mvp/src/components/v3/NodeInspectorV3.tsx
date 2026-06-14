import type { CanvasNode } from "../../data/reasoningCanvas";
import type { ExpansionMode } from "../../lib/agentExpansion";
import type { CandidateMaterial, DemoCase, FinalReport, GradedEvidence } from "../../lib/schemas";
import type { AgentRun, RecursiveSearchRun, SherlockSearchRun } from "../../store/reasoningStore";

interface NodeInspectorV3Props {
  node: CanvasNode;
  caseData: DemoCase;
  gradedEvidence: GradedEvidence[];
  report: FinalReport;
  canExpand: boolean;
  expansionPrompt: string;
  expansionMode: ExpansionMode;
  latestRun?: AgentRun;
  latestRecursiveRun?: RecursiveSearchRun;
  recursiveRuns: RecursiveSearchRun[];
  sherlockRuns: SherlockSearchRun[];
  isExpanding: boolean;
  agentError: string;
  recursiveSearchPrompt: string;
  recursiveDepthLimit: number;
  recursiveBudgetLimit: number;
  onExpansionPromptChange: (value: string) => void;
  onExpansionModeChange: (mode: ExpansionMode) => void;
  onExpandNode: (prompt: string, mode: ExpansionMode) => void;
  onRecursiveSearchPromptChange: (value: string) => void;
  onRecursiveDepthLimitChange: (value: number) => void;
  onRecursiveBudgetLimitChange: (value: number) => void;
  onRecursiveSearch: (question: string, depthLimit: number, budgetLimit: number) => void;
  onSherlockSearch: (claim: string) => void;
  on360Search: (query: string) => void;
}

export function NodeInspectorV3({
  node,
  caseData,
  gradedEvidence,
  report,
  canExpand,
  expansionPrompt,
  expansionMode,
  latestRun,
  latestRecursiveRun,
  recursiveRuns,
  sherlockRuns,
  isExpanding,
  agentError,
  recursiveSearchPrompt,
  recursiveDepthLimit,
  recursiveBudgetLimit,
  onExpansionPromptChange,
  onExpansionModeChange,
  onExpandNode,
  onRecursiveSearchPromptChange,
  onRecursiveDepthLimitChange,
  onRecursiveBudgetLimitChange,
  onRecursiveSearch,
  onSherlockSearch,
  on360Search,
}: NodeInspectorV3Props) {
  const subclaim = node.sourceRef?.subclaimId
    ? caseData.subclaims.find((item) => item.id === node.sourceRef?.subclaimId)
    : undefined;
  const route = node.sourceRef?.subclaimId
    ? caseData.routes.find((item) => item.subclaimId === node.sourceRef?.subclaimId)
    : undefined;
  const candidate = node.sourceRef?.candidateId
    ? caseData.candidates.find((item) => item.id === node.sourceRef?.candidateId)
    : undefined;
  const grade = node.sourceRef?.candidateId
    ? gradedEvidence.find(
        (item) => item.candidateId === node.sourceRef?.candidateId && item.subclaimId === node.sourceRef?.subclaimId,
      )
    : undefined;

  // Dynamic suggestions based on node type
  const suggestions = getSuggestionsForNodeType(node.type);

  return (
    <aside className="node-inspector" aria-label="Node inspector">
      <div className="panel-heading">
        <span>Context Inspector</span>
        <strong>{node.type.replace("_", " ")}</strong>
      </div>

      <div className={`inspector-status status-${node.status ?? "active"}`}>{statusText(node.status)}</div>
      <h2>{node.title}</h2>
      {node.subtitle ? <p className="inspector-subtitle">{node.subtitle}</p> : null}

      {renderBody(node, caseData, report, recursiveRuns, subclaim, route, candidate, grade)}

      <NodeExpansionPanelV3
        suggestions={suggestions}
        canExpand={canExpand}
        prompt={expansionPrompt}
        mode={expansionMode}
        latestRun={latestRun}
        isExpanding={isExpanding}
        error={agentError}
        onPromptChange={onExpansionPromptChange}
        onModeChange={onExpansionModeChange}
        onExpand={onExpandNode}
      />

      <RecursiveSearchPanel
        node={node}
        canExpand={canExpand}
        prompt={recursiveSearchPrompt}
        depthLimit={recursiveDepthLimit}
        budgetLimit={recursiveBudgetLimit}
        latestRun={latestRecursiveRun}
        isExpanding={isExpanding}
        error={agentError}
        onPromptChange={onRecursiveSearchPromptChange}
        onDepthLimitChange={onRecursiveDepthLimitChange}
        onBudgetLimitChange={onRecursiveBudgetLimitChange}
        onRecursiveSearch={onRecursiveSearch}
      />

      <SherlockSearchPanel
        node={node}
        canExpand={canExpand}
        latestRun={sherlockRuns.find((run) => run.nodeId === node.id)}
        isExpanding={isExpanding}
        error={agentError}
        onSherlockSearch={onSherlockSearch}
      />

      <Search360Panel
        node={node}
        canExpand={canExpand}
        isExpanding={isExpanding}
        error={agentError}
        on360Search={on360Search}
      />
    </aside>
  );
}

function getSuggestionsForNodeType(type: CanvasNode["type"]): Array<{ mode: ExpansionMode; label: string; prompt: string }> {
  switch (type) {
    case "claim":
    case "judgment":
    case "subclaim":
      return [
        { mode: "evidence_audit", label: "证据审计", prompt: "这个判断需要什么证据？当前材料能支持到什么程度？" },
        { mode: "counter", label: "寻找反证", prompt: "这个判断可能存在什么问题？有什么反面证据或替代解释？" },
        { mode: "search", label: "联网搜索", prompt: "针对这个判断的关键词，搜索更多候选材料。" },
      ];
    case "evidence_need":
      return [
        { mode: "search", label: "搜索材料", prompt: "针对这个证据需求，搜索相关候选材料。" },
        { mode: "evidence_audit", label: "评估现有", prompt: "当前已有材料中，哪些能满足这个证据需求？" },
      ];
    case "candidate_evidence":
      return [
        { mode: "evidence_audit", label: "证据分级", prompt: "这份材料能支持什么结论？不能支持什么？" },
        { mode: "search", label: "更多材料", prompt: "寻找与这份材料相关但角度不同的其他证据。" },
      ];
    case "inference_license":
      return [
        { mode: "rewrite", label: "生成改写", prompt: "基于当前证据许可，生成更谨慎的表达方式。" },
        { mode: "evidence_audit", label: "回溯证据", prompt: "回顾支持这个推理许可的证据链是否充分。" },
      ];
    case "agent_task":
    case "evidence_clue":
    case "search_frontier":
      return [
        { mode: "search", label: "继续搜索", prompt: "继续搜索该节点相关的更多材料。" },
        { mode: "evidence_audit", label: "审计结果", prompt: "评估这个 Agent 任务的结果质量。" },
      ];
    case "search_stopped":
      return [
        { mode: "evidence_audit", label: "检查停止原因", prompt: "检查这条线索为什么不应该继续扩展。" },
      ];
    case "rewrite":
      return [
        { mode: "rewrite", label: "再次改写", prompt: "基于新的证据，进一步调整表达强度。" },
      ];
    default:
      return [
        { mode: "evidence_audit", label: "证据审计", prompt: "它还需要哪些证据？" },
      ];
  }
}

function renderBody(
  node: CanvasNode,
  caseData: DemoCase,
  report: FinalReport,
  recursiveRuns: RecursiveSearchRun[],
  subclaim?: DemoCase["subclaims"][number],
  route?: DemoCase["routes"][number],
  candidate?: CandidateMaterial,
  grade?: GradedEvidence,
) {
  const recursiveRun = node.sourceRef?.recursiveRunId
    ? recursiveRuns.find((run) => run.id === node.sourceRef?.recursiveRunId)
    : undefined;
  const clue = node.sourceRef?.clueId
    ? recursiveRun?.clues.find((item) => item.id === node.sourceRef?.clueId)
    : undefined;
  const frontier = node.sourceRef?.frontierId
    ? recursiveRun?.frontier.find((item) => item.id === node.sourceRef?.frontierId)
    : undefined;
  const stopped = node.sourceRef?.stoppedId
    ? recursiveRun?.stopped.find((item) => item.id === node.sourceRef?.stoppedId)
    : undefined;

  if (node.type === "claim") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="原句" items={[caseData.originalClaim]} />
        <InfoBlock title="主要风险" items={[caseData.diagnosis.risk, caseData.diagnosis.whyNotDirectFactCheck]} />
        <InfoBlock title="混合判断" items={caseData.diagnosis.mixedJudgments} />
      </div>
    );
  }

  if (node.type === "judgment" || node.type === "subclaim") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="它在问什么" items={[subclaim?.text ?? node.title]} />
        {node.id === "judgment-causal" ? (
          <InfoBlock
            title="当前审计结论"
            items={["当前证据不能支持\"AI 导致岗位减少\"，只能支持\"AI 可能是影响因素之一\"。"]}
            tone="blocked"
          />
        ) : null}
        <InfoBlock title="为什么重要" items={[subclaim?.roleInArgument ?? "用于判断原句是否说得过满。"]} />
        {route ? <InfoBlock title="需要什么证据" items={route.neededEvidence} /> : null}
        {route ? <InfoBlock title="不能用什么证据" items={route.notAcceptable} tone="blocked" /> : null}
        {route ? <InfoBlock title="最低输出规则" items={[route.minimumOutputRule]} tone="limited" /> : null}
      </div>
    );
  }

  if (node.type === "evidence_need") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="证据需求" items={route?.neededEvidence ?? [node.subtitle ?? node.title]} />
        <InfoBlock title="不接受" items={route?.notAcceptable ?? ["不能用背景评论替代该节点需要的证据。"]} tone="blocked" />
        <InfoBlock title="输出规则" items={[route?.minimumOutputRule ?? "证据不满足时，只能保留为待查问题。"]} />
      </div>
    );
  }

  if (node.type === "candidate_evidence" && candidate) {
    return (
      <div className="inspector-stack">
        <InfoBlock title="候选材料" items={[candidate.title, candidate.summary]} />
        <div className="permission-grid">
          <InfoBlock title="可以说" items={grade?.inferenceAllowed ?? ["只能作为背景线索。"]} tone="supported" />
          <InfoBlock title="不能说" items={grade?.inferenceBlocked ?? candidate.limitations} tone="blocked" />
        </div>
        <InfoBlock
          title="审计细节"
          items={[
            `材料类型：${candidate.sourceType}`,
            `证据角色：${grade?.evidenceRole ?? "待判定"}`,
            `使用级别：${grade?.usageLevel ?? "待判定"}`,
            `Grader 决策：${grade?.graderDecision ?? "not_graded"}`,
          ]}
          tone="limited"
        />
      </div>
    );
  }

  if (node.type === "agent_task") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="Agent 角色" items={[node.subtitle ?? "该子 Agent 只处理当前节点上的局部任务。"]} />
        <InfoBlock
          title="调度边界"
          items={["中控 LLM 只负责判断该调用哪个能力，不负责自动替用户展开所有路径。", "子 Agent 的输出会回到画布，等待用户继续选择。"]}
          tone="limited"
        />
      </div>
    );
  }

  if (node.type === "evidence_clue") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="递归搜索线索" items={[clue?.summary ?? node.subtitle ?? "这是本轮递归搜索发现的线索。"]} />
        <InfoBlock title="来源" items={[clue?.source ?? "未提供来源"]} tone="limited" />
        <div className="permission-grid">
          <InfoBlock title="可以说" items={recursiveRun?.canSay ?? ["只能作为下一步审计线索。"]} tone="supported" />
          <InfoBlock title="不能说" items={recursiveRun?.cannotSay ?? ["不能直接作为最终结论。"]} tone="blocked" />
        </div>
        <InfoBlock
          title="线索角色"
          items={[`角色：${clueRoleLabel(clue?.role)}`, `可信度：${confidenceLabel(clue?.confidence)}`]}
          tone="limited"
        />
      </div>
    );
  }

  if (node.type === "search_frontier") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="为什么值得继续" items={[frontier?.reasonToContinue ?? node.subtitle ?? "这条线索可能补足当前证据边界。"]} />
        <InfoBlock title="建议下一问" items={[frontier?.nextQuestion ?? "继续检查这条线索能支持什么、不能支持什么。"]} tone="limited" />
        <InfoBlock
          title="控制权"
          items={["系统不会自动继续展开这条 frontier。只有用户选择它并触发递归搜索时，才会调用模型。"]}
          tone="supported"
        />
      </div>
    );
  }

  if (node.type === "search_stopped") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="停止原因" items={[stoppedReasonLabel(stopped?.reason) ?? node.subtitle ?? "这条线索不适合继续扩展。"]} tone="blocked" />
        <InfoBlock title="为什么不继续" items={["停止节点保留在图谱中，用来避免重复搜索、低可信扩散或偏离当前问题。"]} tone="limited" />
      </div>
    );
  }

  if (node.type === "inference_license") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="当前证据允许的结论" items={[report.allowedConclusion]} tone="supported" />
        <InfoBlock title="禁止的推断" items={report.doNotInfer} tone="blocked" />
        <InfoBlock
          title="为什么降级"
          items={["当前材料缺少 AI 采用时间、替代解释处理和反事实证据，因此不能把同期变化写成\"AI 导致\"。"]}
          tone="limited"
        />
      </div>
    );
  }

  if (node.type === "rewrite") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="谨慎版" items={[report.rewrittenClaim.cautious]} tone="supported" />
        <InfoBlock title="通俗版" items={[report.rewrittenClaim.publicFacing]} />
        <InfoBlock title="研究备忘录版" items={[report.rewrittenClaim.researchMemo]} tone="limited" />
      </div>
    );
  }

  return <InfoBlock title="节点说明" items={[node.subtitle ?? "该节点用于展开 Agent reasoning。"]} />;
}

function InfoBlock({ title, items, tone }: { title: string; items: string[]; tone?: "supported" | "blocked" | "limited" }) {
  return (
    <section className={`info-block ${tone ? `tone-${tone}` : ""}`}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function NodeExpansionPanelV3({
  suggestions,
  canExpand,
  prompt,
  mode,
  latestRun,
  isExpanding,
  error,
  onPromptChange,
  onModeChange,
  onExpand,
}: {
  suggestions: Array<{ mode: ExpansionMode; label: string; prompt: string }>;
  canExpand: boolean;
  prompt: string;
  mode: ExpansionMode;
  latestRun?: AgentRun;
  isExpanding: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onModeChange: (mode: ExpansionMode) => void;
  onExpand: (prompt: string, mode: ExpansionMode) => void;
}) {
  function handleSuggestionClick(suggestion: (typeof suggestions)[0]) {
    onPromptChange(suggestion.prompt);
    onModeChange(suggestion.mode);
  }

  return (
    <section className="node-expansion-panel">
      <div className="node-expansion-heading">
        <span>Node-triggered Agent</span>
        <strong>{canExpand ? "选择展开方向" : "处理中..."}</strong>
      </div>

      <p>中控 LLM 不自动替你走完整张图。你在某个节点上追问时，它才调度对应子 Agent，把新增分支接回画布。</p>

      {/* Dynamic suggestions */}
      <div className="suggestion-chips" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
        {suggestions.map((s) => (
          <button
            key={s.mode + s.label}
            className={`mode-button ${s.mode === mode && s.prompt === prompt ? "selected" : ""}`}
            onClick={() => handleSuggestionClick(s)}
            disabled={!canExpand || isExpanding}
            type="button"
            style={{ minHeight: "32px", padding: "6px 12px", fontSize: "12px" }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        disabled={!canExpand || isExpanding}
        aria-label="节点追问"
        rows={3}
      />

      {error ? <div className="agent-error">{error}</div> : null}

      <div className="mode-grid" role="group" aria-label="选择要触发的 Agent 能力">
        {expansionModes.map((item) => (
          <button
            key={item.mode}
            className={item.mode === mode ? "mode-button selected" : "mode-button"}
            onClick={() => onModeChange(item.mode)}
            disabled={!canExpand || isExpanding}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        className="expand-node-button"
        onClick={() => onExpand(prompt, mode)}
        disabled={!canExpand || isExpanding || prompt.trim().length === 0}
        type="button"
      >
        {isExpanding ? "正在调用真实大模型..." : "调用中控 LLM，在此节点继续发散"}
      </button>

      {latestRun ? (
        <div className="agent-run-card">
          <strong>最近一次调度</strong>
          <span>{latestRun.controllerNote}</span>
          <em>已派给：{latestRun.agents.join(" → ")}</em>
          <span>{latestRun.inspectorSummary}</span>
          {latestRun.canSay.length > 0 ? <em>可以说：{latestRun.canSay.join("；")}</em> : null}
          {latestRun.cannotSay.length > 0 ? <em>不能说：{latestRun.cannotSay.join("；")}</em> : null}
          {latestRun.sources.length > 0 ? <em>来源：{latestRun.sources.join("；")}</em> : null}
          <em>模型：{latestRun.model}</em>
        </div>
      ) : null}
    </section>
  );
}

function RecursiveSearchPanel({
  node,
  canExpand,
  prompt,
  depthLimit,
  budgetLimit,
  latestRun,
  isExpanding,
  error,
  onPromptChange,
  onDepthLimitChange,
  onBudgetLimitChange,
  onRecursiveSearch,
}: {
  node: CanvasNode;
  canExpand: boolean;
  prompt: string;
  depthLimit: number;
  budgetLimit: number;
  latestRun?: RecursiveSearchRun;
  isExpanding: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onDepthLimitChange: (value: number) => void;
  onBudgetLimitChange: (value: number) => void;
  onRecursiveSearch: (question: string, depthLimit: number, budgetLimit: number) => void;
}) {
  const frontier = latestRun?.frontier.find((item) => node.sourceRef?.frontierId === item.id);
  const effectivePrompt = prompt.trim() || frontier?.nextQuestion || `从“${node.title}”继续递归搜索证据线索。`;

  function useFrontierQuestion() {
    if (frontier?.nextQuestion) onPromptChange(frontier.nextQuestion);
  }

  return (
    <section className="node-expansion-panel recursive-search-panel">
      <div className="node-expansion-heading">
        <span>Recursive Evidence Search</span>
        <strong>{canExpand ? "用户选择 frontier" : "处理中..."}</strong>
      </div>

      <p>只从当前节点发起一轮搜索，生成 clues、frontier 和 stopped。frontier 不会自动继续展开，等你选择。</p>

      {frontier ? (
        <button className="frontier-question-button" type="button" onClick={useFrontierQuestion} disabled={!canExpand || isExpanding}>
          使用该 frontier 的下一问
        </button>
      ) : null}

      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        disabled={!canExpand || isExpanding}
        aria-label="递归证据搜索追问"
        rows={3}
      />

      <div className="recursive-controls">
        <label>
          <span>深度</span>
          <input
            type="number"
            min={1}
            max={3}
            value={depthLimit}
            onChange={(event) => onDepthLimitChange(Number(event.target.value))}
            disabled={!canExpand || isExpanding}
          />
        </label>
        <label>
          <span>预算</span>
          <input
            type="number"
            min={1}
            max={8}
            value={budgetLimit}
            onChange={(event) => onBudgetLimitChange(Number(event.target.value))}
            disabled={!canExpand || isExpanding}
          />
        </label>
      </div>

      {error ? <div className="agent-error">{error}</div> : null}

      <button
        className="expand-node-button recursive-search-button"
        onClick={() => onRecursiveSearch(effectivePrompt, depthLimit, budgetLimit)}
        disabled={!canExpand || isExpanding || effectivePrompt.trim().length === 0}
        type="button"
      >
        {isExpanding ? "正在调用真实模型..." : "从此节点递归搜索证据"}
      </button>

      {latestRun ? (
        <div className="agent-run-card recursive-run-card">
          <strong>最近一次递归搜索</strong>
          <span>{latestRun.controllerNote}</span>
          <em>线索：{latestRun.clues.length} · Frontier：{latestRun.frontier.length} · 停止：{latestRun.stopped.length}</em>
          {latestRun.canSay.length > 0 ? <em>可以说：{latestRun.canSay.join("；")}</em> : null}
          {latestRun.cannotSay.length > 0 ? <em>不能说：{latestRun.cannotSay.join("；")}</em> : null}
          <em>模型：{latestRun.model}</em>
        </div>
      ) : null}
    </section>
  );
}

function SherlockSearchPanel({
  node,
  canExpand,
  latestRun,
  isExpanding,
  error,
  onSherlockSearch,
}: {
  node: CanvasNode;
  canExpand: boolean;
  latestRun?: SherlockSearchRun;
  isExpanding: boolean;
  error: string;
  onSherlockSearch: (claim: string) => void;
}) {
  return (
    <section className="node-expansion-panel sherlock-search-panel">
      <div className="node-expansion-heading">
        <span>Sherlock 多平台溯源</span>
        <strong>{canExpand ? "并行搜索多个信源" : "处理中..."}</strong>
      </div>

      <p>
        灵感来自 sherlock-project/sherlock：维护一个平台配置 catalog，并行查询多个事实核查平台，
        自动匹配关键词并返回命中结果。
      </p>

      {error ? <div className="agent-error">{error}</div> : null}

      <button
        className={`expand-node-button sherlock-search-button ${isExpanding ? "sherlock-searching" : ""}`}
        onClick={() => onSherlockSearch(node.title)}
        disabled={!canExpand || isExpanding}
        type="button"
      >
        {isExpanding ? "正在并行搜索..." : "🔍 发起多平台溯源搜索"}
      </button>

      {latestRun ? (
        <div className="agent-run-card sherlock-run-card">
          <strong>多平台溯源结果</strong>
          <span>{latestRun.controllerNote}</span>
          <em>
            搜索平台：{latestRun.sourcesSearched} · 命中：{latestRun.sourcesMatched}
          </em>
          {latestRun.hits.length > 0 ? (
            <div className="sherlock-hit-list">
              {latestRun.hits.map((hit) => (
                <div key={hit.sourceId} className="sherlock-hit-card">
                  <div className="sherlock-hit-header">
                    <span className="sherlock-hit-icon">{hit.sourceIcon}</span>
                    <span className="sherlock-hit-name">{hit.sourceName}</span>
                    <span
                      className={`sherlock-hit-badge sherlock-hit-badge--${hit.factCheckResult ?? "unverified"}`}
                    >
                      {hit.factCheckResult === "false"
                        ? "已辟谣"
                        : hit.factCheckResult === "true"
                          ? "已核实"
                          : hit.factCheckResult === "partial"
                            ? "部分属实"
                            : "待核查"}
                    </span>
                  </div>

                  {/* 可信度进度条 */}
                  <div className="sherlock-hit-trust-wrapper">
                    <div className="sherlock-hit-trust-bar">
                      <div
                        className={`sherlock-hit-trust-fill sherlock-hit-trust-fill--${hit.trustLevel}`}
                        style={{
                          width: hit.trustLevel === "high" ? "100%" : hit.trustLevel === "medium" ? "60%" : "30%",
                        }}
                      />
                    </div>
                    <span className="sherlock-hit-trust-label">
                      可信度：{hit.trustLevel === "high" ? "高" : hit.trustLevel === "medium" ? "中" : "低"}
                    </span>
                  </div>

                  <p className="sherlock-hit-summary">{hit.summary}</p>

                  {/* 匹配关键词高亮 */}
                  {hit.matchedKeywords.length > 0 && (
                    <div className="sherlock-hit-keywords">
                      {hit.matchedKeywords.map((keyword) => (
                        <span key={keyword} className="sherlock-hit-keyword">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 搜索 URL 链接 */}
                  {hit.matchedUrl && (
                    <a
                      href={hit.matchedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sherlock-hit-link"
                    >
                      查看来源 ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="sherlock-empty-state">
              <span className="sherlock-empty-icon">🔍</span>
              <p className="sherlock-empty-title">未在已知平台上找到直接核查记录</p>
              <p className="sherlock-empty-hint">
                当前 claim 尚未被主流事实核查平台收录。您可以尝试：
              </p>
              <ul className="sherlock-empty-suggestions">
                <li>使用"联网搜索"寻找更多候选材料</li>
                <li>使用"递归搜索"深入追踪证据线索</li>
                <li>稍后再次尝试，平台数据可能已更新</li>
              </ul>
            </div>
          )}
          {latestRun.canSay.length > 0 ? <em>可以说：{latestRun.canSay.join("；")}</em> : null}
          {latestRun.cannotSay.length > 0 ? <em>不能说：{latestRun.cannotSay.join("；")}</em> : null}
        </div>
      ) : null}
    </section>
  );
}

function Search360Panel({
  node,
  canExpand,
  isExpanding,
  error,
  on360Search,
}: {
  node: CanvasNode;
  canExpand: boolean;
  isExpanding: boolean;
  error: string;
  on360Search: (query: string) => void;
}) {
  return (
    <section className="node-expansion-panel search360-panel">
      <div className="node-expansion-heading">
        <span>360 AI Search</span>
        <strong>{canExpand ? "实时搜索增强" : "处理中..."}</strong>
      </div>
      <p>
        调用 360 AI Search 获取摘要、可复核来源和相关追问，并把结果回写到画布节点。
      </p>
      {error ? <div className="agent-error">{error}</div> : null}
      <button
        className={`expand-node-button search360-button ${isExpanding ? "search360-running" : ""}`}
        onClick={() => on360Search(node.title)}
        disabled={!canExpand || isExpanding}
        type="button"
      >
        {isExpanding ? "正在搜索..." : "调用 360 AI Search"}
      </button>
    </section>
  );
}

const expansionModes: Array<{ mode: ExpansionMode; label: string }> = [
  { mode: "evidence_audit", label: "证据审计" },
  { mode: "search", label: "联网搜索" },
  { mode: "counter", label: "反证生成" },
  { mode: "rewrite", label: "局部改写" },
];

function statusText(status: CanvasNode["status"]) {
  const labels: Record<NonNullable<CanvasNode["status"]>, string> = {
    risk: "高风险",
    active: "正在展开",
    supported: "局部支持",
    limited: "有限支持",
    blocked: "推理阻断",
    rewrite: "已降强度",
    clue: "证据线索",
    frontier: "等待选择",
    stopped: "停止扩展",
    controller: "中控调度",
    handoff: "Handoff",
  };

  return status ? labels[status] : "正在展开";
}

function clueRoleLabel(role?: string) {
  const labels: Record<string, string> = {
    support: "支持线索",
    limit: "限制线索",
    counter: "反证线索",
    context: "背景线索",
    lead: "待追踪线索",
  };
  return role ? labels[role] ?? role : "待追踪线索";
}

function confidenceLabel(confidence?: string) {
  const labels: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
  };
  return confidence ? labels[confidence] ?? confidence : "中";
}

function stoppedReasonLabel(reason?: string) {
  const labels: Record<string, string> = {
    duplicate: "已存在或重复线索",
    budget: "达到本轮预算",
    low_confidence: "可信度不足",
    out_of_scope: "超出当前节点范围",
  };
  return reason ? labels[reason] ?? reason : "停止扩展";
}
