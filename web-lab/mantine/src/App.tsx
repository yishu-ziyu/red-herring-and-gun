// 页面切换照抄 Mantine AppShell 基本布局（https://mantine.dev/core/app-shell/ 「Basic usage」），每个部分可由 ?part= 直接到达。
import { useCallback, useEffect, useState } from "react";
import { HomePage } from "./components/HomePage.tsx";
import { RunPage } from "./components/RunPage.tsx";
import { ResultPage } from "./components/ResultPage.tsx";
import { SharePage } from "./components/SharePage.tsx";
import { HistoryDrawer } from "./components/HistoryDrawer.tsx";

export type Route = { part: string; run: string | null; runId: string | null };

function readRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  return { part: params.get("part") || "home", run: params.get("run"), runId: params.get("runId") };
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [historyOpen, setHistoryOpen] = useState(route.part === "history");

  useEffect(() => {
    const onPop = () => {
      const next = readRoute();
      setRoute(next);
      setHistoryOpen(next.part === "history");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((href: string) => {
    window.history.pushState(null, "", href);
    const next = readRoute();
    setRoute(next);
    setHistoryOpen(next.part === "history");
    window.scrollTo(0, 0);
  }, []);

  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    if (readRoute().part === "history") navigate("?part=home");
  }, [navigate]);

  const shell = { onOpenHistory: openHistory, navigate };
  let page;
  switch (route.part) {
    case "running":
      page = <RunPage key={`${route.run}-${route.runId}`} route={route} {...shell} />;
      break;
    case "result":
      page = <ResultPage key={`${route.run}-${route.runId}`} route={route} {...shell} />;
      break;
    case "share":
      page = <SharePage key={`${route.run}-${route.runId}`} route={route} {...shell} />;
      break;
    default:
      page = <HomePage {...shell} />;
  }
  return (
    <>
      {page}
      <HistoryDrawer opened={historyOpen} onClose={closeHistory} navigate={navigate} />
    </>
  );
}

export type ShellProps = { onOpenHistory: () => void; navigate: (href: string) => void };
