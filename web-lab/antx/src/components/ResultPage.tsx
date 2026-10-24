// 结果页：数据来自 GET /api/investigations/:runId/result（历史记录直接打开，不重新核查）或本地样例。
// 加载态照抄自 antd Skeleton 基础示例 https://ant.design/components/skeleton-cn ，出错照抄 antd Result 示例 https://ant.design/components/result-cn#result-demo-warning
import { Result, Skeleton } from "antd";
import { useEffect, useState } from "react";
import { fetchResult, loadFixture, type RunSource } from "../lib/api.ts";
import type { RunResult } from "../lib/types.ts";
import { reduceEvents } from "../lib/workbench.ts";
import ResultView from "./ResultView.tsx";
import SharePanel from "./SharePanel.tsx";

export default function ResultPage({ source }: { source: RunSource }) {
  const [data, setData] = useState<{ result: RunResult; ocr: string[] } | null>(null);
  const [error, setError] = useState("");
  const key = source.kind === "fixture" ? source.name : source.runId;
  useEffect(() => {
    setData(null);
    setError("");
    const load = source.kind === "fixture"
      ? loadFixture(source.name).then((fx) => ({ result: fx.result, ocr: reduceEvents(fx.events).steps.find((s) => s.kind === "vision")?.ocr ?? [] }))
      : fetchResult(source.runId).then((result) => ({ result, ocr: [] as string[] }));
    load.then(setData).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (error) return <Result status="warning" title="结果打不开" subTitle={error} />;
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} style={{ maxWidth: 880, margin: "24px auto" }} />;
  return (
    <div data-gp-phase={data.result.snapshot.phase}>
      <ResultView
        snapshot={data.result.snapshot}
        report={data.result.report}
        ocr={data.ocr}
        shareSlot={<SharePanel runId={data.result.runId} fixture={source.kind === "fixture" ? source.name : undefined} />}
      />
    </div>
  );
}
