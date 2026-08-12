/**
 * MissionProcessShell — single narrative process stream (token renderer).
 *
 * No inner claim/phase/live chrome. No top-level ToolStrip or AgentCluster.
 * Tools nest under steps; agents are actor attribution. Shared narrative model
 * via buildVisibleProcessRows.
 *
 * antdx variant is frozen: product always renders the token narrative path.
 * MissionProcessShellAntd.tsx is kept on disk but not loaded here.
 */
import { useMemo, useState } from "react";
import type { MissionShellModel, ShellToolItem } from "../../../../lib/missionShell";
import {
  buildVisibleProcessRows,
  formatReviewIssue,
  humanizeVerdictType,
  type VisibleProcessNarrative,
  type VisibleProcessRow,
} from "../../../../lib/missionShell";
import { humanizeClaimType } from "../../../../lib/missionShell/labels";
import { ThinkingReasoning } from "./ThinkingReasoning";
import { buildInvestigationTodos, TodoList } from "./TodoList";
import { isSearchShellTool, sitesFromSearchResult, WebSearch } from "./WebSearch";

export type MissionProcessShellVariant = "token" | "antdx";

export interface MissionProcessShellProps {
  model: MissionShellModel;
  /** @deprecated filtering via agent chips removed; kept for call-site compat */
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onSelectTool?: (toolKey: string) => void;
  className?: string;
  /** antdx is frozen — always token narrative */
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

/**
 * 一级可见的理解卡：让用户先看到「系统把你的话读成了哪几条可核查命题」。
 * 这是透明性的真正落点——先确认系统有没有理解错，再看它怎么查、怎么判。
 * 无 understanding 时不渲染（不编造）。
 */
function UnderstandingBlock({ model }: { model: MissionShellModel }) {
  const u = model.understanding;
  if (!u || !u.atoms || u.atoms.length === 0) return null;
  return (
    <div className="mps-understand" role="region" aria-label="系统如何理解这句话">
      <div className="mps-understand-head">
        <span className="mps-understand-label">系统把你的话读成了这几条</span>
      </div>
      <p className="mps-understand-claim">{u.claim}</p>
      <ul className="mps-understand-list">
        {u.atoms.map((atom, index) => {
          const typeZh = humanizeClaimType(atom.type);
          return (
            <li key={`${index}-${atom.text.slice(0, 16)}`} className="mps-understand-atom">
              <span className="mps-understand-num">{index + 1}</span>
              <span className="mps-understand-text">{atom.text}</span>
              <span className="mps-understand-meta">
                {atom.verifiable ? (
                  <span className="mps-understand-tag mps-understand-tag--ok">可核查</span>
                ) : (
                  <span className="mps-understand-tag mps-understand-tag--stance">立场型</span>
                )}
                {typeZh ? <span className="mps-understand-type">{typeZh}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 真实推理揭示：ThinkingReasoning。
 * - 句子只来自 agent_thought，绝不编造。
 * - loading 且有 actor → 即使尚无句子也显示「整理推理…」
 * - done 且无句子 → 不渲染。
 * - 耗时用后端 latency / stream 时间戳，与模型真实推理时长一致。
 */
function ReasoningReveal({
  reasoning,
  elapsedMs,
  status,
  hasActor,
}: {
  reasoning?: string[];
  elapsedMs?: number;
  status: VisibleProcessRow["status"];
  hasActor?: boolean;
}) {
  const thinking = status === "loading";
  const sentences = reasoning ?? [];
  if (!thinking && sentences.length === 0) return null;
  if (thinking && !hasActor && sentences.length === 0) return null;
  return (
    <ThinkingReasoning
      sentences={sentences}
      thinking={thinking}
      elapsedMs={elapsedMs}
    />
  );
}

function resolveTool(
  tools: ShellToolItem[],
  toolKey?: string
): ShellToolItem | undefined {
  if (!toolKey) return undefined;
  return tools.find((t) => t.key === toolKey);
}

function ProcessRowView({
  row,
  tools,
  live,
  onSelectTool,
}: {
  row: VisibleProcessRow;
  tools: ShellToolItem[];
  live: boolean;
  onSelectTool?: (toolKey: string) => void;
}) {
  const searchBlocks: Array<{ key: string; tool: ShellToolItem }> = [];
  const chipActs: VisibleProcessRow["activities"] = [];
  for (const act of row.activities) {
    const tool = resolveTool(tools, act.toolKey || act.key);
    if (tool && isSearchShellTool(tool)) {
      searchBlocks.push({ key: act.key, tool });
    } else {
      chipActs.push(act);
    }
  }

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
        {searchBlocks.length > 0 ? (
          <div className="mps-search-blocks" aria-label="联网检索">
            {searchBlocks.map(({ key, tool }) => (
              <WebSearch
                key={key}
                query={tool.query || tool.detail || tool.title}
                sites={sitesFromSearchResult(tool.result)}
                status={tool.status}
                instantDone={!live && tool.status === "success"}
              />
            ))}
          </div>
        ) : null}
        {chipActs.length > 0 ? (
          <ul className="mps-activities mps-activities--chips" aria-label="步骤活动">
            {chipActs.map((act) => (
              <li
                key={act.key}
                className={`mps-activity mps-activity-chip mps-activity--${act.status}`}
              >
                {onSelectTool && act.toolKey ? (
                  <button
                    type="button"
                    className="mps-activity-btn mps-activity-chip-btn"
                    onClick={() => onSelectTool(act.toolKey!)}
                    title={act.detail || act.title}
                  >
                    <span className="mps-activity-title">{act.title}</span>
                  </button>
                ) : (
                  <span
                    className="mps-activity-static mps-activity-chip-static"
                    title={act.detail || act.title}
                  >
                    <span className="mps-activity-title">{act.title}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {row.nextHint ? <div className="mps-step-next">下一步：{row.nextHint}</div> : null}
        <ReasoningReveal
          reasoning={row.reasoning}
          elapsedMs={row.reasoningElapsedMs}
          status={row.status}
          hasActor={Boolean(row.actor)}
        />
      </div>
    </li>
  );
}

function NarrativeStream({
  narrative,
  tools,
  live,
  onSelectTool,
  forceExpandAll,
}: {
  narrative: VisibleProcessNarrative;
  tools: ShellToolItem[];
  live: boolean;
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
        <ProcessRowView
          key={row.key}
          row={row}
          tools={tools}
          live={live}
          onSelectTool={onSelectTool}
        />
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
      <div className="mps-verdict-label">结论</div>
      <div className="mps-verdict-badges">
        <div className="mps-verdict-type">{humanizeVerdictType(model.verdict.verdictType)}</div>
        {typeof model.verdict.credibilityScore === "number" ? (
          <div className="mps-verdict-score">可信度 {model.verdict.credibilityScore}</div>
        ) : null}
      </div>
      {model.verdict.conclusion ? <p className="mps-verdict-text">{model.verdict.conclusion}</p> : null}
      {model.verdict.shareAdvice ? (
        <div className="mps-share-advice" aria-label="能不能信">
          <span className="mps-share-advice-label">能不能信</span>
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
  // antdx frozen: always token narrative (MissionProcessShellAntd not loaded in product)
  void variant;
  const narrative = useMemo(() => buildVisibleProcessRows(model), [model]);
  const todos = useMemo(() => buildInvestigationTodos(model), [model]);
  const [expandAll, setExpandAll] = useState(false);

  const foldProcess =
    narrative.mode === "complete" || narrative.mode === "deferred";
  const showCollapseToggle =
    narrative.collapsedCount > 0 && !expandAll && !foldProcess;
  const showTodos =
    todos.length > 0 &&
    (model.thoughtItems.length > 0 ||
      model.tools.length > 0 ||
      model.agents.length > 0 ||
      model.verdict.present ||
      Boolean(model.errorMessage));

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

      {/* Stream-derived checklist — same agent/tool truth as the narrative below */}
      {showTodos ? (
        <TodoList
          items={todos}
          title="核查计划"
          defaultCollapsed={foldProcess}
        />
      ) : null}

      {/* 一级理解卡：先看系统把你的话读成了哪几条，再回看过程 */}
      <UnderstandingBlock model={model} />

      {foldProcess ? (
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

      {(!foldProcess || expandAll) && (
        <>
          {showCollapseToggle ? (
            <button type="button" className="mps-expand-collapsed" onClick={() => setExpandAll(true)}>
              已完成 {narrative.collapsedCount} 步 · 展开
            </button>
          ) : null}
          <NarrativeStream
            narrative={narrative}
            tools={model.tools}
            live={model.live}
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
