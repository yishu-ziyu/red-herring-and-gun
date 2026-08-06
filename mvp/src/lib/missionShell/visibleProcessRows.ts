/**
 * visibleProcessRows — pure narrative selector over MissionShellModel.
 *
 * Pipeline events are not UI rows. Tools nest as activities; agents attach as
 * actor attribution on semantic action milestones (never primary kind=agent).
 */

import type {
  MissionShellModel,
  ShellNodeStatus,
  ShellThoughtItem,
  ShellToolItem,
} from "./types";

export type ProcessRowKind =
  | "milestone"
  | "debate"
  | "review"
  | "report"
  | "error";

export interface ProcessActivity {
  key: string;
  title: string;
  detail?: string;
  status: ShellNodeStatus;
  toolKey?: string;
}

export interface VisibleProcessRow {
  key: string;
  title: string;
  summary?: string;
  status: ShellNodeStatus;
  kind: ProcessRowKind;
  actor?: { agentId: string; name: string };
  activities: ProcessActivity[];
  isCurrent: boolean;
  /** false → hidden behind "已完成 N 步 · 展开" */
  expanded: boolean;
  nextHint?: string;
}

export type NarrativeMode = "running" | "complete" | "error" | "deferred";

export interface VisibleProcessNarrative {
  rows: VisibleProcessRow[];
  collapsedCount: number;
  currentKey: string | null;
  mode: NarrativeMode;
  /** Formal verdict card only when complete and review not failed */
  showVerdict: boolean;
  deferredReview: boolean;
  errorMessage?: string;
  /** Parent chrome only — shell must not re-render these */
  claim: string;
  phaseLabel: string;
  live: boolean;
}

const BANNED_PRIMARY =
  /中控|派发|可行动线索|编排|handoff|relay|tool\s*result/i;

/** Semantic action title for an agent id — never the role label alone as primary. */
const AGENT_ACTION_TITLE: Record<string, string> = {
  rumor_detector: "确认核查切入点",
  fact_checker: "对照公开事实",
  source_validator: "评估材料可信度",
  report_composer: "整理初步结论",
  alternative_explanation_searcher: "寻找替代解释",
  counter_evidence_grader: "评估反证强度",
};

/** Role display name (actor attribution only). */
const AGENT_ROLE_NAME: Record<string, string> = {
  rumor_detector: "立案分诊",
  fact_checker: "事实核查",
  source_validator: "信源审计",
  report_composer: "报告收束",
  alternative_explanation_searcher: "替代解释",
  counter_evidence_grader: "反证评分",
};

/** User-facing step title (never orchestrator voice). */
export function humanizeProcessTitle(raw?: string | null): string {
  const t = (raw ?? "").trim();
  if (!t) return "核查步骤";
  if (/先派发|可行动线索/.test(t)) return "确定核查切入点";
  if (/中控/.test(t)) return t.replace(/中控/g, "系统").replace(/已经判定命题类型[，,]?/, "已识别命题类型，");
  if (/理解命题与路径/.test(t)) return "确认核查问题";
  if (/Agent\s*冲突|冲突调解室/.test(t)) return "冲突调解";
  if (BANNED_PRIMARY.test(t)) {
    return t
      .replace(/中控/g, "")
      .replace(/派发/g, "")
      .replace(/可行动线索/g, "核查方向")
      .replace(/handoff|relay|tool\s*result/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || "核查步骤";
  }
  return t;
}

export function humanizeProcessSummary(raw?: string | null): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let s = raw.trim();
  if (s === "进行中") return undefined;
  s = s
    .replace(/中控已经判定命题类型[，,]?\s*/g, "")
    .replace(/中控/g, "")
    .replace(/先让分诊\s*Agent\s*/g, "先做立案分诊，")
    .replace(/可行动线索/g, "核查方向")
    .replace(/派发/g, "")
    .trim();
  if (!s || BANNED_PRIMARY.test(s)) {
    s = s
      .replace(/handoff|relay|tool\s*result/gi, "")
      .replace(/编排/g, "")
      .trim();
  }
  return s || undefined;
}

export function semanticActionTitleForAgent(agentId?: string, fallbackTitle?: string): string {
  if (agentId && AGENT_ACTION_TITLE[agentId]) return AGENT_ACTION_TITLE[agentId];
  // If fallback is a known role label, map to generic action — never use role as step title.
  const raw = (fallbackTitle ?? "").trim();
  for (const [id, role] of Object.entries(AGENT_ROLE_NAME)) {
    if (raw === role || raw === id) return AGENT_ACTION_TITLE[id] || "推进核查";
  }
  if (/立案分诊|RumorDetector/i.test(raw)) return AGENT_ACTION_TITLE.rumor_detector;
  if (/事实核查|FactChecker/i.test(raw)) return AGENT_ACTION_TITLE.fact_checker;
  if (/信源|SourceValidator/i.test(raw)) return AGENT_ACTION_TITLE.source_validator;
  if (/报告|ReportComposer/i.test(raw)) return AGENT_ACTION_TITLE.report_composer;
  return humanizeProcessTitle(raw) || "推进核查";
}

export function roleNameForAgent(agentId?: string, fallback?: string): string {
  if (agentId && AGENT_ROLE_NAME[agentId]) return AGENT_ROLE_NAME[agentId];
  if (fallback && fallback.trim()) return fallback.trim();
  return agentId || "核查角色";
}

function isToolLike(item: ShellThoughtItem): boolean {
  return item.kind === "tool" || item.kind === "review";
}

function toolActivity(
  item: ShellThoughtItem,
  tools: ShellToolItem[]
): ProcessActivity {
  const matched =
    tools.find((t) => t.key === item.key) ||
    tools.find((t) => item.toolId && t.toolId === item.toolId);
  const title = humanizeProcessTitle(matched?.title || item.title);
  const detail =
    matched?.detail ||
    humanizeProcessSummary(item.description) ||
    undefined;
  let detailOut = detail;
  if (
    /历史|memory/i.test(`${item.key} ${item.toolId ?? ""} ${title}`) &&
    detailOut &&
    !/不作为本案证据|历史参考/.test(detailOut)
  ) {
    detailOut = detailOut.includes("命中")
      ? `历史参考 · ${detailOut}，不作为本案证据`
      : `历史参考 · ${detailOut}`;
  }
  return {
    key: item.key,
    title,
    detail: detailOut,
    status: item.status,
    toolKey: matched?.key || item.key,
  };
}

function ensureMaterialsParent(rows: VisibleProcessRow[]): VisibleProcessRow {
  const last = rows[rows.length - 1];
  if (last && (last.kind === "milestone" || last.kind === "debate")) {
    return last;
  }
  const created: VisibleProcessRow = {
    key: "materials",
    title: "对照公开材料",
    summary: undefined,
    status: "loading",
    kind: "milestone",
    activities: [],
    isCurrent: false,
    expanded: true,
  };
  rows.push(created);
  return created;
}

function upsertAgentAction(
  rows: VisibleProcessRow[],
  item: ShellThoughtItem,
  agentById: Map<string, { agentId: string; name: string; summary?: string }>
): void {
  const id = item.agentId || "agent";
  const chip = agentById.get(id);
  const actor = {
    agentId: id,
    name: roleNameForAgent(id, chip?.name || item.title),
  };
  const actionTitle = semanticActionTitleForAgent(id, item.title);
  const actionKey = `action:${id}`;
  const summary =
    humanizeProcessSummary(item.description) ||
    humanizeProcessSummary(chip?.summary) ||
    undefined;

  // Prefer attaching actor onto the last open milestone if it has no actor yet
  // and is still the "current" work surface (planner / materials).
  const last = rows[rows.length - 1];
  if (
    last &&
    last.kind === "milestone" &&
    !last.actor &&
    (last.key === "planner" || last.key === "materials") &&
    item.status === "loading"
  ) {
    last.actor = actor;
    last.status = item.status;
    if (summary) last.summary = summary;
    // Keep semantic planner title; actor carries role.
    return;
  }

  const existing = rows.find((r) => r.key === actionKey);
  if (existing) {
    existing.status = item.status;
    existing.actor = actor;
    if (summary) existing.summary = summary;
    existing.title = actionTitle;
    // Never let title collapse to role name
    if (existing.title === existing.actor.name) {
      existing.title = actionTitle;
    }
    return;
  }

  rows.push({
    key: actionKey,
    title: actionTitle,
    summary,
    status: item.status,
    kind: "milestone",
    actor,
    activities: [],
    isCurrent: false,
    expanded: true,
  });
}

/**
 * Reduce MissionShellModel into a single user-facing process narrative.
 */
export function buildVisibleProcessRows(model: MissionShellModel): VisibleProcessNarrative {
  const rows: VisibleProcessRow[] = [];
  const agentById = new Map(
    model.agents.map((a) => [a.agentId, { agentId: a.agentId, name: a.name, summary: a.summary }])
  );

  for (const item of model.thoughtItems) {
    if (item.key === "error") continue;

    if (isToolLike(item)) {
      const parent = ensureMaterialsParent(rows);
      if (!parent.activities.some((a) => a.key === item.key)) {
        parent.activities.push(toolActivity(item, model.tools));
      }
      if (item.status === "loading" && parent.status === "success") {
        parent.status = "loading";
      }
      if (item.status === "error" && parent.status !== "error") {
        parent.status = "error";
      }
      continue;
    }

    // Agents never become primary kind=agent rows — only actor on semantic milestones.
    if (item.kind === "agent") {
      upsertAgentAction(rows, item, agentById);
      continue;
    }

    // Final report is verdict territory
    if (item.key === "report:final" || (item.kind === "report" && item.key.includes("final"))) {
      continue;
    }

    if (item.kind === "planner" || item.kind === "relay") {
      rows.push({
        key: item.key,
        title: humanizeProcessTitle(item.title),
        summary: humanizeProcessSummary(item.description),
        status: item.status,
        kind: "milestone",
        activities: [],
        isCurrent: false,
        expanded: true,
      });
      continue;
    }

    if (item.kind === "debate") {
      rows.push({
        key: item.key,
        title: humanizeProcessTitle(item.title),
        summary: humanizeProcessSummary(item.description),
        status: item.status,
        kind: "debate",
        activities: [],
        isCurrent: false,
        expanded: true,
      });
      continue;
    }

    // Other non-tool primary thoughts (rare)
    if (item.kind === "report") {
      rows.push({
        key: item.key,
        title: humanizeProcessTitle(item.title),
        summary: humanizeProcessSummary(item.description),
        status: item.status,
        kind: "report",
        activities: [],
        isCurrent: false,
        expanded: true,
      });
    }
  }

  // Attach tools that never got a thought (defensive)
  for (const tool of model.tools) {
    const already = rows.some((r) =>
      r.activities.some((a) => a.toolKey === tool.key || a.key === tool.key)
    );
    if (already) continue;
    const parent = ensureMaterialsParent(rows);
    parent.activities.push({
      key: tool.key,
      title: humanizeProcessTitle(tool.title),
      detail: tool.detail,
      status: tool.status,
      toolKey: tool.key,
    });
  }

  const deferredReview =
    model.verdict.present && model.verdict.reviewPassed === false;
  const showVerdict =
    model.verdict.present && !deferredReview && !model.errorMessage;

  let mode: NarrativeMode = "running";
  if (model.errorMessage) mode = "error";
  else if (deferredReview) mode = "deferred";
  else if (model.verdict.present && !model.live) mode = "complete";
  else mode = "running";

  // Single current step
  let currentKey: string | null = null;
  if (mode === "running" || mode === "deferred") {
    const loading = [...rows].reverse().find((r) => r.status === "loading");
    const errored = [...rows].reverse().find((r) => r.status === "error");
    const pick = loading || errored || (model.live ? rows[rows.length - 1] : null);
    if (pick) {
      currentKey = pick.key;
      pick.isCurrent = true;
      if (mode === "running" && pick.status === "success" && model.live) {
        pick.nextHint = "继续核查后续材料与缺口";
      }
    }
  }

  let collapsedCount = 0;
  if (mode === "running" || mode === "deferred") {
    const currentIdx = currentKey ? rows.findIndex((r) => r.key === currentKey) : rows.length - 1;
    const expandFrom = Math.max(0, currentIdx - 1);
    rows.forEach((r, i) => {
      if (
        r.isCurrent ||
        r.activities.length > 0 ||
        i >= expandFrom ||
        r.status === "error" ||
        r.status === "loading"
      ) {
        r.expanded = true;
        return;
      }
      if (r.status === "success" || r.status === "pending") {
        r.expanded = false;
        collapsedCount += 1;
      } else {
        r.expanded = true;
      }
    });
  } else if (mode === "complete") {
    rows.forEach((r) => {
      r.expanded = false;
      r.isCurrent = false;
      collapsedCount += 1;
    });
  } else if (mode === "error") {
    rows.forEach((r, i) => {
      r.expanded = i >= rows.length - 3;
      if (!r.expanded) collapsedCount += 1;
    });
  }

  // Final copy hygiene: titles ≠ role names when actor present
  for (const r of rows) {
    r.title = humanizeProcessTitle(r.title);
    if (r.actor && r.title === r.actor.name) {
      r.title = semanticActionTitleForAgent(r.actor.agentId, r.title);
    }
    if (r.summary) r.summary = humanizeProcessSummary(r.summary);
    for (const a of r.activities) {
      a.title = humanizeProcessTitle(a.title);
    }
  }

  return {
    rows,
    collapsedCount,
    currentKey,
    mode,
    showVerdict,
    deferredReview,
    errorMessage: model.errorMessage,
    claim: model.claim,
    phaseLabel: model.phaseLabel,
    live: model.live,
  };
}

/** All first-level titles+summaries for copy gates in tests */
export function primaryNarrativeCopy(n: VisibleProcessNarrative): string[] {
  return n.rows.flatMap((r) => [r.title, r.summary].filter(Boolean) as string[]);
}

export function narrativeHasBannedPrimaryCopy(n: VisibleProcessNarrative): boolean {
  return primaryNarrativeCopy(n).some((s) => BANNED_PRIMARY.test(s));
}
