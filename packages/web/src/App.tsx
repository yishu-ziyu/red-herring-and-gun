import { useEffect, useState } from "react";
import { listCases, type CaseListItem } from "./lib/api.js";
import { fixtureNameOf } from "./lib/catalog.js";
import { statusWord } from "./lib/copy.js";
import { faceWord } from '@rhg/core/publicCopy';
import { useCaseStream } from "./lib/useCaseStream.js";
import { useRoute } from "./lib/useRoute.js";
import { CasePanel, ThreadView } from "./pages/CasePage.js";
import { HomePage } from "./pages/HomePage.js";
import { AppShell, fixtureNavItems } from "./shell/AppShell.js";

export function App() {
  const { route, navigate } = useRoute();
  const caseId = route.page === "case" ? route.caseId : "";
  const stream = useCaseStream(caseId);
  const [cases, setCases] = useState<CaseListItem[]>(() =>
    fixtureNameOf(caseId) ? fixtureNavItems() : [],
  );

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
    status: current ? statusWord(current, stream.running) : "—",
  };

  return (
    <AppShell
      activeId={caseId || undefined}
      cases={cases}
      summary={summary}
      panel={current ? <CasePanel current={current} running={stream.running} /> : <p className="muted">还没有案件</p>}
      onOpen={(id) => navigate(`/cases/${id}`)}
      onHome={() => navigate("/")}
    >
      {route.page === "home" ? (
        <HomePage onCreated={(id) => navigate(`/cases/${id}`)} />
      ) : current ? (
        <ThreadView
          current={current}
          running={stream.running}
          status={stream.status}
          error={stream.error}
          onSend={stream.sendTurn}
          onAbort={stream.abort}
        />
      ) : (
        <p className="muted">{stream.error ?? "正在打开案件"}</p>
      )}
    </AppShell>
  );
}
