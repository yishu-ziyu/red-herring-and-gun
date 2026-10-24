// 按 ?part= 切到各部分；页头与历史抽屉每页都有。布局照抄自 antd Layout 基础示例 https://ant.design/components/layout-cn
import { Layout, Result } from "antd";
import { useEffect, useState } from "react";
import AppHeader from "./components/AppHeader.tsx";
import HistoryDrawer from "./components/HistoryDrawer.tsx";
import HomePage from "./components/HomePage.tsx";
import ResultPage from "./components/ResultPage.tsx";
import RunningPage from "./components/RunningPage.tsx";
import SharePage from "./components/SharePage.tsx";
import type { RunSource } from "./lib/api.ts";
import { navigate, useRoute } from "./lib/nav.ts";

export default function App() {
  const route = useRoute();
  const [historyOpen, setHistoryOpen] = useState(route.part === "history");
  useEffect(() => {
    if (route.part === "history") setHistoryOpen(true);
  }, [route.part]);

  const source: RunSource | null = route.live ? { kind: "live", runId: route.live } : route.run ? { kind: "fixture", name: route.run } : null;
  const missing = <Result status="404" title="没有这次核查" extra={<a onClick={() => navigate({ part: "home" })}>回到首页</a>} />;

  let body: React.ReactNode;
  switch (route.part) {
    case "running":
      body = source ? <RunningPage key={route.live ?? route.run} source={source} /> : missing;
      break;
    case "result":
      body = source ? <ResultPage key={route.live ?? route.run} source={source} /> : missing;
      break;
    case "share":
      body = route.run ? <SharePage fixture={route.run} /> : missing;
      break;
    default:
      body = <HomePage />;
  }

  return (
    <Layout style={{ minHeight: "100vh", background: "transparent" }}>
      <div className="page" style={{ width: "100%" }}>
        <AppHeader onHistory={() => setHistoryOpen(true)} />
        <Layout.Content>{body}</Layout.Content>
      </div>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          if (route.part === "history") window.history.replaceState(null, "", "/?part=home");
        }}
      />
    </Layout>
  );
}
