/**
 * TodoList — investigation checklist for MissionProcessShell.
 *
 * Items and status come from MissionShellModel (SSE-derived), not a demo timer.
 * Presentation only: collapse, roll count, active shimmer.
 */
import { useEffect, useRef, useState } from "react";
import type { MissionShellModel, ShellNodeStatus } from "../../../../lib/missionShell";
import { isSearchShellTool } from "./WebSearch";
import styles from "./TodoList.module.css";

export type TodoStatus = "pending" | "active" | "done" | "error";

export interface TodoItem {
  id: string;
  label: string;
  status: TodoStatus;
}

export interface TodoListProps {
  items: TodoItem[];
  title?: string;
  defaultCollapsed?: boolean;
  className?: string;
}

const cls = (base: string, on?: boolean) => base + (on ? " " + styles.on : "");

const CheckIcon = ({ on }: { on?: boolean }) => (
  <svg className={cls(styles.todoIcon, on)} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const ArrowIcon = ({ on }: { on?: boolean }) => (
  <svg
    className={cls(styles.todoIcon + " " + styles.strong, on)}
    viewBox="0 0 24 24"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <path
      d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const DashedIcon = ({ on }: { on?: boolean }) => (
  <svg className={cls(styles.todoIcon, on)} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeDasharray="1.8 3.6"
      strokeLinecap="round"
    />
  </svg>
);

const RollDigit = ({ char }: { char: string }) => {
  const prev = useRef(char);
  const [roll, setRoll] = useState<{ from: string; to: string } | null>(null);
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (char === prev.current) return;
    const from = prev.current;
    prev.current = char;
    setRoll({ from, to: char });
    setUp(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
    const done = setTimeout(() => setRoll(null), 380);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [char]);
  if (!roll) return <span className={styles.rollDigit}>{char}</span>;
  return (
    <span className={styles.rollDigit}>
      <span className={cls(styles.rollInner, up)}>
        <span>{roll.from}</span>
        <span>{roll.to}</span>
      </span>
    </span>
  );
};

const RollingCount = ({ value }: { value: string }) => (
  <span className={styles.rollCount} aria-label={value}>
    {value.split("").map((c, i) => (
      <RollDigit key={`${i}-${c}`} char={c} />
    ))}
  </span>
);

const FilledCheckIcon = () => (
  <svg className={styles.todoHeadCheck} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
      fill="currentColor"
    />
  </svg>
);

function agentStatus(model: MissionShellModel, agentId: string): ShellNodeStatus | undefined {
  return model.agents.find((a) => a.agentId === agentId)?.status;
}

function thoughtStatus(model: MissionShellModel, pred: (t: MissionShellModel["thoughtItems"][number]) => boolean): ShellNodeStatus | undefined {
  const hits = model.thoughtItems.filter(pred);
  if (hits.length === 0) return undefined;
  if (hits.some((t) => t.status === "error")) return "error";
  if (hits.some((t) => t.status === "loading")) return "loading";
  if (hits.every((t) => t.status === "success")) return "success";
  return hits[hits.length - 1]?.status;
}

function shellToTodo(status: ShellNodeStatus | undefined, opts?: { forceActive?: boolean }): TodoStatus {
  if (status === "error") return "error";
  if (status === "success") return "done";
  if (status === "loading" || opts?.forceActive) return "active";
  return "pending";
}

/**
 * Fixed product checklist mapped onto stream/shell state.
 * Order matches the user-facing investigation path (not raw agent spawn order).
 */
export function buildInvestigationTodos(model: MissionShellModel): TodoItem[] {
  const planner = thoughtStatus(model, (t) => t.kind === "planner" || t.key === "planner");
  const hasUnderstanding = Boolean(model.understanding?.atoms?.length);
  const triageAgent = agentStatus(model, "rumor_detector");
  const triageThought = thoughtStatus(
    model,
    (t) => t.agentId === "rumor_detector" || t.key === "agent:rumor_detector" || t.key === "action:rumor_detector"
  );
  const triage: ShellNodeStatus | undefined =
    hasUnderstanding && triageAgent !== "loading"
      ? triageAgent === "error" || triageThought === "error"
        ? "error"
        : "success"
      : triageAgent || triageThought;

  const searchTools = model.tools.filter((t) => isSearchShellTool(t));
  const searchThought = thoughtStatus(
    model,
    (t) =>
      t.kind === "tool" &&
      /search|360|anysearch|metaso|tavily|exa|parallel|检索|公开材料/i.test(
        `${t.toolId ?? ""} ${t.title}`
      )
  );
  let search: ShellNodeStatus | undefined = searchThought;
  if (searchTools.length > 0) {
    if (searchTools.some((t) => t.status === "error")) search = "error";
    else if (searchTools.some((t) => t.status === "loading")) search = "loading";
    else if (searchTools.every((t) => t.status === "success")) search = "success";
  }

  const fact = agentStatus(model, "fact_checker");
  const source = agentStatus(model, "source_validator");
  const reportAgent = agentStatus(model, "report_composer");
  const review = thoughtStatus(model, (t) => t.kind === "review" || t.key.includes("report_reviewer"));
  const hasVerdict = model.verdict.present && !model.live;
  const report: ShellNodeStatus | undefined = hasVerdict
    ? model.verdict.reviewPassed === false
      ? "error"
      : "success"
    : review === "loading"
      ? "loading"
      : reportAgent;

  // When stream is live and nothing is loading yet, first incomplete step is active.
  const raw: Array<{ id: string; label: string; status: ShellNodeStatus | undefined }> = [
    { id: "plan", label: "确认核查问题", status: planner },
    { id: "triage", label: "拆成可核对要点", status: triage },
    { id: "search", label: "检索公开材料", status: search },
    { id: "fact", label: "对照公开事实", status: fact },
    { id: "source", label: "评估来源可信度", status: source },
    { id: "report", label: "整理结论", status: report },
  ];

  // Promote first non-done item to active when model is live (stream progressing).
  let sawActive = false;
  const items: TodoItem[] = raw.map((row) => {
    let st = shellToTodo(row.status);
    if (st === "error" || st === "done") return { id: row.id, label: row.label, status: st };
    if (model.live && !sawActive && st === "pending") {
      // Only auto-activate when something has started (not a blank empty model).
      const anyProgress = raw.some((r) => r.status === "loading" || r.status === "success" || r.status === "error");
      if (anyProgress || model.thoughtItems.length > 0 || model.tools.length > 0 || model.agents.length > 0) {
        // Prefer real loading; else first pending becomes the current work.
        if (row.status === "loading") {
          sawActive = true;
          return { id: row.id, label: row.label, status: "active" };
        }
        if (!raw.some((r) => r.status === "loading")) {
          sawActive = true;
          return { id: row.id, label: row.label, status: "active" };
        }
      }
    }
    if (st === "active") sawActive = true;
    return { id: row.id, label: row.label, status: st };
  });

  // If live and a later step is loading, ensure earlier incomplete stay pending not active.
  const loadingIdx = raw.findIndex((r) => r.status === "loading");
  if (loadingIdx >= 0) {
    return items.map((item, i) => {
      if (i < loadingIdx && item.status === "active") return { ...item, status: "pending" };
      if (i === loadingIdx) return { ...item, status: "active" };
      if (i > loadingIdx && item.status === "active") return { ...item, status: "pending" };
      return item;
    });
  }

  return items;
}

export function TodoList({
  items,
  title = "核查计划",
  defaultCollapsed = false,
  className,
}: TodoListProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const n = items.length;
  if (n === 0) return null;

  const doneCount = items.filter((i) => i.status === "done").length;
  const allDone = items.every((i) => i.status === "done");
  const hasError = items.some((i) => i.status === "error");
  const running = !allDone && items.some((i) => i.status === "active" || i.status === "pending");
  const started = items.some((i) => i.status !== "pending");
  const pct = Math.round((doneCount / n) * 100);
  const countValue = `${Math.min(doneCount, n)}/${n}`;

  return (
    <div
      className={[styles.todo, className].filter(Boolean).join(" ")}
      data-testid="investigation-todos"
      data-state={allDone ? "done" : hasError ? "error" : running ? "running" : "idle"}
    >
      <button
        type="button"
        className={styles.todoHead}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开核查计划" : "收起核查计划"}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className={styles.todoHeadIcon}>
          {allDone ? (
            <FilledCheckIcon />
          ) : started && running ? (
            <span
              className={styles.todoHeadPie}
              style={{ ["--todo-pie" as string]: pct + "%" }}
              aria-hidden="true"
            >
              <svg className={styles.todoHeadPieRing} viewBox="0 0 24 24">
                <circle
                  cx="12"
                  cy="12"
                  r="10.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeDasharray="2.2 4.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          ) : (
            <svg className={styles.todoListIcon} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <svg className={styles.todoChevron} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className={styles.todoTitle}>{title}</span>
        <span className={styles.todoCount}>
          <RollingCount value={countValue} />
        </span>
      </button>

      <div className={styles.todoCollapsible + (collapsed ? " " + styles.isCollapsed : "")}>
        <div className={styles.todoInner}>
          <ul className={styles.todoList}>
            {items.map((item, i) => {
              const done = item.status === "done";
              const active = item.status === "active";
              const error = item.status === "error";
              return (
                <li
                  key={item.id}
                  className={
                    styles.todoItem +
                    (done ? " " + styles.done : active ? " " + styles.active : error ? " " + styles.error : "")
                  }
                  style={{ ["--i" as string]: i }}
                  data-status={item.status}
                >
                  <span className={styles.todoIconWrap}>
                    <DashedIcon on={!done && !active && !error} />
                    <ArrowIcon on={active || error} />
                    <CheckIcon on={done} />
                  </span>
                  <span className={styles.todoLabel} data-label={item.label}>
                    {item.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
