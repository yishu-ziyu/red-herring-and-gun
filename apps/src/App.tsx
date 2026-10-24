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
      {copy.timeoutPending}
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
          {view.runId ? copy.disconnectedWithRun : copy.disconnectedNoRun}
          {view.runId ? <button type="button" className="gp-link-btn" onClick={session.reconnect}>
            {copy.reconnect}
          </button> : null}
        </p>
      ) : view.kind === "reconnecting" ? <p className="gp-global-notice gp-column" role="status">{copy.reconnecting}</p> : null}
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
            ? copy.noNewContent
            : view.kind === "waiting" && view.failure !== null && !session.linkUnreachable
              ? view.failure
              : copy.splittingWait}
        </p>
      )}
    </ProductShell>
  );
}
