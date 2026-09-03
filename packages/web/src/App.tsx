import { useEffect, useState } from "react";
import { ThreadView } from "./case/ThreadView.js";
import { listCases, type CaseListItem } from "./lib/api.js";
import { fixtureNameOf } from "./lib/catalog.js";
import { latestStatus } from "./lib/select.js";
import { faceWord } from '@rhg/core/publicCopy';
import { useCaseStream } from "./lib/useCaseStream.js";
import { useRoute } from "./lib/useRoute.js";
import { CasePanel } from "./pages/CasePage.js";
import { HomePage } from "./pages/HomePage.js";
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
  const summary = {
    face: current?.overall ? faceWord(current.overall.verdictType) : "—",
    score: current?.overall?.score,
    status: current ? latestStatus(current, stream.running, stream.aborted) : "—",
  };

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

  return (
    <AppShell
      activeId={caseId || undefined}
      cases={cases}
      summary={summary}
      panel={
        current ? (
          <CasePanel current={current} running={stream.running} aborted={stream.aborted} onFocusClaim={onFocusClaim} />
        ) : (
          <p className="muted">还没有案件</p>
        )
      }
      onOpen={(id) => navigate(`/cases/${id}`)}
      onHome={() => navigate("/")}
    >
      {route.page === "home" ? (
        <HomePage
          onCreated={(id) => navigate(`/cases/${id}`)}
          onOpenCase={(id) => navigate(`/cases/${id}`)}
        />
      ) : current ? (
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
        <p className="muted">{stream.error ?? "正在打开案件"}</p>
      )}
    </AppShell>
  );
}
