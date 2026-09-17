/**
 * App — 生产入口（Issue #52）：默认渲染轻量产品壳 + 同画布 Golden Path。
 * 旧三栏壳（AppShell + MissionControl + ResultView）整建制退到 `/?legacy=1`
 * 调试路径（legacy/LegacyDesk.tsx），不再承担生产信息架构。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ReasoningProvider } from "./store/reasoningStore";
import {
  rebuildInvestigationFromReport,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "./lib/investigation";
import { interruptedInvestigationSnapshot } from "./lib/interruptedSnapshot";
import { ProductShell, type ShellCase } from "./goldenPath/ProductShell";
import { InputStage } from "./goldenPath/InputStage";
import { InvestigationCanvas } from "./goldenPath/InvestigationCanvas";
import { useInvestigationRun, type StartOptions } from "./goldenPath/useInvestigationRun";
import { gpCopyFor } from "./goldenPath/copy";
import { useUiLang } from "./lib/useUiLang";
import { LoginView } from "./components/v3/auth/LoginView";
import { AccountView } from "./components/v3/auth/AccountView";
import { ModelProviderSettingsPreview } from "./components/v3/settings/ModelProviderSettingsPreview";
import { ApiKeySettings } from "./components/v3/settings/ApiKeySettings";
import type { AccountProfile } from "./components/v3/auth/accountTypes";
import { accountDisplayName } from "./lib/accountIdentity";
import { caseIntakeFailedLinks, caseIntakePrimaryText, createCaseIntake, type CaseIntake } from "./lib/caseIntake";
import { homeCaseSnapshot, type HomeCaseId } from "./goldenPath/homeCases";
import { createKnowledgeBase, normalizeHistoryClaim } from "./lib/knowledgeBase";
import type { KnowledgeBaseEntry } from "./lib/schemas";
import { composeFollowUpClaim, displayFollowUpClaim, previousAnswerText } from "./lib/composeFollowUpClaim";
import { visiblePriorRoundFromSnapshot } from "./lib/priorRoundBrief";
import { appendInvestigationRound, readInvestigationThread, threadSummary, type InvestigationThread, type InvestigationRound } from "./lib/investigationThread";
import { InvestigationThreadHeader } from "./goldenPath/InvestigationThreadHeader";

const LegacyDesk = lazy(() =>
  import("./legacy/LegacyDesk").then((module) => ({ default: module.default }))
);

type ProductMode = "input" | "investigation";

type ActiveCase = {
  localId: string;
  claim: string;
  intake: CaseIntake | null;
  /** Completed earlier rounds; the current round remains live until it settles. */
  thread?: InvestigationThread;
  roundId?: string;
  roundKind?: InvestigationRound["kind"];
  /** 服务端存档 id：只有它存在时才谈得上分享（分享是服务端投影）。 */
  serverCaseId?: string | null;
  /** 历史/旧调查打开：直接渲染落库快照，不发起调查。 */
  restored?: {
    snapshot: InvestigationSnapshotV1;
    report: Record<string, unknown> | null;
    at?: number;
  } | null;
};

type ServerCaseItem = {
  caseId: string;
  claim: string;
  status?: "done" | "interrupted";
  createdAt?: number;
  threadId?: string;
  threadClaim?: string;
  roundCount?: number;
};

/** 进行中那条 run 在本地留的座标：刷新后靠它接回去，而不是重开一次调查。 */
type SaveStatus = "idle" | "local" | "syncing" | "synced" | "failed";

type StoredRunPointer = {
  runId: string;
  claim: string;
  intake: CaseIntake | null;
  lastSeq: number;
  at: number;
  localId?: string;
  roundId?: string;
  roundKind?: InvestigationRound["kind"];
  thread?: InvestigationThread;
  accountScope?: string | null;
};

const RUN_POINTER_KEY = "rhg:active-run";

function readRunPointer(): StoredRunPointer | null {
  try {
    const raw = window.localStorage.getItem(RUN_POINTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRunPointer;
    if (!parsed || typeof parsed.runId !== "string" || !parsed.runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRunPointer(value: StoredRunPointer | null): void {
  try {
    if (value) window.localStorage.setItem(RUN_POINTER_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(RUN_POINTER_KEY);
  } catch {
    /* 隐私模式下写不了就不写，不影响调查本身 */
  }
}

/**
 * 超时不再一锤定音时的提示（契约 docs/evals/2026-09-12-mainpath-p0.md Change C）。
 * 服务端总超时之后管线仍在跑，这时等结果是可选的：人还在就继续跟着看，
 * 离开或刷新也能从同一条 run 取回同一份结论。
 */
const TIMEOUT_PENDING_NOTICE = {
  zh: "还在查，可以离开页面，稍后回来或刷新能看到结果",
  en: "Still investigating. You can leave this page — come back later or refresh to see the result.",
};

/**
 * 打开历史条目失败时的提示（契约 docs/evals/2026-09-12-mainpath-p1.md Change G）。
 * 服务端 404/报错、网络中断、旧记录读不出可用快照，这三种都是「点了没反应」，
 * 必须说出来；条目本身的状态不动，用户还能再试。
 */
const HISTORY_OPEN_FAILED_NOTICE = {
  zh: "这条历史暂时打不开，条目还留在列表里，可以稍后重试。",
  en: "This saved check can't be opened right now. It stays in your list; try again later.",
};

/** 浏览器把接口进程死掉写成 Failed to fetch，不能原样摊在首页主区。 */
function publicTransportError(message: string, fallback: string): string {
  if (!message || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return fallback;
  }
  return message;
}

/** 从落库 finalReport 确定性取回 Snapshot：优先保存的 investigation，旧数据客户端重建（零模型零搜索）。 */
function snapshotFromReport(report: Record<string, unknown> | null | undefined): InvestigationSnapshotV1 | undefined {
  if (!report || typeof report !== "object") return undefined;
  const embedded = (report as Record<string, unknown>).investigation;
  if (embedded) {
    try {
      return validateInvestigationSnapshot(embedded);
    } catch {
      /* 损坏对象走重建 */
    }
  }
  try {
    return rebuildInvestigationFromReport({ report, claim: typeof report.claim === "string" ? report.claim : "" });
  } catch {
    return undefined;
  }
}

function toShellCases(items: ServerCaseItem[]): ShellCase[] {
  return items.map((item) => ({
    id: item.caseId,
    claim: item.threadClaim ?? item.claim,
    threadId: item.threadId,
    roundCount: item.roundCount,
    status: item.status === "interrupted" ? "interrupted" : item.status === "done" ? "done" : "running",
    createdAt: item.createdAt,
  }));
}

function groupThreadCases(items: ShellCase[]): ShellCase[] {
  const latest = new Map<string, ShellCase>();
  for (const item of items) {
    const key = item.threadId ?? item.id;
    const previous = latest.get(key);
    if (!previous || (item.roundCount ?? 0) > (previous.roundCount ?? 0) ||
        ((item.roundCount ?? 0) === (previous.roundCount ?? 0) && (item.createdAt ?? 0) > (previous.createdAt ?? 0))) latest.set(key, item);
  }
  return [...latest.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function threadForRound(active: ActiveCase, snapshot: InvestigationSnapshotV1): InvestigationThread {
  const thread = active.thread ?? { version: 1 as const, id: active.roundId ?? active.localId, originalClaim: active.claim, rounds: [] };
  if (snapshot.phase !== "complete" && snapshot.phase !== "interrupted") return thread;
  return appendInvestigationRound(thread, {
    id: active.roundId ?? active.localId,
    kind: active.roundKind ?? "initial",
    question: displayFollowUpClaim(active.claim),
    snapshot,
  });
}

function restoredThreadFields(report: unknown): Pick<ActiveCase, "thread" | "roundId" | "roundKind"> {
  const saved = readInvestigationThread(report);
  if (!saved?.rounds.length) return {};
  const last = saved.rounds[saved.rounds.length - 1];
  return { thread: { ...saved, rounds: saved.rounds.slice(0, -1) }, roundId: last.id, roundKind: last.kind };
}

function ProductApp() {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [mode, setMode] = useState<ProductMode>("input");
  const [active, setActive] = useState<ActiveCase | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = active?.localId ?? null;
  const [cases, setCases] = useState<ShellCase[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sameClaim, setSameClaim] = useState<{ id: string; claim: string; at?: number; intake: CaseIntake } | null>(null);
  /** 保存状态：独立于结果存在与否显示，不把失败藏在 console。 */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const scopeVersion = useRef(0);
  const accountEmailRef = useRef<string | null>(null);
  const run = useInvestigationRun();
  const [draftClaim, setDraftClaim] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ question: string; runId: string } | null>(null);
  const persistedRoundRef = useRef<string | null>(null);
  const [initialRunPointer] = useState(readRunPointer);

  const isModelSettingsPreviewRoute = import.meta.env.DEV && window.location.pathname === "/model-settings-preview";
  const isApiKeySettingsRoute = window.location.pathname === "/settings/api-key";

  // 与旧壳同一纪律：不用 AbortSignal（/me /cases 是幂等 GET，重复结果幂等）。
  const hydrateAccountCases = useCallback(async () => {
    const version = ++scopeVersion.current;
    setHistoryReady(false);
    try {
      const me = await fetch("/api/auth/email/me", { credentials: "include" });
      if (version !== scopeVersion.current) return;
      if (!me.ok) {
        setAccount(null);
        accountEmailRef.current = null;
      } else {
        const data = (await me.json()) as Partial<AccountProfile> & { authenticated?: boolean; email?: string };
        if (version !== scopeVersion.current) return;
        if (data.authenticated && typeof data.email === "string") {
          setAccount({
            email: data.email,
            displayName: typeof data.displayName === "string" ? data.displayName : "",
            name: typeof data.name === "string" ? data.name : accountDisplayName(data.email, data.displayName),
            createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
            loginCount: typeof data.loginCount === "number" ? data.loginCount : 1,
            lastLoginAt: typeof data.lastLoginAt === "number" ? data.lastLoginAt : Date.now(),
          });
          accountEmailRef.current = data.email;
        } else {
          setAccount(null);
          accountEmailRef.current = null;
        }
      }
      const listRes = await fetch("/api/cases", { credentials: "include" });
      if (listRes.ok && version === scopeVersion.current) {
        const list = (await listRes.json()) as { cases?: ServerCaseItem[] };
        setCases(groupThreadCases(toShellCases(Array.isArray(list.cases) ? list.cases : [])));
      }
      const local = await createKnowledgeBase(accountEmailRef.current).listCases();
      if (version !== scopeVersion.current) return;
      setCases((prev) => {
        const localItems: ShellCase[] = local.map((entry) => ({
          id: entry.id,
          claim: threadSummary(entry.finalReport).threadClaim ?? entry.claim,
          ...threadSummary(entry.finalReport),
          status: (entry.finalReport as Record<string, unknown>)._source === "error-boundary" ? "interrupted" as const : "done" as const,
          createdAt: entry.timestamp,
          report: entry.finalReport as Record<string, unknown>,
        }));
        const ids = new Set(localItems.map((item) => item.id));
        return groupThreadCases([...localItems, ...prev.filter((item) => !ids.has(item.id))]);
      });
      setHistoryReady(true);
    } catch {
      if (version === scopeVersion.current) setHistoryReady(true);
    }
  }, []);

  useEffect(() => {
    void hydrateAccountCases();
  }, [hydrateAccountCases]);

  // 刷新恢复：本地留过一条没跑完的 run，就接回去读它的状态与已有材料。
  // 不重开调查，也不重复扣额。只跑一次。
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !historyReady) return;
    resumedRef.current = true;
    const pointer = initialRunPointer;
    if (!pointer) return;
    if ((pointer.accountScope ?? null) !== accountEmailRef.current) { writeRunPointer(null); return; }
    setActive({ localId: pointer.localId ?? `case-${pointer.at}`, roundId: pointer.roundId, roundKind: pointer.roundKind, thread: readInvestigationThread({ investigationThread: pointer.thread }), claim: pointer.claim, intake: pointer.intake, restored: null });
    setMode("investigation");
    run.resume(pointer.runId, pointer.lastSeq, pointer.claim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyReady]);

  // 记录进行中那条 run 的座标；终态或回首页时清掉。
  // 接不回去且还没有任何材料：清座标、回输入页。否则刷新会反复钉在「连接中断」。
  useEffect(() => {
    if (mode !== "investigation" || active?.restored) {
      writeRunPointer(null);
      return;
    }
    if (run.state.connection === "failed" && !run.state.snapshot) {
      writeRunPointer(null);
      // 刚提交、链接打不开、调查已开始：留下调查态和链接提示。
      // 连接中断是空流/无快照的副作用，不能盖掉这次提交自己的提示。
      if (active && caseIntakeFailedLinks(active.intake).length > 0) {
        return;
      }
      setHistoryNotice(publicTransportError(run.state.errorMessage, copy.connectionLost));
      setActive(null);
      setMode("input");
      return;
    }
    const runId = run.state.runId;
    if (!runId || !active) return;
    if (run.state.connection === "ended" || run.state.stop === "stopped") {
      writeRunPointer(null);
      return;
    }
    writeRunPointer({
      runId,
      claim: active.claim,
      intake: active.intake,
      lastSeq: run.state.lastActivitySeq,
      at: Date.now(),
      localId: active.localId,
      roundId: active.roundId,
      roundKind: active.roundKind,
      thread: active.thread,
      accountScope: accountEmailRef.current,
    });
  }, [mode, active, copy.connectionLost, run.state.runId, run.state.lastActivitySeq, run.state.connection, run.state.stop, run.state.snapshot, run.state.errorMessage]);

  // DEV 固定装置：/?fixture=investigating|judging|complete|conflict|interrupted|image-found|image-missing|mixed|nospan|settling|source-audit|replay
  // 用脚本化快照驱动真实组件树（截图与走查）。生产构建 dead-code eliminated。
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const name = new URLSearchParams(window.location.search).get("fixture");
    if (!name) return;
    let cancelled = false;
    void (async () => {
      const { getDevFixture, FIXTURE_CLAIM } = await import("./goldenPath/devFixture");
      if (cancelled) return;
      beginRun({ text: FIXTURE_CLAIM, links: [], images: [], createdAt: Date.now() }, getDevFixture(name as never));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 落库一次：先本地，再（已登录时）服务端。
   * 抽成 useCallback 是为了让「同步失败，重试」真的有得点——说得出就必须点得到。
   */
  const persistResult = useCallback(
    async (report: Record<string, unknown>, localId: string, claim: string) => {
      const doneAt = Date.now();
      const ownerEmail = accountEmailRef.current;
      const isCurrent = () => activeIdRef.current === localId && accountEmailRef.current === ownerEmail;
      if (isCurrent()) setSaveStatus("syncing");
      const knowledgeBase = createKnowledgeBase(ownerEmail);
      const existing = await knowledgeBase.getCase(localId).catch(() => null);
      const entry: KnowledgeBaseEntry = {
        id: localId,
        claim,
        rumorType: "深度核查",
        diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
        finalReport: report,
        handoffSteps: [],
        credibilityScore: typeof report.credibilityScore === "number" ? report.credibilityScore : 50,
        timestamp: existing?.timestamp ?? doneAt,
        tags: ["golden-path"],
      };
      try {
        await knowledgeBase.saveCase(entry);
      } catch (error) {
        console.error("[cases] 案例写入本地知识库失败", error);
        setHistoryNotice("调查自动保存失败，刷新后可能无法找回。请先保留当前报告。");
        if (isCurrent()) setSaveStatus("failed");
        return;
      }
      if (accountEmailRef.current !== ownerEmail) return;
      if (isCurrent()) setSaveStatus("local");
      if (!ownerEmail) return;
      try {
        const res = await fetch("/api/case", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claim,
            report,
            credibilityScore: typeof report.credibilityScore === "number" ? report.credibilityScore : 50,
          }),
        });
        if (!res.ok) {
          console.error(`[cases] 服务端存档失败 HTTP ${res.status}`);
          setHistoryNotice(copy.historySyncFailed);
          if (isCurrent()) setSaveStatus("failed");
          return;
        }
        if (accountEmailRef.current !== ownerEmail) return;
        if (isCurrent()) setSaveStatus("synced");
        const data = (await res.json()) as { caseId?: string };
        if (!data.caseId) return;
        const saved = await knowledgeBase.getCase(localId);
        if (saved && saved.id !== data.caseId) {
          await knowledgeBase.saveCase({ ...saved, id: data.caseId });
        }
        setCases((prev) => prev.map((item) => (item.id === localId ? { ...item, id: data.caseId as string } : item)));
        setActive((prev) =>
          prev && prev.localId === localId
            ? { ...prev, localId: data.caseId ?? prev.localId, serverCaseId: data.caseId ?? null }
            : prev
        );
      } catch (error) {
        console.error("[cases] 服务端存档异常", error);
        setHistoryNotice(copy.historySyncFailed);
        if (isCurrent()) setSaveStatus("failed");
      }
    },
    [copy.historySyncFailed]
  );

  /** 重试同步：用当前这份结果再走一遍，不重新调查。 */
  const retrySave = useCallback(() => {
    const report = active?.restored?.report ?? run.state.finalReport;
    if (!report || !active) return;
    const snapshot = snapshotFromReport(report);
    void persistResult(snapshot ? { ...report, investigationThread: threadForRound(active, snapshot) } : report, active.localId, active.claim);
  }, [active, persistResult, run.state.finalReport]);

  // 完成：本地留存 +（已登录）服务端落库。保存失败不挡结果，但必须可见。
  useEffect(() => {
    if (mode !== "investigation" || !active || active.restored) return;
    const terminalConnection = run.state.connection === "ended" || run.state.connection === "failed";
    const interrupted = run.state.snapshot?.phase === "interrupted" && terminalConnection;
    const restoredCompletion = run.state.snapshot?.phase === "complete" && terminalConnection;
    const report = run.state.finalReport ?? (interrupted || restoredCompletion ? {
      _source: interrupted ? "error-boundary" : "restored-snapshot",
      conclusion: run.state.snapshot?.conclusion?.directAnswer ?? "",
      investigation: run.state.snapshot,
      ...(run.state.snapshot?.checkedAt ? { checkedAt: run.state.snapshot.checkedAt } : {}),
    } : null);
    if (!report) return;
    const persistedKey = `${active.roundId ?? active.localId}:${run.state.finalReport || restoredCompletion ? "report" : "interrupted"}`;
    if (persistedRoundRef.current === persistedKey) return;
    persistedRoundRef.current = persistedKey;
    const doneAt = Date.now();
    const localId = active.localId;
    const claim = active.claim;
    const savedSnapshot = snapshotFromReport(report);
    const durable = savedSnapshot ? { ...report, investigationThread: threadForRound(active, savedSnapshot) } : report;
    const summary = threadSummary(durable);
    setCases((prev) => groupThreadCases([
      { id: localId, claim: summary.threadClaim ?? claim, ...summary, report: durable, status: report._source === "error-boundary" ? ("interrupted" as const) : ("done" as const), createdAt: doneAt },
      ...prev.filter((item) => item.id !== localId),
    ]));
    void persistResult(durable, localId, claim);
    // 只在 finalReport 首次出现时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.state.finalReport, run.state.snapshot, run.state.connection, active, mode, persistResult]);

  /** 无守卫直接开跑：同句守卫的「重新核查」与普通提交共用。 */
  const beginRun = useCallback(
    (
      intake: CaseIntake,
      fixture?: NonNullable<Parameters<ReturnType<typeof useInvestigationRun>["start"]>[1]>["fixture"],
      // 追问：登录带 caseId；访客带上一轮可见材料。首轮不传。
      followUp?: Pick<StartOptions, "priorCaseId" | "priorRound">,
      previousThread?: InvestigationThread,
      roundKind: InvestigationRound["kind"] = "initial",
    ) => {
      resumedRef.current = true;
      setSelectedRoundId(null);
      setPendingFocus(null);
      setSaveStatus("idle");
      setHistoryNotice("");
      setSameClaim(null);
      setDraftClaim("");
      const claim = caseIntakePrimaryText(intake);
      const localId = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const thread = previousThread ?? { version: 1 as const, id: localId, originalClaim: claim, rounds: [] };
      setActive({ localId, roundId: localId, roundKind, claim, intake, thread });
      setCases((prev) => [{ id: localId, claim: thread.originalClaim, threadId: thread.id, roundCount: thread.rounds.length + 1, status: "running" as const }, ...prev.filter((item) => item.id !== localId && item.threadId !== thread.id)]);
      setMode("investigation");
      run.start(intake, {
        accountEmail: accountEmailRef.current,
        fixture,
        priorCaseId: followUp?.priorCaseId,
        priorRound: followUp?.priorRound,
      });
    },
    [run]
  );

  const handleStart = useCallback(
    (intake: CaseIntake) => {
      const claim = caseIntakePrimaryText(intake);
      // 同句提醒只在历史已经可靠读到时出现；加载中不截断新提交。
      if (historyReady && !intake.links.length && !intake.images.length) {
        const match = cases.find((item) => item.status === "done" && normalizeHistoryClaim(item.claim) === normalizeHistoryClaim(claim));
        if (match) {
          setSameClaim({ id: match.id, claim: match.claim, at: match.createdAt, intake });
          return;
        }
      }
      beginRun(intake);
    },
    [cases, historyReady, beginRun]
  );

  const handleViewHomeCase = useCallback(
    (id: HomeCaseId) => {
      const opened = homeCaseSnapshot(id);
      if (!opened) return;
      run.reset();
      setSelectedRoundId(null);
      setSameClaim(null);
      setActive({
        localId: `home-${id}`,
        claim: opened.claim,
        intake: createCaseIntake(opened.claim, []),
        restored: { snapshot: opened.snapshot, report: null, at: opened.investigatedAt },
      });
      setMode("investigation");
    },
    [run]
  );

  const handleRecheckHomeCase = useCallback(
    (claim: string) => {
      beginRun(createCaseIntake(claim, []));
    },
    [beginRun]
  );

  const handleBackHome = useCallback(() => {
    // 从调查/旧报告返回首页时预填原句，方便改完再查（与旧壳一致）。
    setDraftClaim((prev) => active?.thread?.originalClaim ?? active?.claim ?? prev);
    setSelectedRoundId(null);
    setPendingFocus(null);
    run.reset();
    setActive(null);
    setMode("input");
  }, [active?.claim, run]);

  const handleRetry = useCallback(() => {
    if (!active) {
      handleBackHome();
      return;
    }
    const snapshot = active.restored?.snapshot ?? run.state.snapshot;
    beginRun(active.intake ?? createCaseIntake(active.claim, []), undefined, undefined,
      snapshot ? threadForRound(active, snapshot) : active.thread, "recheck");
  }, [active, beginRun, handleBackHome, run.state.snapshot]);

  const handleSelectCase = useCallback(
    async (id: string) => {
      const item = cases.find((entry) => entry.id === id);
      if (!item) return;
      setSelectedRoundId(null);
      setPendingFocus(null);
      // 本地在跑的那条：直接回到当前画布，不重新请求。
      if (item.status === "running" && active?.localId === id) {
        setMode("investigation");
        return;
      }
      const version = scopeVersion.current;
      // 1) 本地 KB 优先（匿名留存 / 登录后镜像）：零网络、零模型。
      try {
        const entry = await createKnowledgeBase(accountEmailRef.current).getCase(id);
        if (version !== scopeVersion.current) return;
        if (entry) {
          const snapshot = snapshotFromReport(entry.finalReport as Record<string, unknown>);
          if (snapshot) {
            run.reset();
            setActive({
              localId: id,
              claim: entry.claim,
              ...restoredThreadFields(entry.finalReport),
              intake: null,
              restored: { snapshot, report: entry.finalReport as Record<string, unknown>, at: entry.timestamp },
            });
            setMode("investigation");
            return;
          }
        }
      } catch {
        /* 本地未命中走服务端 */
      }
      // 2) 服务端旧调查（/api/case/:id 自带确定性重建的 investigation）。
      try {
        const res = await fetch(`/api/case/${encodeURIComponent(id)}`, { credentials: "include" });
        if (version !== scopeVersion.current) return;
        // 404/报错不能点了没反应：提示可见，条目状态不动（Change G）。
        if (!res.ok) {
          setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
          return;
        }
        const data = (await res.json()) as {
          claim?: string;
          report?: Record<string, unknown>;
          investigation?: InvestigationSnapshotV1;
          createdAt?: number;
        };
        let snapshot = data.investigation
          ? (() => {
              try {
                return validateInvestigationSnapshot(data.investigation);
              } catch {
                return undefined;
              }
            })()
          : snapshotFromReport(data.report);
        if (!snapshot) {
          // 无快照且重建失败：不伪造，保持原列表；但读不出内容同样是打开失败，要说出来。
          setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
          return;
        }
        run.reset();
        setActive({
          localId: id,
          claim: data.claim ?? item.claim,
          ...restoredThreadFields(data.report),
          intake: null,
          // 从服务端读回来的记录：分享的对象就是它。
          serverCaseId: id,
          restored: { snapshot, report: data.report ?? null, at: data.createdAt ?? item.createdAt },
        });
        setMode("investigation");
      } catch {
        // 网络中断/响应不可解析：同上，给反应而不是静默吞掉。
        setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
        return;
      }
    },
    [active?.localId, cases, lang, run]
  );

  const handleLogout = useCallback(async () => {
    const version = ++scopeVersion.current;
    try {
      const res = await fetch("/api/auth/email/logout", { method: "POST", credentials: "include" });
      if (!res.ok) {
        setHistoryNotice("退出失败，仍保留当前账户。请重试退出。");
        return;
      }
    } catch {
      setHistoryNotice("退出失败，仍保留当前账户。请重试退出。");
      return;
    }
    if (version !== scopeVersion.current) return;
    setAccount(null);
    accountEmailRef.current = null;
    run.reset();
    setActive(null);
    setSelectedRoundId(null);
    setPendingFocus(null);
    setMode("input");
    writeRunPointer(null);
    const local = await createKnowledgeBase(null).listCases();
    if (version !== scopeVersion.current) return;
    setCases(local.map((entry) => ({ id: entry.id, claim: entry.claim, status: "done" as const, createdAt: entry.timestamp, report: entry.finalReport as Record<string, unknown> })));
    setAccountOpen(false);
    setLoginOpen(false);
  }, []);

  const loginOverlay = loginOpen && !account ? (
    <div className="app-login-overlay">
      <LoginView
        onSuccess={() => {
          setLoginOpen(false);
          void hydrateAccountCases();
        }}
        onCancel={() => setLoginOpen(false)}
      />
    </div>
  ) : null;

  const accountOverlay = accountOpen && account ? (
    <div className="app-login-overlay">
      <AccountView
        account={account}
        onClose={() => setAccountOpen(false)}
        onSaved={setAccount}
        onDeleted={() => {
          setAccount(null);
          accountEmailRef.current = null;
          setAccountOpen(false);
          void createKnowledgeBase(null).listCases().then((local) => {
            setCases(local.map((entry) => ({ id: entry.id, claim: entry.claim, status: "done" as const, createdAt: entry.timestamp })));
          });
        }}
      />
    </div>
  ) : null;

  useEffect(() => {
    if (!pendingFocus || pendingFocus.runId !== run.state.runId) return;
    if (!["cancelled", "completed", "interrupted"].includes(run.state.serverStatus ?? "")) return;
    setPendingFocus(null);
    handleFollowUp(pendingFocus.question);
    // A focus change waits for the server terminal state, never just the POST acknowledgement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus, run.state.runId, run.state.serverStatus]);

  if (isModelSettingsPreviewRoute) {
    return <ModelProviderSettingsPreview />;
  }
  if (isApiKeySettingsRoute) {
    return <ApiKeySettings />;
  }
  if (window.location.pathname.startsWith("/s/")) {
    return (
      <main className="gp-share-unavailable" data-gp-share-unavailable>
        <h1>{copy.shareUnavailableTitle}</h1>
        <p>{copy.shareUnavailableBody}</p>
        <a href="/">{copy.backHome}</a>
      </main>
    );
  }

  const snapshot = active?.restored
    ? active.restored.snapshot
    : (() => {
        const s = run.state.snapshot;
        if (!s) return null;
        // 流失败但已有真实数据：按 interrupted 收口（保留数据、可重试）。
        // timeout_pending 后流结束且没有 finalReport：同样收口，不得停在 judging +「还在查」。
        // 连接仍活着时 timeoutPending 提示继续挂着，等晚到的 complete。
        const streamEndedWithoutReport =
          (run.state.connection === "failed" || run.state.connection === "ended") &&
          !run.state.finalReport;
        if (streamEndedWithoutReport && s.phase !== "complete" && s.phase !== "interrupted") {
          return interruptedInvestigationSnapshot(s, s.originalClaim);
        }
        return s;
      })();

  /**
   * 超时提示：只在连接还活着、这次调查还没拿到结果、也不是历史回看时出现。
   * 流已结束且没有报告 → 已按中断收口，不再说「还在查」。
   */
  const showTimeoutPending =
    !active?.restored &&
    run.state.timeoutPending &&
    !run.state.finalReport &&
    (run.state.connection === "live" || run.state.connection === "connecting");
  const showLinkUnreachable =
    mode === "investigation" && Boolean(active?.intake) && caseIntakeFailedLinks(active!.intake).length > 0;

  function handleFollowUp(question: string) {
      if (!active) return;
      const prevAnswer =
        previousAnswerText(
          (active.restored?.report ?? run.state.finalReport) as { conclusion?: string; memo?: string } | null
        ) || snapshot?.conclusion?.directAnswer || "";
      const composed = composeFollowUpClaim({
        originalClaim: active.thread?.originalClaim ?? active.claim,
        previousAnswer: prevAnswer,
        followUp: question,
      });
      beginRun(
        {
          text: composed,
          links: [],
          images: [],
          createdAt: Date.now(),
        },
        undefined,
        active.serverCaseId
          ? { priorCaseId: active.serverCaseId }
          : { priorRound: visiblePriorRoundFromSnapshot(snapshot) },
        snapshot ? threadForRound(active, snapshot) : active.thread,
        "follow-up",
      );
  }

  const archivedRound = selectedRoundId ? active?.thread?.rounds.find((round) => round.id === selectedRoundId) : undefined;
  const displaySnapshot = archivedRound?.snapshot ?? snapshot;
  const adjustFocus = (question: string) => {
    if (active?.restored || snapshot?.phase === "complete" || run.state.connection === "ended" || run.state.connection === "failed") {
      handleFollowUp(question);
      return;
    }
    if (!run.state.runId || pendingFocus) return;
    setPendingFocus({ question, runId: run.state.runId });
    void run.cancel().then((result) => {
      if (!result.ok) {
        setPendingFocus(null);
        setHistoryNotice("停止请求未送达，尚未开始按新重点核查。");
      }
    });
  };

  return (
    <>
      <ProductShell
        cases={cases}
        activeCaseId={active?.localId ?? null}
        historyReady={historyReady}
        onNewCase={handleBackHome}
        onSelectCase={(id) => void handleSelectCase(id)}
        account={account}
        onLoginClick={() => setLoginOpen(true)}
        onAccountClick={() => setAccountOpen(true)}
        onLogout={() => void handleLogout()}
        viewingInvestigation={mode === "investigation"}
      >
        {showLinkUnreachable ? (
          <p className="gp-global-notice" role="alert">
            {copy.linkUnreachableNotice}
          </p>
        ) : historyNotice ? (
          <p className="gp-global-notice" role="alert">{historyNotice}</p>
        ) : null}
        {sameClaim ? (
          <div className="gp-same-claim" role="dialog" aria-label={copy.sameClaimTitle}>
            <p className="gp-same-claim-title">{copy.sameClaimTitle}</p>
            <p className="gp-same-claim-text">{sameClaim.claim}</p>
            <p className="gp-same-claim-time">
              {sameClaim.at ? copy.oldCaseNotice(new Date(sameClaim.at).toLocaleString("zh-CN", { hour12: false })) : copy.oldCaseNotice(copy.unknownTime)}
            </p>
            <div className="gp-same-claim-actions">
              <button
                type="button"
                className="gp-primary-btn"
                onClick={() => {
                  const target = sameClaim;
                  setSameClaim(null);
                  void handleSelectCase(target.id);
                }}
              >
                {copy.sameClaimOpen}
              </button>
              <button
                type="button"
                className="gp-ghost-btn"
                onClick={() => {
                  const target = sameClaim;
                  setSameClaim(null);
                  beginRun(target.intake);
                }}
              >
                {copy.sameClaimRedo}
              </button>
              <button type="button" className="gp-ghost-btn" onClick={() => setSameClaim(null)}>
                {copy.cancel}
              </button>
            </div>
          </div>
        ) : null}
        {mode === "investigation" && active?.thread ? <InvestigationThreadHeader
          thread={active.thread}
          currentQuestion={displayFollowUpClaim(active.claim)}
          selectedRoundId={selectedRoundId}
          onSelect={setSelectedRoundId}
        /> : null}
        {mode === "input" ? (
          <>
            {!historyReady ? <p className="gp-global-notice" role="status">{copy.loadingHistory}</p> : null}
            <InputStage
              onSubmit={handleStart}
              initialClaim={draftClaim}
              accountEmail={account?.email ?? null}
              onNeedLogin={() => setLoginOpen(true)}
              onViewHomeCase={handleViewHomeCase}
              onRecheckHomeCase={handleRecheckHomeCase}
            />
          </>
        ) : active && displaySnapshot ? (
          <>
            {showTimeoutPending ? (
              <p className="gp-hint" role="status" data-gp-timeout-pending>
                {TIMEOUT_PENDING_NOTICE[lang]}
              </p>
            ) : null}
            <InvestigationCanvas
              key={archivedRound?.id ?? active.roundId ?? active.localId}
              snapshot={displaySnapshot}
              readOnly={Boolean(archivedRound)}
              onAdjustFocus={archivedRound ? undefined : adjustFocus}
              adjustingFocus={Boolean(pendingFocus)}
              live={archivedRound || active.restored ? false : run.state.connection === "connecting" || run.state.connection === "live"}
              activities={archivedRound || active.restored ? [] : run.state.activities}
              stop={archivedRound || active.restored ? "idle" : run.state.stop}
              onStop={archivedRound || active.restored || !run.state.runId ? undefined : () => void run.cancel()}
              saveStatus={saveStatus}
              onRetrySave={retrySave}
              shareCaseId={archivedRound ? null : active.serverCaseId ?? null}
              finalReport={archivedRound ? null : active.restored ? active.restored.report : run.state.finalReport}
              restoredAt={active.restored?.at}
              onReverify={handleRetry}
              onBackHome={handleBackHome}
              onFollowUp={archivedRound ? undefined : handleFollowUp}
              linkUnreachable={caseIntakeFailedLinks(active.intake).length > 0}
            />
          </>
        ) : showTimeoutPending ? (
          <p className="gp-hint" role="status" data-gp-timeout-pending>
            {TIMEOUT_PENDING_NOTICE[lang]}
          </p>
        ) : (
          <p className="gp-waiting" role="status">
            {run.state.connection === "failed" && !snapshot && !showLinkUnreachable
              ? publicTransportError(run.state.errorMessage, copy.connectionLost)
              : "正在拆解这句话…"}
          </p>
        )}
      </ProductShell>
      {loginOverlay}
      {accountOverlay}
    </>
  );
}

export default function App() {
  const isLegacyRoute = new URLSearchParams(window.location.search).get("legacy") === "1";
  if (isLegacyRoute) {
    return (
      <Suspense fallback={null}>
        <LegacyDesk />
      </Suspense>
    );
  }
  return (
    <ReasoningProvider>
      <ProductApp />
    </ReasoningProvider>
  );
}
