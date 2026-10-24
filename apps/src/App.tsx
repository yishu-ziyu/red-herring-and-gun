// 应用外壳：顶栏照抄 shadcn/ui dashboard-01 的 SiteHeader（https://ui.shadcn.com/blocks#dashboard-01）。
// 地址见 lib/route.ts：/ 首页，/run/<runId> 运行过程，/result/<runId> 结果；开发模式另认 ?part=… 直达各部分。
import { lazy, Suspense, useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { HistorySheet } from "@/components/history-sheet";
import { Home } from "@/components/home";
import { ResultView } from "@/components/result/result-view";
import { ShareView } from "@/components/share-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadFixtureIndex, loadRun } from "@/lib/data";
import { displayClaim } from "@/lib/derive";
import { navigate, useRoute } from "@/lib/route";
import type { RunData } from "@/lib/types";

// 运行过程页单独成块：它带着 Markdown 渲染和动画库，首页、结果页用不上，不该一起下载。
const RunningView = lazy(() => import("@/components/workbench/running-view").then((m) => ({ default: m.RunningView })));

function useRun(run: string) {
  const [state, setState] = useState<{ run: string; data: RunData | null; error: string }>({ run: "", data: null, error: "" });
  useEffect(() => {
    if (!run) return;
    let alive = true;
    setState({ run, data: null, error: "" });
    loadRun(run)
      .then((data) => alive && setState({ run, data, error: "" }))
      .catch((error: unknown) => alive && setState({ run, data: null, error: error instanceof Error ? error.message : "读取失败" }));
    return () => {
      alive = false;
    };
  }, [run]);
  return state.run === run ? state : { run, data: null, error: "" };
}

/** 开发模式 ?part=… 没给 run 时，默认用第一个回放样例。生产里 run 一定来自地址。 */
function useDefaultRun(run: string, needed: boolean) {
  const [fallback, setFallback] = useState("");
  useEffect(() => {
    if (run || !needed || !import.meta.env.DEV) return;
    void loadFixtureIndex().then((rows) => setFallback(rows[0]?.fixture ?? ""));
  }, [run, needed]);
  return run || fallback;
}

function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <Alert variant="destructive">
        <AlertTitle>打不开这次核查</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button className="mt-4" variant="outline" onClick={() => navigate({ view: "home" })}>
        回到首页
      </Button>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [historyOpen, setHistoryOpen] = useState(route.view === "history");
  useEffect(() => {
    if (route.view === "history") setHistoryOpen(true);
  }, [route.view]);
  const needsRun = route.view === "run" || route.view === "result" || route.view === "share";
  const runKey = useDefaultRun(needsRun ? route.run : "", needsRun);
  const { data, error } = useRun(needsRun ? runKey : "");

  if (route.view === "share") {
    return <TooltipProvider>{error ? <Failed message={error} /> : data ? <ShareView data={data} /> : <Loading />}</TooltipProvider>;
  }

  const title = data?.snapshot && needsRun ? displayClaim(data.snapshot.originalClaim).text : undefined;
  return (
    <TooltipProvider>
      <div className="min-h-svh bg-background">
        <SiteHeader title={title} onHistory={() => setHistoryOpen(true)} />
        {route.view === "home" || route.view === "history" ? <Home /> : null}
        {needsRun && error ? <Failed message={error} /> : null}
        {needsRun && !error && !data ? <Loading /> : null}
        {route.view === "run" && data ? (
          <Suspense fallback={<Loading />}>
            <RunningView key={data.runId} data={data} />
          </Suspense>
        ) : null}
        {route.view === "result" && data ? (
          <div className="mx-auto w-full max-w-3xl p-4 lg:p-6" data-gp-phase={data.snapshot?.phase}>
            <ResultView run={data} />
          </div>
        ) : null}
        <HistorySheet
          open={historyOpen}
          onOpenChange={(open) => {
            setHistoryOpen(open);
            if (!open && route.view === "history") navigate({ view: "home" });
          }}
        />
      </div>
    </TooltipProvider>
  );
}
