/**
 * Map MissionShellModel (live SSE) onto the Apodex run surface.
 * No Fed replay. No invented URLs. Memo lede answers the claim, not 能信/不能信.
 */
import type { MissionShellModel, ShellNodeStatus, ShellToolItem } from "../../../../lib/missionShell";
import type { ShellAtomSearchState } from "../../../../lib/missionShell/types";
import { humanizeVerdictType } from "../../../../lib/missionShell";
import { claimAtomKey } from "../../../../lib/claimAtom";
import { isSearchShellTool, sitesFromSearchResult, type WebSearchSite } from "./WebSearch";
import { buildInvestigationTodos, type TodoItem } from "./TodoList";
import { composeResearchMemo } from "./memoMarkdown";
import type { ClaimDecompositionNode, ClaimDecompositionStatus } from "./ClaimDecompositionFlow";
import type { SearchRadarProvider, SearchRadarStats } from "./SearchRadar";

export type ApodexStepKind = "thought" | "search" | "visit" | "board";

export type ApodexVisitPayload = {
  url?: string;
  urls?: string[];
  query?: string;
  info?: string;
};

export type ApodexStep = {
  id: string;
  kind: ApodexStepKind;
  status: ShellNodeStatus;
  label: string;
  detail?: string;
  paragraphs?: string[];
  query?: string;
  sites?: WebSearchSite[];
  visit?: ApodexVisitPayload;
  /** Frontier-style compact thinking ticker (no body). */
  ticker?: boolean;
  elapsedMs?: number;
};

export type ApodexVerdictTone = "true" | "false" | "mixed" | "unverified" | "interrupted";

export type ApodexReport = {
  verdictLabel: string;
  tone: ApodexVerdictTone;
  conclusion?: string;
  memo: string;
  shareAdvice?: string;
  findings: string[];
  sources: Array<{ title: string; url?: string }>;
};

/** 命题节点：ClaimDecompositionFlow 入参 + 最终报告逐条判定（按 claimAtomKey 稳定关联） */
export type ApodexAtomNode = ClaimDecompositionNode & { verdictLabel?: string };

/** 单个原子的检索雷达数据（search_progress 收敛态直通 SearchRadar props） */
export type ApodexAtomRadar = {
  providers: SearchRadarProvider[];
  stats?: SearchRadarStats;
  phase: "idle" | "started" | "progress" | "completed";
  sources: Array<{ title: string; url?: string }>;
};

/** 核查地图：原句 → 命题拆解 + 每原子雷达。rumor_detector 完成即出现，不等最终报告。 */
export type ApodexClaimMap = {
  atoms: ApodexAtomNode[];
  /** 默认选中的首个可核查原子；无可核查原子时缺省（此时不展示雷达） */
  defaultAtomId?: string;
  radarByAtom: Record<string, ApodexAtomRadar>;
};

export type ApodexRunModel = {
  claim: string;
  live: boolean;
  phaseLabel: string;
  steps: ApodexStep[];
  board: TodoItem[];
  boardVisible: boolean;
  claimMap?: ApodexClaimMap;
  report?: ApodexReport;
  errorMessage?: string;
};

const VISIT_CAP = 8;

function thoughtElapsedMs(item: MissionShellModel["thoughtItems"][number]): number | undefined {
  const n = item.reasoningElapsedMs;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function visitUrlsOf(step: ApodexStep): string[] {
  const fromList = step.visit?.urls?.filter(Boolean) ?? [];
  if (fromList.length > 0) return fromList;
  return step.visit?.url ? [step.visit.url] : [];
}

function lastMergeable(steps: ApodexStep[]): ApodexStep | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].kind === "board") continue;
    return steps[i];
  }
  return undefined;
}

function mergeConsecutiveTool(steps: ApodexStep[], incoming: ApodexStep): boolean {
  const last = lastMergeable(steps);
  if (!last || last.kind !== incoming.kind) return false;
  if (incoming.kind === "search" && last.kind === "search") {
    const queries = [last.query, last.detail, incoming.query, incoming.detail]
      .map((s) => (s ?? "").trim())
      .filter(Boolean);
    const unique: string[] = [];
    for (const q of queries) {
      if (!unique.includes(q)) unique.push(q);
    }
    last.query = unique.join(" · ");
    last.detail = last.query;
    last.sites = [...(last.sites ?? []), ...(incoming.sites ?? [])];
    if (incoming.status === "loading") {
      last.status = "loading";
      last.label = "Searching web";
    } else if (incoming.status === "error") {
      last.status = "error";
      last.label = "Search web";
    } else {
      last.status = incoming.status;
      last.label = "Search web";
    }
    return true;
  }
  if (incoming.kind === "visit" && last.kind === "visit") {
    const urls = [...visitUrlsOf(last), ...visitUrlsOf(incoming)].filter(Boolean);
    const unique: string[] = [];
    for (const url of urls) {
      if (!unique.includes(url)) unique.push(url);
    }
    last.visit = {
      url: unique[0],
      urls: unique,
      query: last.visit?.query || incoming.visit?.query,
      info: last.visit?.info || incoming.visit?.info,
    };
    last.detail = unique.map((u) => hostLabel(u) || u).join(" · ");
    if (incoming.status === "loading") {
      last.status = "loading";
      last.label = "Visiting page";
    } else if (incoming.status === "error") {
      last.status = "error";
      last.label = "Visit page";
    } else {
      last.status = incoming.status;
      last.label = "Visit page";
    }
    return true;
  }
  return false;
}

function thoughtParagraphs(item: MissionShellModel["thoughtItems"][number]): string[] {
  if (item.reasoning && item.reasoning.length > 0) return item.reasoning;
  const d = (item.description ?? "").trim();
  if (!d || d === "进行中" || d === "报告已生成") return [];
  return [d];
}

function mergeParagraphs(prev: string[] | undefined, next: string[] | undefined): string[] | undefined {
  if (!next?.length) return prev;
  if (!prev?.length) return next;
  const seen = new Set(prev);
  const out = [...prev];
  for (const p of next) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Consecutive agent beats merge. Board / Search / Visit start a new thought span. */
function foldThought(steps: ApodexStep[], incoming: ApodexStep): boolean {
  const last = steps[steps.length - 1];
  if (!last || last.kind !== "thought") return false;
  last.paragraphs = mergeParagraphs(last.paragraphs, incoming.paragraphs);
  last.elapsedMs = Math.max(last.elapsedMs ?? 0, incoming.elapsedMs ?? 0);
  if (incoming.status === "loading") {
    last.status = "loading";
    last.ticker = true;
    last.label = "thinking…";
    return true;
  }
  last.status = incoming.status === "error" ? "error" : "success";
  last.ticker = false;
  last.label = "Thought deeply";
  last.elapsedMs = last.elapsedMs || incoming.elapsedMs;
  return true;
}

function hostLabel(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").slice(0, 48);
  }
}

function isTodoWriteTool(tool: ShellToolItem): boolean {
  const key = `${tool.toolId ?? ""} ${tool.toolName ?? ""} ${tool.title ?? ""}`
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return key.includes("todowrite") || key.includes("addtask") || key.includes("updatetask") || tool.title === "任务板";
}

function boardFromTodoWrite(model: MissionShellModel): TodoItem[] | undefined {
  const tools = model.tools.filter(isTodoWriteTool);
  if (tools.length === 0) return undefined;
  const last = [...tools].reverse().find((tool) => Array.isArray(tool.result?.todos));
  const raw = last?.result?.todos;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: TodoItem[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; label?: unknown; content?: unknown; status?: unknown };
    const label =
      typeof rec.label === "string"
        ? rec.label.trim()
        : typeof rec.content === "string"
          ? rec.content.trim()
          : "";
    if (!label) continue;
    const statusRaw = typeof rec.status === "string" ? rec.status.trim() : "pending";
    const status: TodoItem["status"] =
      statusRaw === "done" || statusRaw === "active" || statusRaw === "error" || statusRaw === "pending"
        ? statusRaw
        : "pending";
    items.push({
      id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `todo-${i + 1}`,
      label,
      status,
    });
  }
  return items.length > 0 ? items : undefined;
}

function isVisitTool(tool: ShellToolItem): boolean {
  if (isSearchShellTool(tool)) return false;
  const key = `${tool.toolId ?? ""} ${tool.toolName ?? ""} ${tool.title ?? ""}`
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (/memorysearch|memorywrite|reportreviewer|vision|stepfun/.test(key)) return false;
  if (/fetch|visit|crawl|openpage|browse|打开页面/.test(key)) return true;
  const url = typeof tool.result?.url === "string" ? tool.result.url : "";
  return url.startsWith("http");
}

function toneFromVerdict(verdictType?: string): ApodexVerdictTone {
  const key = (verdictType ?? "").trim().toLowerCase();
  if (key === "true") return "true";
  if (key === "false" || key === "rumor") return "false";
  if (key === "mixed_misleading" || key === "mixed" || key === "partial") return "mixed";
  return "unverified";
}

const INCOMPLETE_REPORT =
  /核查模型未完成|信源审计模型未完成|写结论使用确定性兜底|该说法目前还查不清/;

function isIncompleteReport(model: MissionShellModel): boolean {
  const blob = [
    model.verdict.conclusion,
    model.verdict.shareAdvice,
    ...(model.verdict.keyFindings ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  return INCOMPLETE_REPORT.test(blob);
}

function stripLeadingVerdictEcho(text: string | undefined, label: string): string | undefined {
  if (!text) return undefined;
  const labels = [label, "不能信", "能信", "有真有假", "部分成立", "只能信一部分", "还查不清"].filter(Boolean);
  let t = text.trim();
  for (const p of labels) {
    t = t.replace(new RegExp(`^(?:${p}[。．\\.\\s]*)+`), "");
  }
  t = t.trim();
  return t || undefined;
}

function buildReport(model: MissionShellModel): ApodexReport | undefined {
  if (model.verdict.present && model.verdict.interrupted) {
    const sources = (model.verdict.topSources ?? []).map((s) => ({
      title: s.title,
      url: s.url,
    }));
    return {
      verdictLabel: "这次没查完",
      tone: "interrupted",
      memo: composeResearchMemo({
        verdictLabel: "这次没查完",
        conclusion: "这一轮没有收成判断。",
        sources,
      }),
      findings: [],
      sources,
    };
  }
  if (model.verdict.present) {
    const incomplete = isIncompleteReport(model);
    const verdictType = incomplete ? "unverified" : model.verdict.verdictType;
    const verdictLabel = humanizeVerdictType(verdictType);
    const conclusion = stripLeadingVerdictEcho(model.verdict.conclusion, verdictLabel);
    const sources = (model.verdict.topSources ?? []).map((s) => ({
      title: s.title,
      url: s.url,
    }));
    const findings = model.verdict.keyFindings ?? [];
    return {
      verdictLabel,
      tone: incomplete ? "unverified" : toneFromVerdict(model.verdict.verdictType),
      conclusion,
      memo: composeResearchMemo({
        verdictLabel,
        conclusion: model.verdict.conclusion,
        findings,
        sources,
        // 完成态把任务板沉淀成「核查路径」凭据：每步留下它的量化产出。
        // 末步「整理能不能信」不进凭据——它的产出就是上方的判决句。
        path: buildInvestigationTodos(model)
          .filter((item) => item.id !== "report")
          .map((item) => ({
            label: item.label,
            detail: item.detail,
          })),
      }),
      findings,
      sources,
    };
  }
  if (model.errorMessage) {
    return {
      verdictLabel: "这次没查完",
      tone: "interrupted",
      conclusion: model.errorMessage,
      memo: composeResearchMemo({
        verdictLabel: "这次没查完",
        conclusion: model.errorMessage,
      }),
      findings: [],
      sources: [],
    };
  }
  return undefined;
}

/** search_progress 状态 → 命题节点状态（Issue #14 固定映射）。 */
function atomNodeStatus(
  verifiable: boolean,
  state: ShellAtomSearchState | undefined
): ClaimDecompositionStatus {
  if (!verifiable) return "unverifiable";
  if (!state || state.phase === "idle") return "idle";
  if (state.phase === "completed") {
    const hasEvidence = (state.stats?.uniqueSourceCount ?? 0) > 0 || state.sources.length > 0;
    return hasEvidence ? "completed" : "failed";
  }
  return "searching";
}

/** complete 事件的 finalReport 留在 report:final 思考条目的 detail 里（streamAdapter 契约）。 */
function finalReportOf(model: MissionShellModel): Record<string, unknown> | undefined {
  if (!model.verdict.present) return undefined;
  const item = model.thoughtItems.find((t) => t.key === "report:final");
  const report = item?.detail?.finalReport;
  return report && typeof report === "object" ? (report as Record<string, unknown>) : undefined;
}

/**
 * 最终报告逐条判定 → claimAtomKey → verdict 原值。
 * 稳定 ID = claimAtomKey：服务端 claimItems.text 与 subclaimVerdicts.claimAtom 都是这个键
 * （buildClaimItems 预交错时已 key 化），精确匹配，不做模糊文本包含、不按数组位置猜。
 */
function finalVerdictByAtom(model: MissionShellModel): Map<string, string> {
  const out = new Map<string, string>();
  const report = finalReportOf(model);
  if (!report) return out;
  const rows = Array.isArray(report.claimItems)
    ? report.claimItems.map((raw) => {
        const rec = (raw ?? {}) as Record<string, unknown>;
        const verdict = (rec.verdict ?? {}) as Record<string, unknown>;
        return { text: typeof rec.text === "string" ? rec.text : "", value: verdict.verdict };
      })
    : Array.isArray(report.subclaimVerdicts)
      ? report.subclaimVerdicts.map((raw) => {
          const rec = (raw ?? {}) as Record<string, unknown>;
          return {
            text: typeof rec.claimAtom === "string" ? rec.claimAtom : "",
            value: rec.verdict,
          };
        })
      : [];
  for (const row of rows) {
    if (!row.text || typeof row.value !== "string" || !row.value) continue;
    out.set(claimAtomKey(row.text), row.value);
  }
  return out;
}

/** exaggerated（被夸大）没有独立人话档，就近并入「部分成立」。 */
function humanizeAtomVerdict(value: string): string {
  return humanizeVerdictType(value === "exaggerated" ? "partial" : value);
}

/**
 * 核查地图：rumor_detector 完成（understanding 出现）即生成，不等最终报告。
 * 原子 id 用 claimAtomKey(text)：与 search_progress 的 atom 键、报告 claimItems 的
 * text 键同属一个稳定键空间，三方精确对齐。
 */
function buildClaimMap(model: MissionShellModel): ApodexClaimMap | undefined {
  const understanding = model.understanding;
  if (!understanding || understanding.atoms.length === 0) return undefined;
  const verdictByKey = finalVerdictByAtom(model);
  const atoms: ApodexAtomNode[] = [];
  const radarByAtom: Record<string, ApodexAtomRadar> = {};
  let defaultAtomId: string | undefined;
  for (const atom of understanding.atoms) {
    const id = claimAtomKey(atom.text);
    const state = model.atomSearch[id];
    const verdict = atom.verifiable ? verdictByKey.get(id) : undefined;
    atoms.push({
      id,
      text: atom.text,
      verifiable: atom.verifiable,
      type: atom.type,
      status: atomNodeStatus(atom.verifiable, state),
      verdictLabel: verdict ? humanizeAtomVerdict(verdict) : undefined,
    });
    if (!atom.verifiable) continue;
    radarByAtom[id] = {
      phase: state?.phase ?? "idle",
      providers: state?.providers ?? [],
      stats: state?.stats,
      sources: (state?.sources ?? []).map((s) => ({ title: s.title, url: s.url || undefined })),
    };
    if (!defaultAtomId) defaultAtomId = id;
  }
  return { atoms, defaultAtomId, radarByAtom };
}

export function mapShellToApodexRun(model: MissionShellModel): ApodexRunModel {
  const steps: ApodexStep[] = [];
  let boardInserted = false;
  let visitCount = 0;

  const insertBoard = () => {
    if (boardInserted) return;
    boardInserted = true;
    steps.push({
      id: "board",
      kind: "board",
      status: model.live ? "loading" : "success",
      label: "Task board created",
    });
  };

  for (const item of model.thoughtItems) {
    if (item.kind === "report" || item.kind === "review") continue;

    if (item.kind === "agent") {
      const paragraphs = thoughtParagraphs(item);
      const elapsedMs = thoughtElapsedMs(item);
      if (item.status === "loading") {
        const incoming: ApodexStep = {
          id: item.key,
          kind: "thought",
          status: "loading",
          label: "thinking…",
          ticker: true,
          paragraphs: paragraphs.length > 0 ? paragraphs : undefined,
          elapsedMs,
        };
        if (!foldThought(steps, incoming)) {
          steps.push(incoming);
          insertBoard();
        }
        continue;
      }
      if (paragraphs.length === 0 && (elapsedMs ?? 0) < 1000) continue;
      const incoming: ApodexStep = {
        id: item.key,
        kind: "thought",
        status: item.status === "error" ? "error" : "success",
        label: "Thought deeply",
        paragraphs: paragraphs.length > 0 ? paragraphs : undefined,
        elapsedMs,
      };
      if (!foldThought(steps, incoming)) {
        steps.push(incoming);
        insertBoard();
      }
      continue;
    }

    if (item.kind !== "tool") continue;
    const tool = model.tools.find((t) => t.key === item.key);
    if (!tool) continue;

    if (isSearchShellTool(tool)) {
      const sites = sitesFromSearchResult(tool.result);
      const incoming: ApodexStep = {
        id: tool.key,
        kind: "search",
        status: tool.status,
        label: tool.status === "loading" ? "Searching web" : "Search web",
        detail: tool.query || tool.detail,
        query: tool.query,
        sites,
      };
      if (!mergeConsecutiveTool(steps, incoming)) {
        steps.push(incoming);
        insertBoard();
      }
      continue;
    }

    if (isVisitTool(tool)) {
      const url =
        typeof tool.result?.url === "string" && /^https?:\/\//i.test(tool.result.url)
          ? tool.result.url
          : typeof tool.query === "string" && /^https?:\/\//i.test(tool.query)
            ? tool.query
            : undefined;
      const incoming: ApodexStep = {
        id: tool.key,
        kind: "visit",
        status: tool.status,
        label: tool.status === "loading" ? "Visiting page" : "Visit page",
        detail: hostLabel(url) || tool.detail || tool.query,
        visit: {
          url,
          urls: url ? [url] : undefined,
          query: tool.query,
          info: tool.detail,
        },
      };
      if (mergeConsecutiveTool(steps, incoming)) continue;
      if (visitCount >= VISIT_CAP) continue;
      visitCount += 1;
      steps.push(incoming);
      insertBoard();
    }
  }

  const compacted: ApodexStep[] = [];
  for (const step of steps) {
    if (step.kind === "thought" && foldThought(compacted, step)) continue;
    compacted.push(step);
  }
  steps.length = 0;
  steps.push(...compacted);

  const started =
    model.thoughtItems.length > 0 || model.tools.length > 0 || model.agents.length > 0;
  if ((model.live || started) && !boardInserted) insertBoard();

  const fromTodo = boardFromTodoWrite(model);
  const usePipelineBoard =
    model.agents.length === 0 ||
    model.agents.some(
      (a) =>
        a.agentId === "rumor_detector" ||
        a.agentId === "fact_checker" ||
        a.agentId === "source_validator"
    );
  let board = fromTodo ?? (usePipelineBoard ? buildInvestigationTodos(model) : []);
  if (model.live && board.length > 0 && board.every((t) => t.status === "pending")) {
    board = board.map((item, i) => (i === 0 ? { ...item, status: "active" } : item));
  }
  if (!model.live && model.verdict.present && board.length > 0) {
    board = board.map((item) => (item.status === "error" ? item : { ...item, status: "done" }));
  }

  return {
    claim: model.claim,
    live: model.live,
    phaseLabel: model.phaseLabel,
    steps,
    board,
    boardVisible: model.live || started,
    claimMap: buildClaimMap(model),
    report: buildReport(model),
    errorMessage: model.errorMessage,
  };
}
