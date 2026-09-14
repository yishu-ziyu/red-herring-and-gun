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
import { caseIntakeFailedLinks, caseIntakePrimaryText, type CaseIntake } from "./lib/caseIntake";
import { createKnowledgeBase, normalizeHistoryClaim } from "./lib/knowledgeBase";
import type { KnowledgeBaseEntry } from "./lib/schemas";
import { composeFollowUpClaim, previousAnswerText } from "./lib/composeFollowUpClaim";
import { visiblePriorRoundFromSnapshot } from "./lib/priorRoundBrief";

const LegacyDesk = lazy(() =>
  import("./legacy/LegacyDesk").then((module) => ({ default: module.default }))
);

type ProductMode = "input" | "investigation";

type ActiveCase = {
  localId: string;
  claim: string;
  intake: CaseIntake | null;
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
};

/** 进行中那条 run 在本地留的座标：刷新后靠它接回去，而不是重开一次调查。 */
type SaveStatus = "idle" | "local" | "syncing" | "synced" | "failed";

type StoredRunPointer = {
  runId: string;
  claim: string;
  intake: CaseIntake | null;
  lastSeq: number;
  at: number;
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
    claim: item.claim,
    status: item.status === "interrupted" ? "interrupted" : item.status === "done" ? "done" : "running",
    createdAt: item.createdAt,
  }));
}

function ProductApp() {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [mode, setMode] = useState<ProductMode>("input");
  const [active, setActive] = useState<ActiveCase | null>(null);
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
        setCases(toShellCases(Array.isArray(list.cases) ? list.cases : []));
      }
      const local = await createKnowledgeBase(accountEmailRef.current).listCases();
      if (version !== scopeVersion.current) return;
      setCases((prev) => {
        const localItems: ShellCase[] = local.map((entry) => ({
          id: entry.id,
          claim: entry.claim,
          status: "done" as const,
          createdAt: entry.timestamp,
          report: entry.finalReport as Record<string, unknown>,
        }));
        const ids = new Set(localItems.map((item) => item.id));
        return [...localItems, ...prev.filter((item) => !ids.has(item.id))];
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
    if (resumedRef.current) return;
    resumedRef.current = true;
    const pointer = readRunPointer();
    if (!pointer) return;
    setActive({ localId: `case-${pointer.at}`, claim: pointer.claim, intake: pointer.intake, restored: null });
    setMode("investigation");
    run.resume(pointer.runId, pointer.lastSeq, pointer.claim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 记录进行中那条 run 的座标；终态或回首页时清掉。
  // 接不回去且还没有任何材料：清座标、回输入页。否则刷新会反复钉在「连接中断」。
  useEffect(() => {
    if (mode !== "investigation" || active?.restored) {
      writeRunPointer(null);
      return;
    }
    if (run.state.connection === "failed" && !run.state.snapshot) {
      writeRunPointer(null);
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
      setSaveStatus("syncing");
      const knowledgeBase = createKnowledgeBase(accountEmailRef.current);
      const entry: KnowledgeBaseEntry = {
        id: localId,
        claim,
        rumorType: "深度核查",
        diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
        finalReport: report,
        handoffSteps: [],
        credibilityScore: typeof report.credibilityScore === "number" ? report.credibilityScore : 50,
        timestamp: doneAt,
        tags: ["golden-path"],
      };
      try {
        await knowledgeBase.saveCase(entry);
      } catch (error) {
        console.error("[cases] 案例写入本地知识库失败", error);
        setHistoryNotice("调查自动保存失败，刷新后可能无法找回。请先保留当前报告。");
        setSaveStatus("failed");
        return;
      }
      setSaveStatus("local");
      if (!accountEmailRef.current) return;
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
          setSaveStatus("failed");
          return;
        }
        setSaveStatus("synced");
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
        setSaveStatus("failed");
      }
    },
    [copy.historySyncFailed]
  );

  /** 重试同步：用当前这份结果再走一遍，不重新调查。 */
  const retrySave = useCallback(() => {
    const report = run.state.finalReport;
    if (!report || !active) return;
    void persistResult(report, active.localId, active.claim);
  }, [active, persistResult, run.state.finalReport]);

  // 完成：本地留存 +（已登录）服务端落库。保存失败不挡结果，但必须可见。
  useEffect(() => {
    const report = run.state.finalReport;
    if (!report || mode !== "investigation" || active?.restored) return;
    const doneAt = Date.now();
    const localId = active?.localId ?? `case-${doneAt}`;
    const claim = active?.claim ?? "";
    setCases((prev) => [
      { id: localId, claim, status: report._source === "error-boundary" ? ("interrupted" as const) : ("done" as const), createdAt: doneAt },
      ...prev.filter((item) => item.id !== localId),
    ]);
    void persistResult(report, localId, claim);
    // 只在 finalReport 首次出现时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.state.finalReport]);

  /** 无守卫直接开跑：同句守卫的「重新核查」与普通提交共用。 */
  const beginRun = useCallback(
    (
      intake: CaseIntake,
      fixture?: NonNullable<Parameters<ReturnType<typeof useInvestigationRun>["start"]>[1]>["fixture"],
      // 追问：登录带 caseId；访客带上一轮可见材料。首轮不传。
      followUp?: Pick<StartOptions, "priorCaseId" | "priorRound">
    ) => {
      setSameClaim(null);
      setDraftClaim("");
      const claim = caseIntakePrimaryText(intake);
      const localId = `case-${Date.now()}`;
      setActive({ localId, claim, intake });
      setCases((prev) => [{ id: localId, claim, status: "running" as const }, ...prev.filter((item) => item.id !== localId)]);
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

  const handleBackHome = useCallback(() => {
    // 从调查/旧报告返回首页时预填原句，方便改完再查（与旧壳一致）。
    setDraftClaim((prev) => active?.claim ?? prev);
    run.reset();
    setActive(null);
    setMode("input");
  }, [active?.claim, run]);

  const handleRetry = useCallback(() => {
    if (!active?.intake) {
      handleBackHome();
      return;
    }
    run.start(active.intake, { accountEmail: accountEmailRef.current });
  }, [active, handleBackHome, run]);

  const handleSelectCase = useCallback(
    async (id: string) => {
      const item = cases.find((entry) => entry.id === id);
      if (!item) return;
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

  if (isModelSettingsPreviewRoute) {
    return <ModelProviderSettingsPreview />;
  }
  if (isApiKeySettingsRoute) {
    return <ApiKeySettings />;
  }

  const snapshot = active?.restored
    ? active.restored.snapshot
    : (() => {
        const s = run.state.snapshot;
        if (!s) return null;
        // 流失败但已有真实数据：按 interrupted 呈现（保留数据、无伪结论、可重试）。
        // 例外（Change C）：超时之后的断线不是调查失败——服务端管线仍在跑，结论经刷新可取回；
        // 这时候说「没查完」是假话，界面上有超时提示说明真实状态。
        if (
          run.state.connection === "failed" &&
          !run.state.timeoutPending &&
          s.phase !== "complete" &&
          s.phase !== "interrupted"
        ) {
          return { ...s, phase: "interrupted" as const };
        }
        return s;
      })();

  /**
   * 超时提示（Change C）：只在「这次调查还没拿到结果、也不是历史回看」时出现。
   * 真结果一到（finalReport 或 error 翻成中断态）就退场，不与结论或中断文案并列。
   */
  const showTimeoutPending = !active?.restored && run.state.timeoutPending && !run.state.finalReport;
  const showLinkUnreachable =
    mode === "investigation" && Boolean(active?.intake) && caseIntakeFailedLinks(active!.intake).length > 0;

  const handleFollowUp = useCallback(
    (question: string) => {
      if (!active) return;
      const prevAnswer =
        previousAnswerText(
          (active.restored?.report ?? run.state.finalReport) as { conclusion?: string; memo?: string } | null
        ) || snapshot?.conclusion?.directAnswer || "";
      const composed = composeFollowUpClaim({
        originalClaim: active.claim,
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
          : { priorRound: visiblePriorRoundFromSnapshot(snapshot) }
      );
    },
    [active, run.state.finalReport, snapshot, beginRun]
  );

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
        {historyNotice ? <p className="gp-global-notice" role="alert">{historyNotice}</p> : null}
        {showLinkUnreachable ? (
          <p className="gp-global-notice" role="alert">
            {copy.linkUnreachableNotice}
          </p>
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
        {mode === "input" ? (
          <>
            {!historyReady ? <p className="gp-global-notice" role="status">{copy.loadingHistory}</p> : null}
            <InputStage
              onSubmit={handleStart}
              initialClaim={draftClaim}
              accountEmail={account?.email ?? null}
              onNeedLogin={() => setLoginOpen(true)}
            />
          </>
        ) : active && snapshot ? (
          <>
            {showTimeoutPending ? (
              <p className="gp-hint" role="status" data-gp-timeout-pending>
                {TIMEOUT_PENDING_NOTICE[lang]}
              </p>
            ) : null}
            <InvestigationCanvas
              snapshot={snapshot}
              live={active.restored ? false : run.state.connection === "connecting" || run.state.connection === "live"}
              activities={active.restored ? [] : run.state.activities}
              stop={active.restored ? "idle" : run.state.stop}
              onStop={active.restored || !run.state.runId ? undefined : () => void run.cancel()}
              saveStatus={saveStatus}
              onRetrySave={retrySave}
              shareCaseId={active.serverCaseId ?? null}
              finalReport={active.restored ? active.restored.report : run.state.finalReport}
              restoredAt={active.restored?.at}
              onReverify={handleRetry}
              onBackHome={handleBackHome}
              onFollowUp={handleFollowUp}
              linkUnreachable={caseIntakeFailedLinks(active.intake).length > 0}
            />
          </>
        ) : showTimeoutPending ? (
          <p className="gp-hint" role="status" data-gp-timeout-pending>
            {TIMEOUT_PENDING_NOTICE[lang]}
          </p>
        ) : (
          <p className="gp-waiting" role="status">
            {run.state.connection === "failed" && !snapshot
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
