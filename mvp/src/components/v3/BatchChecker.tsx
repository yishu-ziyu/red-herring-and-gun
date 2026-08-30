/**
 * BatchChecker.tsx — 批量核查（newsroom 模式）。
 * 输入多行（每行一句话）→ /api/agent/batch → 结果卡片列表。
 * 与主流程互不干扰：批量结果就地展示，不进 MissionControlView。
 */
import { useState } from "react";

interface BatchRow {
  claim: string;
  verdictType: string;
  credibilityScore?: number;
  conclusion?: string;
  faceVerdict?: string;
}

export function BatchChecker({ initialText }: { initialText: string }) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const claims = initialText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .slice(0, 20);

  const run = async () => {
    if (claims.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claims, modelChoice: {} }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "批量核查失败");
      setRows((data.results ?? []) as BatchRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量核查失败");
    } finally {
      setBusy(false);
    }
  };

  if (claims.length < 2) return null;

  return (
    <div className="batch-checker">
      <p className="batch-checker__hint">检测到 {claims.length} 条材料，可逐条核查：</p>
      <button type="button" className="result-view-btn result-view-btn--primary" onClick={run} disabled={busy}>
        {busy ? "批量核查中…" : `逐条核查这 ${claims.length} 条`}
      </button>
      {error ? <p className="batch-checker__error">{error}</p> : null}
      {rows.length > 0 ? (
        <ul className="batch-checker__list">
          {rows.map((row, index) => (
            <li key={index} className="batch-checker__row">
              <strong>{(row.faceVerdict || row.verdictType || "unverified").replace("_", " ")}</strong>
              <span>{row.claim}</span>
              {row.conclusion ? <small>{row.conclusion.slice(0, 140)}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}