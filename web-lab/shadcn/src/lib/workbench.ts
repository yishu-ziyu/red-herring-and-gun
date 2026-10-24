/**
 * 事件流 → 工作台状态。纯函数：给定前 n 条事件，算出各步骤、活动时间线、最新快照、阶段。
 * 回放和实时共用：回放只是把 n 慢慢往前推，「历史回放」就是用一个更小的 n 再算一遍。
 *
 * 步骤只按后端真实发出的事件划分（agent_start/complete、tool_start/result、complete），
 * 每步耗时 = 这一步自己的结束时间 − 开始时间（事件 timestamp），不是从头算的时间点。
 */
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema";
import type { PublicActivity } from "@shared/investigation/activity";
import { judgmentToLabel, labelText } from "@shared/domain/labels";
import type { StreamEvent } from "./types";
import { clean } from "./scrub";

export type StepKind = "vision" | "split" | "search" | "check" | "audit" | "write";

export const STEP_META: Record<StepKind, { title: string; avatar?: string; doing: string }> = {
  vision: { title: "读图", doing: "正在读图片里的文字" },
  split: { title: "拆题", avatar: "/agents/rumor-detector.png", doing: "正在把这句话拆成几点" },
  search: { title: "检索", doing: "正在为每一点找材料" },
  check: { title: "核查", avatar: "/agents/fact-checker.png", doing: "正在逐点核对材料" },
  audit: { title: "来源审核", avatar: "/agents/source-validator.png", doing: "正在审核每条来源算支持还是反驳" },
  write: { title: "成稿", avatar: "/agents/report-composer.png", doing: "正在写整句结论" },
};

const AGENT_KIND: Record<string, StepKind> = {
  rumor_detector: "split",
  fact_checker: "check",
  source_validator: "audit",
};

export type SearchTask = {
  query: string;
  startedAt: number;
  endedAt?: number;
  sources: Array<{ title: string; url: string }>;
};

export type Step = {
  id: string;
  kind: StepKind;
  startedAt: number;
  endedAt?: number;
  status: "active" | "complete" | "error";
  thoughts: string;
  thinkingEndedAt?: number;
  output?: Record<string, unknown>;
  searches: SearchTask[];
  /** 这一步开始到结束之间的活动序号（时间线里定位用）。 */
  firstEventIndex: number;
  /** 老记录只存了活动：这一步由活动归类得出，没有真实的开始 / 结束时刻。 */
  approx?: boolean;
  activityCount?: number;
};

export type TimelineLine = {
  index: number;
  at: number;
  stepId?: string;
  tone: "neutral" | "support" | "contradict" | "done";
  text: string;
};

export type WorkbenchState = {
  steps: Step[];
  lines: TimelineLine[];
  snapshot: InvestigationSnapshotV1 | null;
  phase: string;
  terminal: boolean;
  startedAt: number;
  lastAt: number;
  error: string;
};

const ROLE_TEXT: Record<string, string> = { support: "算支持", contradict: "算反驳", "context-only": "只作背景" };

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function activityLine(activity: PublicActivity): { text: string; tone: TimelineLine["tone"] } | null {
  const p = activity.payload;
  switch (activity.kind) {
    case "claim_decomposed":
      return { text: `拆出一点：「${clean(p.claimText)}」`, tone: "neutral" };
    case "search_started":
      return { text: `开始找材料：「${clean(p.query)}」`, tone: "neutral" };
    case "source_found":
      return { text: `找到材料：${clean(p.title) || p.domain}${p.domain ? ` · ${p.domain}` : ""}`, tone: "neutral" };
    case "source_checked":
      return {
        text: `${ROLE_TEXT[p.role ?? ""] ?? "已核对"}：${clean(p.title) || p.domain}${p.domain ? ` · ${p.domain}` : ""}`,
        tone: p.role === "support" ? "support" : p.role === "contradict" ? "contradict" : "neutral",
      };
    case "evidence_assessed":
      return { text: `这一点有了判断：${labelText(judgmentToLabel(p.judgment as never))}`, tone: "done" };
    case "judgment_revised":
      return { text: `判断改了：${labelText(judgmentToLabel(p.from as never))} → ${labelText(judgmentToLabel(p.to as never))}`, tone: "done" };
    case "gap_identified":
      return { text: `还缺：${clean(p.description)}`, tone: "neutral" };
    case "conflict_detected":
      return { text: `来源说法冲突：${clean(p.summary)}`, tone: "neutral" };
    case "run_completed":
      return { text: "核查完成", tone: "done" };
    default:
      return null;
  }
}

const PHASE_OF_STATUS: Record<string, string> = {
  accepted: "received",
  extracting: "received",
  investigating: "investigating",
  judging: "judging",
  completed: "complete",
  cancelling: "investigating",
  cancelled: "interrupted",
  interrupted: "interrupted",
};

export function eventTime(event: StreamEvent): number {
  if (typeof event.timestamp === "number") return event.timestamp;
  const at = event.activity?.occurredAt;
  return at ? Date.parse(at) : 0;
}

/** 只存了活动、没存事件的老记录：按活动种类归到步骤上。 */
const ACTIVITY_KIND_STEP: Record<string, StepKind> = {
  claim_decomposed: "split",
  search_started: "search",
  source_found: "search",
  source_checked: "check",
  evidence_assessed: "check",
  judgment_revised: "check",
  gap_identified: "check",
  conflict_detected: "check",
  run_completed: "write",
};

export function buildWorkbench(events: StreamEvent[], count = events.length): WorkbenchState {
  const steps: Step[] = [];
  const lines: TimelineLine[] = [];
  let snapshot: InvestigationSnapshotV1 | null = null;
  let status = "";
  let terminal = false;
  let error = "";
  const startedAt = events.length ? eventTime(events[0]!) : 0;
  let lastAt = startedAt;
  const hasAgentEvents = events.some((e) => e.type === "agent_start" || e.type === "tool_start");

  const current = (kind: StepKind) => [...steps].reverse().find((s) => s.kind === kind && s.status === "active");
  const open = (kind: StepKind, at: number, index: number, id = `${kind}-${steps.length}`): Step => {
    const step: Step = { id, kind, startedAt: at, status: "active", thoughts: "", searches: [], firstEventIndex: index };
    steps.push(step);
    return step;
  };
  const close = (step: Step | undefined, at: number) => {
    if (!step || step.status !== "active") return;
    step.endedAt = step.approx ? step.endedAt ?? at : at;
    step.status = "complete";
    for (const task of step.searches) task.endedAt ??= at;
  };
  const activeStep = () => [...steps].reverse().find((s) => s.status === "active");

  for (let i = 0; i < Math.min(count, events.length); i += 1) {
    const event = events[i]!;
    const at = eventTime(event) || lastAt;
    lastAt = Math.max(lastAt, at);
    switch (event.type) {
      case "agent_start": {
        const kind = AGENT_KIND[event.agent ?? ""];
        if (!kind) break;
        // 检索步骤在下一个 agent 开始时收尾。
        close(current("search"), at);
        open(kind, at, i);
        lines.push({ index: i, at, stepId: steps.at(-1)!.id, tone: "neutral", text: `${STEP_META[kind].title}开始` });
        break;
      }
      case "agent_thought": {
        const step = current(AGENT_KIND[event.agent ?? ""] ?? "split");
        if (!step) break;
        step.thoughts += event.content ?? "";
        if (event.done) step.thinkingEndedAt = at;
        break;
      }
      case "agent_complete": {
        const step = current(AGENT_KIND[event.agent ?? ""] ?? "split");
        if (!step) break;
        step.output = event.output;
        step.thinkingEndedAt ??= at;
        close(step, at);
        lines.push({ index: i, at, stepId: step.id, tone: "done", text: `${STEP_META[step.kind].title}完成` });
        break;
      }
      case "agent_error": {
        const step = current(AGENT_KIND[event.agent ?? ""] ?? "split");
        if (!step) break;
        step.status = "error";
        step.endedAt = at;
        lines.push({ index: i, at, stepId: step.id, tone: "neutral", text: `${STEP_META[step.kind].title}没能完成，核查按现有材料继续` });
        break;
      }
      case "tool_start": {
        if (event.query === "图片材料解析") {
          open("vision", at, i);
          lines.push({ index: i, at, stepId: steps.at(-1)!.id, tone: "neutral", text: "开始读图片" });
        } else if (event.toolName === "Atom Search") {
          const step = current("search") ?? open("search", at, i);
          step.searches.push({ query: event.query ?? "", startedAt: at, sources: [] });
        } else {
          close(current("search"), at);
          open("write", at, i);
          lines.push({ index: i, at, stepId: steps.at(-1)!.id, tone: "neutral", text: "开始写结论并复核" });
        }
        break;
      }
      case "search_progress": {
        const step = current("search");
        const task = step?.searches.find((t) => t.query === event.atom) ?? step?.searches.at(-1);
        if (task && Array.isArray(event.sources)) {
          task.sources = event.sources
            .filter((s) => s.url)
            .map((s) => ({ title: clean(s.title ?? "") || domainOf(s.url!), url: s.url! }));
        }
        if (task && event.phase === "completed") task.endedAt = at;
        break;
      }
      case "tool_result":
      case "tool_error": {
        if (event.query === "图片材料解析") {
          const step = current("vision");
          if (step) {
            step.output = event.result;
            if (event.type === "tool_error") step.status = "error";
            close(step, at);
          }
        } else if (current("search") && current("search")!.searches.some((t) => t.query === event.query && !t.endedAt)) {
          const task = current("search")!.searches.find((t) => t.query === event.query && !t.endedAt)!;
          task.endedAt = at;
          const found = (event.result?.sources as Array<{ title?: string; url?: string }> | undefined) ?? [];
          if (task.sources.length === 0) task.sources = found.filter((s) => s.url).map((s) => ({ title: clean(s.title ?? ""), url: s.url! }));
          lines.push({ index: i, at, stepId: current("search")!.id, tone: "neutral", text: `「${clean(task.query)}」找到 ${task.sources.length} 条材料` });
        } else if (current("write")) {
          current("write")!.output = { passed: event.result?.passed };
        }
        break;
      }
      case "investigation_snapshot":
        if (event.investigation) snapshot = event.investigation;
        break;
      case "investigation_activity": {
        const activity = event.activity;
        if (!activity) break;
        let lineStep = activeStep()?.id;
        if (!hasAgentEvents) {
          // 老记录只有活动：同一类活动归到同一个步骤，不按活动先后假造 agent 交接和耗时。
          const kind = ACTIVITY_KIND_STEP[activity.kind];
          if (kind) {
            const step = steps.find((s) => s.kind === kind) ?? open(kind, at, i);
            step.approx = true;
            step.activityCount = (step.activityCount ?? 0) + 1;
            step.endedAt = at;
            lineStep = step.id;
            if (activity.kind === "source_found") {
              const p = activity.payload;
              if (!step.searches.length) step.searches.push({ query: "", startedAt: at, sources: [] });
              if (p.domain) step.searches.at(-1)!.sources.push({ title: clean(p.title) || p.domain, url: `https://${p.domain}/` });
            }
            if (activity.kind === "search_started") {
              const empty = step.searches.find((t) => !t.query && t.sources.length === 0);
              if (empty) empty.query = activity.payload.query ?? "";
              else step.searches.push({ query: activity.payload.query ?? "", startedAt: at, sources: [] });
            }
          }
        }
        const line = activityLine(activity);
        if (line) lines.push({ index: i, at, stepId: lineStep, ...line });
        break;
      }
      case "complete":
        close(current("write"), at);
        close(current("search"), at);
        break;
      case "run_state":
        status = event.status ?? status;
        if (event.terminal) {
          terminal = true;
          for (const step of steps) close(step, at);
        }
        break;
      case "error":
        error = event.message ?? "这次核查没能完成";
        break;
      default:
        break;
    }
  }
  if (!hasAgentEvents && terminal) for (const step of steps) close(step, lastAt);
  const phase = terminal ? PHASE_OF_STATUS[status] ?? "interrupted" : snapshot?.phase ?? PHASE_OF_STATUS[status] ?? "received";
  return { steps, lines, snapshot, phase, terminal, startedAt, lastAt, error };
}

/** 没有事件流的老记录：把快照和活动排成一串事件，好走同一个回放。 */
export function eventsFromActivities(snapshot: InvestigationSnapshotV1 | null, activities: PublicActivity[], createdAt: number): StreamEvent[] {
  const events: StreamEvent[] = [{ type: "run_state", status: "accepted", timestamp: createdAt }];
  for (const activity of activities) events.push({ type: "investigation_activity", activity, timestamp: Date.parse(activity.occurredAt) });
  const end = events.at(-1)?.timestamp ?? createdAt;
  // 只有最终快照，没有中间快照：放在最后，免得过程一开始就显示结论。
  if (snapshot) events.push({ type: "investigation_snapshot", investigation: snapshot, timestamp: end });
  events.push({ type: "run_state", status: snapshot?.phase === "complete" ? "completed" : "interrupted", terminal: true, timestamp: end });
  return events;
}

export function seconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${Math.round(s - m * 60)} 秒`;
}
