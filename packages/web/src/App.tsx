import { useEffect, useState } from "react";
import { ThreadView } from "./case/ThreadView.js";
import { listCases, type CaseListItem } from "./lib/api.js";
import { fixtureNameOf } from "./lib/catalog.js";
import { MEMO_USER, STATUS } from "./lib/copy.js";
import { clearOpening, readOpening } from "./lib/opening.js";
import { summaryLine } from "./lib/select.js";
import { useCaseStream } from "./lib/useCaseStream.js";
import { useRoute } from "./lib/useRoute.js";
import { CasePanel } from "./pages/CasePage.js";
import { HomePage } from "./pages/HomePage.js";
import { SearchSettings } from "./pages/SearchSettings.js";
import { AppShell, fixtureNavItems } from "./shell/AppShell.js";

export function App() {
  const { route, navigate } = useRoute();
  const caseId = route.page === "case" ? route.caseId : "";
  const stream = useCaseStream(caseId);
  const [cases, setCases] = useState<CaseListItem[]>(() =>
    fixtureNameOf(caseId) ? fixtureNavItems() : [],
  );
  const [flashClaim, setFlashClaim] = useState<string | null>(null);

  useEffect(() => {
    if (fixtureNameOf(caseId)) {
      setCases(fixtureNavItems());
      return;
    }
    void listCases()
      .then(setCases)
      .catch(() => setCases([]));
  }, [caseId]);

  const current = stream.case;
  const openingText = current ? null : readOpening(caseId);
  const summary = {
    line: summaryLine(current, stream.running, stream.aborted, openingText ?? undefined),
  };

  useEffect(() => {
    if (current) clearOpening();
  }, [current]);

  useEffect(() => {
    if (!flashClaim) return;
    const id = window.setTimeout(() => setFlashClaim(null), 1000);
    return () => window.clearTimeout(id);
  }, [flashClaim]);

  function onFocusClaim(claimId: string) {
    const el = document.querySelector(`[data-claim-item="${claimId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashClaim(claimId);
  }

  if (route.page === "settings") {
    return <SearchSettings onBack={() => navigate("/")} />;
  }

  if (route.page === "home") {
    return (
      <HomePage
        onCreated={(id) => navigate(`/cases/${id}`)}
        onOpenCase={(id) => navigate(`/cases/${id}`)}
        onSettings={() => navigate("/settings")}
      />
    );
  }

  return (
    <AppShell
      activeId={caseId || undefined}
      cases={cases}
      summary={summary}
      panel={
        current ? (
          <CasePanel current={current} running={stream.running} aborted={stream.aborted} onFocusClaim={onFocusClaim} />
        ) : (
          <p className="muted">{STATUS.decomposing}</p>
        )
      }
      onOpen={(id) => navigate(`/cases/${id}`)}
      onHome={() => navigate("/")}
    >
      {current ? (
        <ThreadView
          current={current}
          running={stream.running}
          aborted={stream.aborted}
          status={stream.status}
          error={stream.error}
          flashClaim={flashClaim}
          onSend={stream.sendTurn}
          onAbort={stream.abort}
        />
      ) : (
        <div className="thread">
          <div className="thread-body">
            {openingText ? (
              <article className="memo-user font-serif">
                <p className="bubble-meta">{MEMO_USER}</p>
                <p>{openingText}</p>
              </article>
            ) : null}
            <p className="status-line">
              <span className="wait-ring" aria-hidden />
              {stream.error ?? STATUS.decomposing}
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
