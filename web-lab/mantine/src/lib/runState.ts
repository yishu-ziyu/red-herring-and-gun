/**
 * 事件序列 → 工作台状态。同一个函数服务实时（SSE 逐条追加）、回放（样例按时间放）和历史回放（截到第 n 条重算）。
 * 每一步的耗时只用这一步自己的开始、结束事件时间相减，不是从开头算的时间点。
 */
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema.ts";
import { LABEL_TEXT, judgmentToLabel } from "@shared/domain/labels.ts";
import type { ImageReading, Report, StreamEvent } from "./data.ts";
import { imageReadingOf } from "./data.ts";
import { cleanList, cleanText, mentionsVendor, plainPart } from "./scrub.ts";

export type StepKey = "vision" | "decompose" | "search" | "check" | "audit" | "compose";
export type StepStatus = "waiting" | "running" | "done" | "failed";

export const STEP_META: Record<StepKey, { title: string; agent: string; img: string; doing: string }> = {
  vision: { title: "读图", agent: "图片读取", img: "/agents/rumor-detector.png", doing: "读出图片里的文字" },
  decompose: { title: "拆题", agent: "拆题员", img: "/agents/rumor-detector.png", doing: "把这句话拆成几点" },
  search: { title: "检索", agent: "检索员", img: "/agents/source-validator.png", doing: "为每一点找公开材料" },
  check: { title: "核查", agent: "核查员", img: "/agents/fact-checker.png", doing: "逐点对照材料下判断" },
  audit: { title: "来源审核", agent: "来源审核员", img: "/agents/source-validator.png", doing: "确认每条来源是支持还是反驳" },
  compose: { title: "成稿", agent: "成稿员", img: "/agents/report-composer.png", doing: "推出整句结论并写成结果" },
};

const AGENT_STEP: Record<string, StepKey> = {
  rumor_detector: "decompose",
  fact_checker: "check",
  source_validator: "audit",
  report_composer: "compose",
};

export type Thought = { text: string; at: number };

export type SearchQuery = { query: string; startedAt: number; endedAt?: number; found?: number };

export type Step = {
  key: StepKey;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  /** 同一步跑了几轮（来源审核会复核一轮）。 */
  rounds: number;
  thoughts: Thought[];
  thoughtsDone: boolean;
  thoughtsEndAt?: number;
  outputs: Record<string, unknown>[];
  queries: SearchQuery[];
  error?: string;
};

export type FeedItem = {
  id: string;
  at: number;
  step: StepKey | null;
  text: string;
  tone: "default" | "positive" | "negative" | "muted" | "accent";
};

export type RunView = {
  steps: Record<StepKey, Step>;
  order: StepKey[];
  snapshot: InvestigationSnapshotV1 | null;
  report: Report | null;
  feed: FeedItem[];
  image: ImageReading | null;
  status: string;
  terminal: boolean;
  startedAt: number | null;
  lastAt: number | null;
  notices: string[];
  failure: string | null;
  applied: number;
};

function emptyStep(key: StepKey): Step {
  return { key, status: "waiting", rounds: 0, thoughts: [], thoughtsDone: false, outputs: [], queries: [] };
}

const BASE_ORDER: StepKey[] = ["decompose", "search", "check", "audit", "compose"];

const ROLE_TEXT: Record<string, string> = { support: "支持", contradict: "反驳" };

function activityText(activity: Record<string, any>, snapshot: InvestigationSnapshotV1 | null): { text: string; tone: FeedItem["tone"] } | null {
  const p = (activity.payload ?? {}) as Record<string, string>;
  const claimText = snapshot?.claims.find((c) => c.id === activity.claimIds?.[0])?.text;
  const which = claimText ? `「${plainPart(claimText)}」` : "这一点";
  const site = p.domain ? `（${p.domain}）` : "";
  switch (activity.kind) {
    case "claim_decomposed":
      return { text: `拆出一点：${plainPart(p.claimText ?? "")}`, tone: "accent" };
    case "search_started":
      return { text: `开始检索：${p.query ?? ""}`, tone: "default" };
    case "source_found":
      return { text: `找到材料：${p.title || p.domain || "未命名来源"}${p.title ? site : ""}`, tone: "muted" };
    case "source_checked":
      return {
        text: `判定为${ROLE_TEXT[p.role] ?? "相关"}：${p.title || p.domain || "来源"}${p.title ? site : ""}`,
        tone: p.role === "contradict" ? "negative" : "positive",
      };
    case "evidence_assessed":
      return { text: `${which}有了判断：${LABEL_TEXT[judgmentToLabel(p.judgment as any)]}`, tone: "accent" };
    case "conflict_detected":
      return { text: `来源说法相反：${p.summary ?? ""}`, tone: "negative" };
    case "gap_identified":
      return { text: `还缺：${plainPart(p.description ?? "")}`, tone: "muted" };
    case "judgment_revised":
      return {
        text: `${which}改判：${LABEL_TEXT[judgmentToLabel(p.from as any)]} → ${LABEL_TEXT[judgmentToLabel(p.to as any)]}`,
        tone: "accent",
      };
    case "run_completed":
      return { text: "核查完成", tone: "positive" };
    default:
      return null;
  }
}

function stepForTool(toolName: string, query: string): StepKey | null {
  if (/vision/i.test(toolName) || query === "图片材料解析") return "vision";
  if (/report reviewer/i.test(toolName)) return "compose";
  if (/search/i.test(toolName)) return "search";
  return null;
}

export function buildRunView(events: readonly StreamEvent[]): RunView {
  const steps = Object.fromEntries(
    (["vision", ...BASE_ORDER] as StepKey[]).map((key) => [key, emptyStep(key)]),
  ) as Record<StepKey, Step>;
  const view: RunView = {
    steps,
    order: [...BASE_ORDER],
    snapshot: null,
    report: null,
    feed: [],
    image: null,
    status: "accepted",
    terminal: false,
    startedAt: null,
    lastAt: null,
    notices: [],
    failure: null,
    applied: events.length,
  };
  const feed = (id: string, at: number, step: StepKey | null, text: string, tone: FeedItem["tone"] = "default") => {
    if (!text.trim() || mentionsVendor(text)) return;
    view.feed.push({ id, at, step, text, tone });
  };
  const start = (key: StepKey, at: number) => {
    const s = steps[key];
    if (s.status === "running") return;
    if (s.status === "waiting") s.startedAt = at;
    s.status = "running";
    s.rounds += 1;
    s.thoughtsDone = false;
    feed(`start-${key}-${s.rounds}-${at}`, at, key, s.rounds > 1 ? `${STEP_META[key].title}复核一轮` : `${STEP_META[key].title}开始：${STEP_META[key].doing}`);
  };
  const finish = (key: StepKey, at: number, failed = false) => {
    const s = steps[key];
    if (s.status !== "running") return;
    s.status = failed ? "failed" : "done";
    s.endedAt = at;
    if (s.thoughts.length) s.thoughtsDone = true;
    const seconds = s.startedAt ? ((at - s.startedAt) / 1000).toFixed(1) : null;
    feed(`end-${key}-${s.rounds}-${at}`, at, key, failed ? `${STEP_META[key].title}这一步没能完成，按现有材料继续` : `${STEP_META[key].title}完成${seconds ? ` · 用时 ${seconds}s` : ""}`, failed ? "negative" : "positive");
  };
  const closeOthers = (except: StepKey, at: number) => {
    for (const key of view.order) if (key !== except && steps[key].status === "running" && key !== "compose") finish(key, at);
  };

  events.forEach((event, index) => {
    const at = typeof event.timestamp === "number" ? event.timestamp : view.lastAt ?? 0;
    if (view.startedAt === null && at) view.startedAt = at;
    if (at) view.lastAt = at;
    const id = `${event.eventSeq ?? index}`;
    switch (event.type) {
      case "run_state": {
        view.status = String(event.status ?? view.status);
        if (event.terminal === true) view.terminal = true;
        if (view.terminal) {
          for (const key of view.order) if (steps[key].status === "running") finish(key, at, view.status !== "completed");
        }
        break;
      }
      case "agent_start": {
        const key = AGENT_STEP[String(event.agent)];
        if (!key) break;
        // 一位 agent 开工，说明前面的检索已经交棒。
        if (key === "check" || key === "audit") closeOthers(key, at);
        if (key === "audit" && steps.compose.status === "running") {
          steps.compose.status = "waiting";
          steps.compose.startedAt = undefined;
          steps.compose.rounds = 0;
        }
        start(key, at);
        break;
      }
      case "agent_thought": {
        const key = AGENT_STEP[String(event.agent)];
        if (!key) break;
        const text = String(event.content ?? "").trim();
        if (text && !mentionsVendor(text)) steps[key].thoughts.push({ text, at });
        if (event.done === true) {
          steps[key].thoughtsDone = true;
          steps[key].thoughtsEndAt = at;
        }
        break;
      }
      case "agent_complete": {
        const key = AGENT_STEP[String(event.agent)];
        if (!key) break;
        if (event.output && typeof event.output === "object") steps[key].outputs.push(event.output as Record<string, unknown>);
        if (!steps[key].thoughtsEndAt && steps[key].thoughts.length) steps[key].thoughtsEndAt = at;
        finish(key, at);
        if (key === "audit") {
          steps.compose.status = "waiting";
          start("compose", at);
        }
        break;
      }
      case "agent_error": {
        const key = AGENT_STEP[String(event.agent)];
        if (key) {
          steps[key].error = String(event.error ?? "");
          finish(key, at, true);
        }
        break;
      }
      case "tool_start": {
        const key = stepForTool(String(event.toolName ?? ""), String(event.query ?? ""));
        if (key === "vision") {
          if (!view.order.includes("vision")) view.order.unshift("vision");
          start("vision", at);
        } else if (key === "search") {
          if (steps.decompose.status === "running") finish("decompose", at);
          start("search", at);
          const query = String(event.query ?? "");
          steps.search.queries.push({ query, startedAt: at });
          feed(`q-${id}`, at, "search", `检索：${query}`);
        }
        break;
      }
      case "tool_result":
      case "tool_error": {
        const key = stepForTool(String(event.toolName ?? ""), String(event.query ?? ""));
        if (key === "vision") {
          view.image = imageReadingOf(event.result as Record<string, unknown>) ?? view.image;
          finish("vision", at, event.type === "tool_error");
        } else if (key === "search") {
          const q = [...steps.search.queries].reverse().find((item) => item.query === event.query && item.endedAt === undefined);
          if (q) q.endedAt = at;
        }
        break;
      }
      case "search_progress": {
        if (event.phase === "completed") {
          const stats = (event.stats ?? {}) as Record<string, number>;
          const q = [...steps.search.queries].reverse().find((item) => item.query === event.atom);
          if (q && typeof stats.uniqueSourceCount === "number") {
            q.found = stats.uniqueSourceCount;
            feed(`sp-${id}`, at, "search", `「${q.query}」找到 ${stats.uniqueSourceCount} 条不重复结果`, "muted");
          }
        }
        break;
      }
      case "investigation_snapshot": {
        const snapshot = event.investigation as InvestigationSnapshotV1 | undefined;
        if (snapshot) view.snapshot = snapshot;
        break;
      }
      case "investigation_activity": {
        const activity = event.activity as Record<string, any> | undefined;
        if (!activity || activity.kind === "search_started") break;
        const line = activityText(activity, view.snapshot);
        if (line) {
          const step: StepKey | null =
            activity.kind === "claim_decomposed" ? "decompose" : activity.kind === "source_found" ? "search" : activity.kind === "run_completed" ? "compose" : "audit";
          feed(`a-${activity.id ?? id}`, at, step, line.text, line.tone);
        }
        break;
      }
      case "complete": {
        const report = event.finalReport as Report | undefined;
        if (report) view.report = report;
        finish("compose", at);
        break;
      }
      case "notice": {
        const message = String(event.message ?? "");
        if (message) {
          view.notices.push(message);
          feed(`n-${id}`, at, null, message, "muted");
        }
        break;
      }
      case "timeout_pending": {
        feed(`t-${id}`, at, null, "用时比平常长，还在继续查", "muted");
        break;
      }
      case "error": {
        view.failure = String(event.message ?? "这次核查没能完成，请稍后重试");
        feed(`e-${id}`, at, null, view.failure, "negative");
        break;
      }
      default:
        break;
    }
  });
  return view;
}

/** 当前该看哪一步：正在跑的最后一步；都没跑时第一步；全跑完时最后一步。 */
export function currentStep(view: RunView): StepKey {
  const running = view.order.filter((key) => view.steps[key].status === "running");
  if (running.length) return running[running.length - 1];
  const started = view.order.filter((key) => view.steps[key].status !== "waiting");
  return started.length ? started[started.length - 1] : view.order[0];
}

export function phaseOf(view: RunView): string {
  if (view.terminal && view.status !== "completed") return "interrupted";
  if (view.snapshot?.phase) return view.snapshot.phase;
  return view.terminal ? "interrupted" : "received";
}

export function seconds(ms: number): string {
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}分${Math.round(s % 60)}秒` : `${s.toFixed(1)}s`;
}

/** agent 产出里能给用户看的部分，按步骤挑字段并去掉服务名。 */
export function readableOutput(key: StepKey, output: Record<string, unknown>) {
  switch (key) {
    case "decompose": {
      const types = Array.isArray(output.claimAtomTypes) ? (output.claimAtomTypes as Record<string, unknown>[]) : [];
      const atoms = cleanList(output.claimAtoms);
      return {
        points: atoms.map((text) => {
          const t = types.find((item) => item.text === text);
          return { text: plainPart(text), role: String(t?.role ?? ""), checkable: t?.verifiable !== false };
        }),
        analysis: plainPart(cleanText(output.analysis)),
        indicators: cleanList(output.rumorIndicators),
      };
    }
    case "check": {
      const verdicts = Array.isArray(output.subclaimVerdicts) ? (output.subclaimVerdicts as Record<string, unknown>[]) : [];
      return {
        findings: cleanList(output.keyFindings).map(plainPart),
        counter: cleanList(output.counterEvidence).map(plainPart),
        verdicts: verdicts.map((v) => ({
          point: plainPart(String(v.claimAtom ?? "")),
          label: typeof v.label === "string" ? v.label : "",
          reason: plainPart(cleanText(v.reason)),
        })),
      };
    }
    case "audit": {
      const relations = Array.isArray(output.claimSourceRelations) ? (output.claimSourceRelations as Record<string, unknown>[]) : [];
      return {
        verified: cleanList(output.verifiedSources).map(plainPart),
        questionable: cleanList(output.questionableSources).map(plainPart),
        missing: cleanList(output.missingSources).map(plainPart),
        notes: plainPart(cleanText(output.verificationNotes)),
        relations: relations
          .filter((r) => typeof r.url === "string")
          .map((r) => ({ point: plainPart(String(r.claimAtom ?? "")), url: String(r.url), relation: String(r.relation ?? ""), reason: plainPart(cleanText(r.reason)) })),
      };
    }
    default:
      return null;
  }
}
