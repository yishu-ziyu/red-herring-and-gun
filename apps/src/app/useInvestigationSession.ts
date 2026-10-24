/**
 * 当前这次调查的会话：提交、追问、重新核查、打开历史、刷新接回、结果落库都在这里。
 * 界面只读 view 和 canvas，不自己再从连接状态推导「结束了没有」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InvestigationSnapshotV1 } from "../../shared/investigation";
import { composeFollowUpClaim, visiblePriorRoundFromSnapshot, type VisiblePriorRound } from "../../shared/followUp";
import type { InvestigationRound, InvestigationThread } from "../../shared/investigationThread";
import { caseIntakeFailedLinks, caseIntakeIsImageOnly, createCaseIntake, type CaseImage, type CaseIntake } from "../lib/caseIntake";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "../goldenPath/copy";
import { useInvestigationRun, type StopPhase } from "../goldenPath/useInvestigationRun";
import {
  newActiveCase,
  reportAnswerText,
  threadWithRound,
  useCaseHistory,
  type ActiveCase,
  type SaveStatus,
} from "./caseHistory";
import { HISTORY_OPEN_FAILED_NOTICE } from "./notices";
import { activeCaseFromPointer, pointerForRun, readRunPointer, writeRunPointer } from "./runPointer";
import { sessionView, type SessionView } from "./sessionView";

const HOME: SessionView = { kind: "home" };

export type SessionCanvas = {
  snapshot: InvestigationSnapshotV1;
  /** 同一轮内保持不变，换轮或换案件才重新挂载。 */
  key: string;
  /** 回看线程里的旧轮：只读。 */
  readOnly: boolean;
  stop: StopPhase;
  canStop: boolean;
  saveStatus: SaveStatus;
  restoredAt?: number;
  images?: CaseImage[];
  shareRunId?: string;
  startedAt?: number;
};

export function useInvestigationSession() {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const history = useCaseHistory();
  const { state, start: startRun, reset: resetRun, cancel, resume } = useInvestigationRun();
  const { ready: historyReady, markRunning, retitle, open, saveRound } = history;

  const [active, setActive] = useState<ActiveCase | null>(null);
  const [draftClaim, setDraftClaim] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [historyNotice, setHistoryNotice] = useState("");
  const [initialPointer] = useState(readRunPointer);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = active?.localId ?? null;
  const resumedRef = useRef(false);
  const persistedRoundRef = useRef<string | null>(null);

  /** 带上这一轮在服务端的调查编号：重新打开的历史读存下的，正在跑的读 run。 */
  const current = useMemo(
    () => (active && !active.restored ? { ...active, runId: state.runId ?? undefined } : active),
    [active, state.runId]
  );
  const live = useMemo<SessionView>(
    () => (active ? sessionView(state, active, copy.connectionLost) : HOME),
    [state, active, copy.connectionLost]
  );
  const liveSnapshot = "snapshot" in live ? live.snapshot : null;
  const linkUnreachable = caseIntakeFailedLinks(active?.intake).length > 0;
  const archivedRound = selectedRoundId ? active?.thread?.rounds.find((round) => round.id === selectedRoundId) : undefined;
  const view: SessionView = archivedRound ? { kind: "settled", snapshot: archivedRound.snapshot, report: null } : live;

  const begin = useCallback(
    (intake: CaseIntake, roundKind: InvestigationRound["kind"], previousThread?: InvestigationThread, priorRound?: VisiblePriorRound | null) => {
      resumedRef.current = true;
      setSelectedRoundId(null);
      setSaveStatus("idle");
      setHistoryNotice("");
      setDraftClaim("");
      const next = newActiveCase(intake, roundKind, previousThread);
      setActive(next);
      markRunning(next);
      startRun(intake, { priorRound, ...(roundKind === "recheck" ? { kind: "recheck" as const } : {}) });
    },
    [markRunning, startRun]
  );

  const start = useCallback((intake: CaseIntake) => begin(intake, "initial"), [begin]);

  const followUp = useCallback(
    (question: string) => {
      if (!current) return;
      const report = live.kind === "settled" ? live.report : null;
      const composed = composeFollowUpClaim({
        originalClaim: current.thread?.originalClaim ?? current.claim,
        previousAnswer: liveSnapshot?.conclusion?.directAnswer || reportAnswerText(report) || "",
        followUp: question,
      });
      begin(
        { text: composed, links: [], images: [], createdAt: Date.now() },
        "follow-up",
        liveSnapshot ? threadWithRound(current, liveSnapshot) : current.thread,
        visiblePriorRoundFromSnapshot(liveSnapshot)
      );
    },
    [begin, current, live, liveSnapshot]
  );

  const goHome = useCallback(() => {
    // 从调查/旧报告返回首页时预填原句，方便改完再查。只交了图片时没有可预填的原句。
    setDraftClaim((prev) => (caseIntakeIsImageOnly(active?.intake) ? "" : active?.thread?.originalClaim ?? active?.claim ?? prev));
    setSelectedRoundId(null);
    resetRun();
    setActive(null);
  }, [active, resetRun]);

  /** 普通提交与重新核查都启动新一轮；旧结果由历史入口打开。 */
  const recheck = useCallback(() => {
    if (!current) {
      goHome();
      return;
    }
    begin(
      current.intake ?? createCaseIntake(current.claim, []),
      "recheck",
      liveSnapshot ? threadWithRound(current, liveSnapshot) : current.thread
    );
  }, [begin, current, goHome, liveSnapshot]);

  const openCase = useCallback(
    async (id: string) => {
      const item = history.cases.find((entry) => entry.id === id);
      if (!item) return;
      setSelectedRoundId(null);
      // 本地在跑的那条：直接回到当前画布，不重新请求。
      if (item.status === "running" && active?.localId === id) return;
      const opened = await open(id);
      // 读不到或读不出内容不能点了没反应：提示可见，条目状态不动。
      if (!opened) {
        setHistoryNotice(HISTORY_OPEN_FAILED_NOTICE[lang]);
        return;
      }
      resetRun();
      setActive(opened);
    },
    [active?.localId, history.cases, lang, open, resetRun]
  );

  const reconnect = useCallback(() => {
    if (state.runId) resume(state.runId, state.lastActivitySeq, active?.claim ?? "");
  }, [active?.claim, resume, state.lastActivitySeq, state.runId]);

  /** 落库一次（本机）。保存失败不挡结果，但必须可见。 */
  const persist = useCallback(
    async (target: ActiveCase, snapshot: InvestigationSnapshotV1, report: Record<string, unknown> | null) => {
      const status = await saveRound(target, snapshot, report);
      // 落库是异步的，期间用户可能换了案件：迟到的结果不改当前界面的保存状态。
      if (status === "failed") setHistoryNotice("调查自动保存失败，刷新后可能无法找回。请先保留当前报告。");
      if (activeIdRef.current === target.localId) setSaveStatus(status);
    },
    [saveRound]
  );

  /** 重试保存：用当前这份结果再走一遍，不重新调查。 */
  const retrySave = useCallback(() => {
    if (current && live.kind === "settled") void persist(current, live.snapshot, live.report);
  }, [current, live, persist]);

  // 刷新恢复：本地留过一条没跑完的 run，就接回去读它的状态与已有材料。
  // 不重开调查，也不重复扣额。只跑一次；用户已经自己开了一次调查就不再接回旧座标。
  useEffect(() => {
    if (resumedRef.current || !historyReady) return;
    resumedRef.current = true;
    if (!initialPointer) return;
    setActive(activeCaseFromPointer(initialPointer));
    resume(initialPointer.runId, initialPointer.lastSeq, initialPointer.claim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyReady]);

  // 记录进行中那条 run 的座标；终态或回首页时清掉。
  // 接不回去且还没有任何材料：清座标、回输入页，在输入框上方说明原因（例如图片读不出来），用户可以直接重新提交。
  // 否则刷新会反复钉在「连接中断」，页面也会一直停在「正在拆解」。
  useEffect(() => {
    if (!active || active.restored) {
      writeRunPointer(null);
      return;
    }
    if (live.kind === "waiting" && live.failure !== null) {
      writeRunPointer(null);
      // 刚提交、链接打不开、调查已开始：留下调查态和链接提示。
      // 连接中断是空流/无快照的副作用，不能盖掉这次提交自己的提示。
      if (linkUnreachable) return;
      setHistoryNotice(live.failure);
      setActive(null);
      return;
    }
    if (!state.runId) return;
    if (state.connection === "ended" || state.stop === "stopped") {
      writeRunPointer(null);
      return;
    }
    writeRunPointer(pointerForRun(active, state.runId, state.lastActivitySeq));
  }, [active, live, linkUnreachable, state.runId, state.lastActivitySeq, state.connection, state.stop]);

  // 这一轮有了定论就留存到本机；同一轮同一种定论只存一次。
  useEffect(() => {
    if (!current || current.restored || live.kind !== "settled") return;
    const { snapshot, report } = live;
    const outcome = report || snapshot.phase !== "interrupted" ? "report" : "interrupted";
    const key = `${current.roundId ?? current.localId}:${outcome}`;
    if (persistedRoundRef.current === key) return;
    persistedRoundRef.current = key;
    void persist(current, snapshot, report);
  }, [current, live, persist]);

  // 只交了图片：读出图里的文字之后，历史标题和轮次标题都换成这段文字（快照里的原文），不显示请求句。
  const imageOnlyText = !active?.restored && caseIntakeIsImageOnly(active?.intake) ? state.snapshot?.originalClaim : undefined;
  useEffect(() => {
    if (!active || !imageOnlyText || active.claim === imageOnlyText) return;
    const localId = active.localId;
    setActive((prev) => prev && prev.localId === localId
      ? {
          ...prev,
          claim: imageOnlyText,
          thread: prev.thread && prev.thread.rounds.length === 0 ? { ...prev.thread, originalClaim: imageOnlyText } : prev.thread,
        }
      : prev);
    retitle(localId, imageOnlyText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageOnlyText, active?.localId]);

  const frozen = Boolean(archivedRound || active?.restored);
  const canvasSnapshot = "snapshot" in view ? view.snapshot : null;
  const canvas: SessionCanvas | null = active && current && canvasSnapshot
    ? {
        snapshot: canvasSnapshot,
        key: archivedRound?.id ?? active.roundId ?? active.localId,
        readOnly: Boolean(archivedRound),
        stop: frozen ? "idle" : state.stop,
        canStop: !frozen && Boolean(state.runId),
        saveStatus,
        restoredAt: view.kind === "settled" ? view.restoredAt : undefined,
        images: frozen ? undefined : active.intake?.images,
        shareRunId: archivedRound ? archivedRound.runId : current.runId,
        startedAt: frozen ? undefined : state.startedAt ?? undefined,
      }
    : null;

  const banner = linkUnreachable
    ? copy.linkUnreachableNotice
    : state.notice && active
      ? state.notice
      : historyNotice || null;

  return {
    view,
    canvas,
    banner,
    linkUnreachable,
    cases: history.cases,
    historyReady,
    activeCaseId: active?.localId ?? null,
    draftClaim,
    thread: active?.thread ?? null,
    selectedRoundId,
    selectRound: setSelectedRoundId,
    start,
    followUp,
    recheck,
    openCase,
    goHome,
    cancel: () => void cancel(),
    reconnect,
    retrySave,
  };
}
