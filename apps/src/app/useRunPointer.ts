/**
 * 刷新接回：本机留着一条没跑完的 run，就在历史读好之后接回去（只跑一次，不重开调查、不重复扣额）；
 * 进行中持续记下它的座标，终态或回首页时清掉。
 */
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { useInvestigationRun } from "../goldenPath/useInvestigationRun";
import { caseIntakeFailedLinks } from "../lib/caseIntake";
import { readInvestigationThread } from "../lib/investigationThread";
import type { ActiveCase, ProductMode } from "./caseViews";
import { publicTransportError } from "./notices";
import { readRunPointer, writeRunPointer } from "./runPointer";

export function useRunPointer(args: {
  historyReady: boolean;
  mode: ProductMode;
  active: ActiveCase | null;
  run: ReturnType<typeof useInvestigationRun>;
  accountEmailRef: MutableRefObject<string | null>;
  copy: { connectionLost: string };
  setActive: Dispatch<SetStateAction<ActiveCase | null>>;
  setMode: Dispatch<SetStateAction<ProductMode>>;
  setHistoryNotice: Dispatch<SetStateAction<string>>;
}) {
  const { historyReady, mode, active, run, accountEmailRef, copy, setActive, setMode, setHistoryNotice } = args;
  const [initialRunPointer] = useState(readRunPointer);
  const resumedRef = useRef(false);

  // 刷新恢复：本地留过一条没跑完的 run，就接回去读它的状态与已有材料。
  // 不重开调查，也不重复扣额。只跑一次。
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
  // 接不回去且还没有任何材料：清座标、回输入页，在输入框上方说明原因（例如图片读不出来），用户可以直接重新提交。
  // 否则刷新会反复钉在「连接中断」，页面也会一直停在「正在拆解」。流已结束却既没有快照也没有结果，同样按失败处理。
  useEffect(() => {
    if (mode !== "investigation" || active?.restored) {
      writeRunPointer(null);
      return;
    }
    const endedEmpty = run.state.connection === "ended" && !run.state.finalReport;
    if ((run.state.connection === "failed" || endedEmpty) && !run.state.snapshot) {
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
  }, [mode, active, copy.connectionLost, run.state.runId, run.state.lastActivitySeq, run.state.connection, run.state.stop, run.state.snapshot, run.state.errorMessage, run.state.finalReport]);

  /** 用户已经自己开了一次调查：之后不再接回旧座标。 */
  return { resumedRef };
}
