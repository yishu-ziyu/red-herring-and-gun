/**
 * MissionProcessShell — single narrative process stream (token renderer).
 *
 * No inner claim/phase/live chrome. No top-level ToolStrip or AgentCluster.
 * Tools nest under steps; agents are actor attribution. Shared narrative model
 * via buildVisibleProcessRows.
 *
 * antdx variant is frozen: product always renders the token narrative path.
 */
import { useMemo, useState } from "react";
import type { MissionShellModel, ShellToolItem } from "../../../../lib/missionShell";
import {
  buildVisibleProcessRows,
  flattenRowToBlocks,
  formatReviewIssue,
  humanizeVerdictType,
  type InstrumentBlock,
  type InstrumentVariant,
  type VisibleProcessNarrative,
  type VisibleProcessRow,
} from "../../../../lib/missionShell";
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
  selectedRowKey?: string | null;
  onSelectRow?: (rowKey: string) => void;
  className?: string;
  /** antdx is frozen — always token narrative */
  variant?: MissionProcessShellVariant;
  /** When true, claim is already shown by parent — shell never re-prints it */
  claimInParent?: boolean;
  /** Left speech only. Atoms / sources / verdict live on MissionWorkSurface. */
  deskMode?: boolean;
}

const GLYPH_MAP: Record<InstrumentVariant, number[]> = {
  search: [0, 1, 0, 1, 0, 1, 0, 1, 0],
  memory: [1, 1, 1, 1, 0, 1, 1, 1, 1],
  think: [0, 1, 0, 1, 1, 1, 0, 1, 0],
  work: [1, 0, 1, 0, 1, 0, 1, 0, 1],
};

function NothingGlyph({ variant, live }: { variant: InstrumentVariant; live?: boolean }) {
  return (
    <span className={`mps-glyph${live ? " mps-glyph--live" : ""}`} data-variant={variant} aria-hidden>
      {GLYPH_MAP[variant].map((on, i) => (
        <i key={i} className={on ? "is-on" : undefined} />
      ))}
    </span>
  );
}

function InstrumentChevron() {
  return (
    <svg className="mps-inst-chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden>
      <path
        d="m9 6 6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 真实推理揭示：ThinkingReasoning。
 * - 句子只来自 agent_thought，绝不编造。
 * - loading 且有 actor → 即使尚无句子也显示「思考中」
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

function instrumentTitle(block: InstrumentBlock, tools: ShellToolItem[]): string {
  const tool = resolveTool(tools, block.toolKey);
  if (tool && isSearchShellTool(tool)) {
    const q = (tool.query || tool.detail || "").trim();
    return q ? `检索「${q}」` : block.title;
  }
  return block.title;
}

function hideSummary(row: VisibleProcessRow, deskMode: boolean): boolean {
  if (!row.summary) return true;
  if (row.isCurrent && row.status === "loading") return true;
  if (deskMode && /事实判定|信源：|置信/.test(row.summary)) return true;
  return false;
}

function InstrumentCard({
  block,
  tools,
  live,
  deskMode,
  thoughtStatus,
  onSelectTool,
  onSelectRow,
}: {
  block: InstrumentBlock;
  tools: ShellToolItem[];
  live: boolean;
  deskMode: boolean;
  thoughtStatus: VisibleProcessRow["status"];
  onSelectTool?: (toolKey: string) => void;
  onSelectRow?: (rowKey: string) => void;
}) {
  const tool = resolveTool(tools, block.toolKey);
  const title = instrumentTitle(block, tools);
  const searchable = Boolean(tool && isSearchShellTool(tool) && !deskMode);
  const clickable = Boolean((onSelectTool && block.toolKey) || onSelectRow);
  const showChevron = block.status !== "loading";

  const activate = () => {
    onSelectRow?.(block.rowKey);
    if (block.toolKey) onSelectTool?.(block.toolKey);
  };

  if (block.variant === "think") {
    return (
      <li
        className={`mps-inst mps-inst--think mps-activity mps-activity--${block.status}`}
        data-variant="think"
      >
        <div className="mps-inst-think">
          <NothingGlyph variant="think" live={thoughtStatus === "loading"} />
          <ReasoningReveal
            reasoning={block.reasoning}
            elapsedMs={block.reasoningElapsedMs}
            status={thoughtStatus}
            hasActor
          />
        </div>
      </li>
    );
  }

  const head = (
    <>
      <NothingGlyph variant={block.variant} live={block.status === "loading"} />
      <span className="mps-inst-copy">
        <span className="mps-activity-title mps-inst-title">{title}</span>
        {block.detail && block.variant !== "search" ? (
          <span className="mps-inst-detail">{block.detail}</span>
        ) : null}
      </span>
      {showChevron ? <InstrumentChevron /> : <span className="mps-inst-live" aria-hidden />}
    </>
  );

  return (
    <li
      className={`mps-inst mps-activity mps-activity--${block.status}`}
      data-variant={block.variant}
    >
      {clickable ? (
        <button
          type="button"
          className="mps-inst-head mps-activity-btn"
          onClick={activate}
          title={block.detail || title}
        >
          {head}
        </button>
      ) : (
        <div className="mps-inst-head mps-activity-static" title={block.detail || title}>
          {head}
        </div>
      )}
      {block.hostsReasoning ? (
        <div className="mps-inst-child">
          <span className="mps-inst-child-rail" aria-hidden />
          <ReasoningReveal
            reasoning={block.reasoning}
            elapsedMs={block.reasoningElapsedMs}
            status={thoughtStatus}
            hasActor
          />
        </div>
      ) : null}
      {searchable && tool ? (
        <div className="mps-search-blocks" aria-label="联网检索">
          <WebSearch
            query={tool.query || tool.detail || tool.title}
            sites={sitesFromSearchResult(tool.result)}
            status={tool.status}
            instantDone={!live && tool.status === "success"}
          />
        </div>
      ) : null}
    </li>
  );
}

function ProcessRowView({
  row,
  tools,
  live,
  onSelectTool,
  deskMode,
  selected,
  onSelectRow,
}: {
  row: VisibleProcessRow;
  tools: ShellToolItem[];
  live: boolean;
  onSelectTool?: (toolKey: string) => void;
  deskMode: boolean;
  selected: boolean;
  onSelectRow?: (rowKey: string) => void;
}) {
  const blocks = flattenRowToBlocks(row);
  const speech = blocks.find((b) => b.kind === "speech");
  const instruments = blocks.filter((b) => b.kind === "instrument");
  const more = speech && speech.kind === "speech" && !hideSummary(row, deskMode) ? speech.more : undefined;

  return (
    <li
      className={`mps-step mps-beat mps-step--${row.status} mps-step--${row.kind}${
        row.isCurrent ? " mps-step--current" : ""
      }${selected ? " mps-step--selected" : ""}`}
      aria-current={row.isCurrent ? "step" : undefined}
      data-row-key={row.key}
    >
      {speech && speech.kind === "speech" ? (
        <div className="mps-speech">
          {deskMode && onSelectRow ? (
            <button
              type="button"
              className="mps-step-title mps-step-title-btn mps-speech-text"
              onClick={() => onSelectRow(row.key)}
              aria-pressed={selected}
            >
              {speech.text}
            </button>
          ) : (
            <div className="mps-step-title mps-speech-text">{speech.text}</div>
          )}
          {more ? <p className="mps-step-desc mps-speech-more">{more}</p> : null}
        </div>
      ) : null}

      {instruments.length > 0 ? (
        <ul className="mps-instruments mps-activities" aria-label="步骤活动">
          {instruments.map((block) =>
            block.kind === "instrument" ? (
              <InstrumentCard
                key={block.key}
                block={block}
                tools={tools}
                live={live}
                deskMode={deskMode}
                thoughtStatus={row.status}
                onSelectTool={onSelectTool}
                onSelectRow={onSelectRow}
              />
            ) : null
          )}
        </ul>
      ) : null}

      {row.nextHint && !deskMode ? <div className="mps-step-next">下一步：{row.nextHint}</div> : null}
    </li>
  );
}

function NarrativeStream({
  narrative,
  tools,
  live,
  onSelectTool,
  forceExpandAll,
  deskMode,
  selectedRowKey,
  onSelectRow,
}: {
  narrative: VisibleProcessNarrative;
  tools: ShellToolItem[];
  live: boolean;
  onSelectTool?: (toolKey: string) => void;
  forceExpandAll: boolean;
  deskMode: boolean;
  selectedRowKey?: string | null;
  onSelectRow?: (rowKey: string) => void;
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
          deskMode={deskMode}
          selected={selectedRowKey === row.key}
          onSelectRow={onSelectRow}
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
  deskMode = false,
  selectedRowKey = null,
  onSelectRow,
}: MissionProcessShellProps) {
  void variant;
  const narrative = useMemo(() => buildVisibleProcessRows(model), [model]);
  const todos = useMemo(() => buildInvestigationTodos(model), [model]);
  const [expandAll, setExpandAll] = useState(false);

  const foldProcess =
    !deskMode && (narrative.mode === "complete" || narrative.mode === "deferred");
  const showCollapseToggle =
    narrative.collapsedCount > 0 && !expandAll && !foldProcess;
  const showTodos =
    !deskMode &&
    !model.live &&
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
      data-desk={deskMode ? "1" : "0"}
    >
      {/* No inner claim / phase / live pill — parent Mission Control owns those */}

      {!deskMode && (narrative.showVerdict || narrative.deferredReview) ? (
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
            forceExpandAll={expandAll || narrative.mode === "error" || deskMode}
            deskMode={deskMode}
            selectedRowKey={selectedRowKey}
            onSelectRow={onSelectRow}
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
