/**
 * 应用入口：按调查会话的当前视图选择显示什么。
 */
import { useLayoutEffect } from "react";
import { ProductShell } from "./goldenPath/ProductShell";
import { InputStage } from "./goldenPath/InputStage";
import { InvestigationCanvas } from "./goldenPath/InvestigationCanvas";
import { InvestigationThreadHeader } from "./goldenPath/InvestigationThreadHeader";
import { gpCopyFor } from "./goldenPath/copy";
import { useUiLang } from "./lib/useUiLang";
import { TIMEOUT_PENDING_NOTICE } from "./app/notices";
import { useInvestigationSession } from "./app/useInvestigationSession";

export default function App() {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const session = useInvestigationSession();
  const { view, canvas, thread } = session;
  const home = view.kind === "home";

  // 从首页进入调查时回到页顶：首页滚到案例区再点开，结论不能被沿用的滚动位置挤出视口。
  // 只看首页/调查切换；追问、保存后换 caseId 都发生在调查态内部，不跳。
  useLayoutEffect(() => {
    if (!home) window.scrollTo(0, 0);
  }, [home]);

  if (window.location.pathname.startsWith("/s/")) {
    return (
      <main className="gp-share-unavailable gp-column" data-gp-share-unavailable>
        <h1>{copy.shareUnavailableTitle}</h1>
        <p>{copy.shareUnavailableBody}</p>
        <a href="/">{copy.backHome}</a>
      </main>
    );
  }

  const timeoutPending = view.kind === "timeoutPending" ? (
    <p className="gp-global-notice gp-column" role="status" data-gp-timeout-pending>
      {TIMEOUT_PENDING_NOTICE[lang]}
    </p>
  ) : null;

  return (
    <ProductShell
      cases={session.cases}
      activeCaseId={session.activeCaseId}
      historyReady={session.historyReady}
      onNewCase={session.goHome}
      onSelectCase={(id) => void session.openCase(id)}
      viewingInvestigation={!home}
    >
      {view.kind === "disconnected" ? (
        <p className="gp-global-notice gp-column" role="status" data-gp-disconnected>
          {view.runId
            ? "连接已断开，调查可能仍在继续。下面保留的是断线前收到的内容。"
            : "连接已断开，尚未收到调查编号，无法确认请求是否已经开始。"}
          {view.runId ? <button type="button" className="gp-link-btn" onClick={session.reconnect}>
            重新连接这次调查
          </button> : null}
        </p>
      ) : view.kind === "reconnecting" ? <p className="gp-global-notice gp-column" role="status">正在重新连接这次调查…</p> : null}
      {session.banner ? <p className="gp-global-notice gp-column" role="alert">{session.banner}</p> : null}
      {thread ? <InvestigationThreadHeader
        thread={thread}
        selectedRoundId={session.selectedRoundId}
        onSelect={session.selectRound}
      /> : null}
      {home ? (
        <>
          {!session.historyReady ? <p className="gp-global-notice gp-column" role="status">{copy.loadingHistory}</p> : null}
          <InputStage
            onSubmit={session.start}
            initialClaim={session.draftClaim}
          />
        </>
      ) : canvas ? (
        <>
          {timeoutPending}
          <InvestigationCanvas
            key={canvas.key}
            snapshot={canvas.snapshot}
            connectionUnavailable={view.kind === "disconnected" || view.kind === "reconnecting"}
            readOnly={canvas.readOnly}
            stop={canvas.stop}
            onStop={canvas.canStop ? session.cancel : undefined}
            saveStatus={canvas.saveStatus}
            onRetrySave={session.retrySave}
            restoredAt={canvas.restoredAt}
            onReverify={session.recheck}
            onFollowUp={canvas.readOnly ? undefined : session.followUp}
            linkUnreachable={session.linkUnreachable}
            images={canvas.images}
            shareRunId={canvas.shareRunId}
            startedAt={canvas.startedAt}
          />
        </>
      ) : timeoutPending ?? (
        <p className="gp-waiting gp-column" role="status">
          {view.kind === "disconnected" || view.kind === "reconnecting"
            ? "尚未收到新的调查内容。"
            : view.kind === "waiting" && view.failure !== null && !session.linkUnreachable
              ? view.failure
              : "正在拆分这句话…"}
        </p>
      )}
    </ProductShell>
  );
}
