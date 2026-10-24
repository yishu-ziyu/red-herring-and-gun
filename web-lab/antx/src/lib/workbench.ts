// 把公开事件流归并成「工作台」状态：每个 agent / 检索 / 成稿是一步，每步记自己的开始和结束时间。
import type { InvestigationSnapshotV1, PublicActivity, StreamEvent } from "./types.ts";

export type StepKind = "vision" | "decompose" | "search" | "check" | "audit" | "compose" | "other";
export type StepStatus = "loading" | "success" | "error" | "abort";

export type Step = {
  key: string;
  kind: StepKind;
  title: string;
  startedAt: number;
  endedAt?: number;
  status: StepStatus;
  /** 思考片段与它们到达的时间。 */
  thoughts: string[];
  thoughtDoneAt?: number;
  output?: Record<string, unknown>;
  /** 检索这一点用的说法。 */
  query?: string;
  found: { title: string; url: string }[];
  searchDone?: boolean;
  review?: { passed?: boolean };
  ocr?: string[];
};

export type Workbench = {
  runId?: string;
  startedAt?: number;
  lastAt?: number;
  status: string;
  terminal: boolean;
  snapshot: InvestigationSnapshotV1 | null;
  steps: Step[];
  activities: (PublicActivity & { at: number })[];
  finalReport: Record<string, unknown> | null;
  error?: string;
};

const AGENT_KIND: Record<string, { kind: StepKind; title: string }> = {
  rumor_detector: { kind: "decompose", title: "拆题" },
  fact_checker: { kind: "check", title: "核查" },
  source_validator: { kind: "audit", title: "来源审核" },
};

export const STEP_AVATAR: Partial<Record<StepKind, string>> = {
  decompose: "/agents/rumor-detector.png",
  check: "/agents/fact-checker.png",
  audit: "/agents/source-validator.png",
  compose: "/agents/report-composer.png",
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function emptyWorkbench(): Workbench {
  return { status: "accepted", terminal: false, snapshot: null, steps: [], activities: [], finalReport: null };
}

export function reduceEvents(events: readonly StreamEvent[]): Workbench {
  const wb = emptyWorkbench();
  const open = (step: Omit<Step, "thoughts" | "found" | "status"> & Partial<Step>) => {
    const full: Step = { thoughts: [], found: [], status: "loading", ...step };
    wb.steps.push(full);
    return full;
  };
  const find = (pred: (s: Step) => boolean) => [...wb.steps].reverse().find(pred);
  const lastAgentEnd = () => Math.max(0, ...wb.steps.filter((s) => s.kind !== "compose").map((s) => s.endedAt ?? 0));

  for (const ev of events) {
    const at = typeof ev.timestamp === "number" ? ev.timestamp : wb.lastAt ?? Date.now();
    wb.lastAt = at;
    if (typeof ev.runId === "string") wb.runId = ev.runId;
    switch (ev.type) {
      case "run_started":
        wb.startedAt = typeof ev.startedAt === "number" ? ev.startedAt : at;
        break;
      case "run_state":
        wb.status = String(ev.status ?? wb.status);
        wb.terminal = ev.terminal === true;
        break;
      case "investigation_snapshot":
        if (isRecord(ev.investigation)) wb.snapshot = ev.investigation as InvestigationSnapshotV1;
        break;
      case "investigation_activity":
        if (isRecord(ev.activity)) wb.activities.push({ ...(ev.activity as PublicActivity), at });
        break;
      case "agent_start": {
        const meta = AGENT_KIND[String(ev.agent)] ?? { kind: "other" as StepKind, title: "处理" };
        open({ key: `agent:${ev.agent}:${wb.steps.length}`, kind: meta.kind, title: meta.title, startedAt: at });
        break;
      }
      case "agent_thought": {
        const meta = AGENT_KIND[String(ev.agent)];
        const step = find((s) => s.kind === (meta?.kind ?? "other") && s.status === "loading");
        if (!step) break;
        if (typeof ev.content === "string" && ev.content.trim()) step.thoughts.push(ev.content);
        if (ev.done === true) step.thoughtDoneAt = at;
        break;
      }
      case "agent_complete":
      case "agent_error": {
        const meta = AGENT_KIND[String(ev.agent)];
        const step = find((s) => s.kind === (meta?.kind ?? "other") && s.status === "loading");
        if (!step) break;
        step.endedAt = at;
        step.status = ev.type === "agent_complete" ? "success" : "error";
        if (step.thoughts.length && !step.thoughtDoneAt) step.thoughtDoneAt = at;
        if (isRecord(ev.output)) step.output = ev.output;
        break;
      }
      case "tool_start": {
        const query = typeof ev.query === "string" ? ev.query : "";
        if (ev.toolName === "Atom Search") {
          open({ key: `search:${query}:${wb.steps.length}`, kind: "search", title: "检索", startedAt: at, query });
        } else if (String(ev.toolName ?? "").startsWith("Report Reviewer")) {
          const begun = find((s) => s.kind === "compose");
          if (!begun) open({ key: `compose:${wb.steps.length}`, kind: "compose", title: "成稿", startedAt: lastAgentEnd() || at });
        }
        break;
      }
      case "search_progress": {
        const step = find((s) => s.kind === "search" && s.query === ev.atom);
        if (!step) break;
        if (Array.isArray(ev.sources)) {
          step.found = (ev.sources as Record<string, unknown>[])
            .filter((s) => typeof s.url === "string")
            .map((s) => ({ title: String(s.title ?? ""), url: String(s.url) }));
        }
        if (ev.phase === "completed") step.searchDone = true;
        break;
      }
      case "tool_result":
      case "tool_error": {
        const result = isRecord(ev.result) ? ev.result : {};
        if (ev.query === "图片材料解析" || result._source === "stepfun-vision" || Array.isArray(result.ocrTexts)) {
          const ocr = Array.isArray(result.ocrTexts) ? (result.ocrTexts as unknown[]).filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
          open({ key: `vision:${wb.steps.length}`, kind: "vision", title: "读图", startedAt: wb.startedAt ?? at, endedAt: at, status: ev.type === "tool_result" ? "success" : "error", ocr, output: result });
          break;
        }
        const search = find((s) => s.kind === "search" && s.query === ev.query && s.status === "loading");
        if (search) {
          search.endedAt = at;
          search.status = ev.type === "tool_result" ? "success" : "error";
          if (Array.isArray(result.sources) && search.found.length === 0) {
            search.found = (result.sources as Record<string, unknown>[])
              .filter((s) => typeof s.url === "string")
              .map((s) => ({ title: String(s.title ?? ""), url: String(s.url) }));
          }
          break;
        }
        const compose = find((s) => s.kind === "compose");
        if (compose) compose.review = { passed: result.passed === true };
        break;
      }
      case "complete": {
        if (isRecord(ev.finalReport)) wb.finalReport = ev.finalReport;
        const compose = find((s) => s.kind === "compose") ?? open({ key: `compose:${wb.steps.length}`, kind: "compose", title: "成稿", startedAt: lastAgentEnd() || at });
        compose.endedAt = at;
        compose.status = "success";
        break;
      }
      case "error":
        wb.error = typeof ev.message === "string" ? ev.message : "这次核查没能完成";
        break;
    }
  }
  if (wb.terminal) {
    for (const step of wb.steps) if (step.status === "loading") { step.status = "abort"; step.endedAt ??= wb.lastAt; }
  }
  return wb;
}

/** 当前阶段：完成时为 complete / interrupted（e2e 读 data-gp-phase）。 */
export function phaseOf(wb: Workbench): string {
  if (wb.terminal) {
    if (wb.status === "completed" || wb.snapshot?.phase === "complete") return "complete";
    return "interrupted";
  }
  return wb.snapshot?.phase ?? "received";
}

export const PHASE_TEXT: Record<string, string> = {
  received: "正在拆题",
  decomposed: "已拆成几点",
  investigating: "正在检索与核查",
  judging: "正在下结论",
  complete: "已完成",
  interrupted: "已中断",
};
