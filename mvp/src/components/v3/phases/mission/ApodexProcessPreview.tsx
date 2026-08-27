/**
 * DEV: play back the Apodex-shaped process without a live model.
 * Route: /process-preview
 */
import { useEffect, useMemo, useState } from "react";
import {
  adaptOrchestrateStreamToShell,
  FIXTURE_LOOP_PROGRESSIVE,
} from "../../../../lib/missionShell";
import { mapShellToApodexRun } from "./apodexRunMap";
import { ApodexRunView } from "./ApodexRunView";

const CLAIM = "隔夜菜加热会致癌吗";
const STEP_MS = 420;

export function ApodexProcessPreview() {
  const [n, setN] = useState(1);
  const total = FIXTURE_LOOP_PROGRESSIVE.length;

  useEffect(() => {
    if (n >= total) return;
    const t = window.setTimeout(() => setN((x) => x + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [n, total]);

  const model = useMemo(() => {
    const run = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(FIXTURE_LOOP_PROGRESSIVE.slice(0, n), { claim: CLAIM })
    );
    if (n < total) return run;
    return { ...run, live: false };
  }, [n, total]);

  const done = n >= total;

  return (
    <div style={{ padding: "20px 28px 40px", minHeight: "100vh" }}>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--zt-text-muted, #888)" }}>
        过程预览 · 逐步放出检索 / 思考 / 打开页面，不是真查。
        <a href="/?loop=1" style={{ marginLeft: 8 }}>
          回首页真查
        </a>
      </p>
      <ApodexRunView
        model={model}
        elapsedMs={n * STEP_MS}
        runStatus={done ? "completed" : "running"}
        onStop={() => setN(done ? 1 : total)}
        stopLabel={done ? "再看一遍" : "停止"}
      />
    </div>
  );
}
