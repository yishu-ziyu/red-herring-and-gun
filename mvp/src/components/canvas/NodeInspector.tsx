import type { CanvasNode } from "../../data/reasoningCanvas";
import type { ExpansionMode } from "../../lib/agentExpansion";
import type { CandidateMaterial, DemoCase, FinalReport, GradedEvidence } from "../../lib/schemas";
import type { AgentRun } from "./ReasoningWorkspace";

interface NodeInspectorProps {
  node: CanvasNode;
  caseData: DemoCase;
  gradedEvidence: GradedEvidence[];
  report: FinalReport;
  canExpand: boolean;
  expansionPrompt: string;
  expansionMode: ExpansionMode;
  latestRun?: AgentRun;
  isExpanding: boolean;
  agentError: string;
  onExpansionPromptChange: (value: string) => void;
  onExpansionModeChange: (mode: ExpansionMode) => void;
  onExpandNode: () => void;
}

export function NodeInspector({
  node,
  caseData,
  gradedEvidence,
  report,
  canExpand,
  expansionPrompt,
  expansionMode,
  latestRun,
  isExpanding,
  agentError,
  onExpansionPromptChange,
  onExpansionModeChange,
  onExpandNode,
}: NodeInspectorProps) {
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

  return (
    <aside className="node-inspector" aria-label="Node inspector">
      <div className="panel-heading">
        <span>Context Inspector</span>
        <strong>{node.type.replace("_", " ")}</strong>
      </div>
      <div className={`inspector-status status-${node.status ?? "active"}`}>{statusText(node.status)}</div>
      <h2>{node.title}</h2>
      {node.subtitle ? <p className="inspector-subtitle">{node.subtitle}</p> : null}
      {renderBody(node, caseData, report, subclaim, route, candidate, grade)}
      <NodeExpansionPanel
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
    </aside>
  );
}

function renderBody(
  node: CanvasNode,
  caseData: DemoCase,
  report: FinalReport,
  subclaim?: DemoCase["subclaims"][number],
  route?: DemoCase["routes"][number],
  candidate?: CandidateMaterial,
  grade?: GradedEvidence,
) {
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
            items={["当前证据不能支持“AI 导致岗位减少”，只能支持“AI 可能是影响因素之一”。"]}
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

  if (node.type === "inference_license") {
    return (
      <div className="inspector-stack">
        <InfoBlock title="当前证据允许的结论" items={[report.allowedConclusion]} tone="supported" />
        <InfoBlock title="禁止的推断" items={report.doNotInfer} tone="blocked" />
        <InfoBlock
          title="为什么降级"
          items={["当前材料缺少 AI 采用时间、替代解释处理和反事实证据，因此不能把同期变化写成“AI 导致”。"]}
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

function NodeExpansionPanel({
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
  canExpand: boolean;
  prompt: string;
  mode: ExpansionMode;
  latestRun?: AgentRun;
  isExpanding: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onModeChange: (mode: ExpansionMode) => void;
  onExpand: () => void;
}) {
  return (
    <section className="node-expansion-panel">
      <div className="node-expansion-heading">
        <span>Node-triggered Agent</span>
        <strong>{canExpand ? "等待用户选择" : "三层后启用"}</strong>
      </div>
      <p>
        中控 LLM 不自动替你走完整张图。你在某个节点上追问时，它才调度对应子 Agent，把新增分支接回画布。
      </p>
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
      <button className="expand-node-button" onClick={onExpand} disabled={!canExpand || isExpanding || prompt.trim().length === 0} type="button">
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
  };

  return status ? labels[status] : "正在展开";
}
