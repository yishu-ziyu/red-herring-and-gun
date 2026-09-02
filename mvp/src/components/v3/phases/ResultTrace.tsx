/**
 * Result-page receipt. Thin timeline, not a labeled form.
 * Query is the line you can point at. Everything else is one quiet sentence.
 */

import { useState } from "react";
import type { CiteSource } from "../../../lib/citationBinding";
import { displayOrNone, type PursuitHopView } from "../../../lib/evidencePursuitUi";

export type ResultTraceItem = {
  key: string;
  kind: "verdict" | "stance" | "atom";
  text: string;
  verdictLabel?: string;
  sources: CiteSource[];
  sourcesRelatedOnly?: boolean;
};

export function ResultTrace({
  claim,
  items,
  hops,
  sources,
}: {
  claim: string;
  items: ResultTraceItem[];
  hops: PursuitHopView[];
  sources: CiteSource[];
}) {
  const leftover = leftoverSources(items, sources);
  return (
    <section className="result-trace" aria-label="核查轨迹">
      <header className="result-trace-open">
        <p className="result-trace-claim">{claim || "无"}</p>
        {items.length > 0 ? (
          <ol className="result-trace-atoms">
            {items.map((item) => (
              <li key={item.key}>{item.text}</li>
            ))}
          </ol>
        ) : (
          <p>无</p>
        )}
      </header>

      {hops.length > 0 ? (
        <ol className="result-trace-hops" aria-label="追索跳">
          {hops.map((hop, index) => {
            const n = hop.hop || index + 1;
            const atom = hop.atom?.trim() || claim || "无";
            const goal = hop.goal?.trim() || "无";
            const result = hop.resultKindLabel?.trim() || "无";
            const missing = displayOrNone(hop.missingAfter);
            const stop =
              hop.stopReasonLabel ||
              (hop.action === "stop" ? "已收敛" : hop.stopReason ? displayOrNone(hop.stopReasonLabel) : "");
            return (
              <li key={`${n}-${hop.query}-${index}`} className="result-trace-hop">
                <span className="result-trace-n">第 {n} 跳</span>
                <div className="result-trace-hop-body">
                  <CopyQuery query={hop.query} />
                  <p className="result-trace-atom">对着「{atom}」</p>
                  <p className="result-trace-meta">
                    {goal}
                    <i aria-hidden="true">·</i>
                    {result}
                    <i aria-hidden="true">·</i>
                    {missing === "无" ? "还缺：无" : `还缺${missing}`}
                  </p>
                  {hop.stopReason || hop.action === "stop" ? (
                    <p className="result-trace-stop">停在：{stop || "无"}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="result-trace-empty">没有补查，只有首次检索与判断。</p>
      )}

      <footer className="result-trace-close" aria-label="轨迹收尾">
        {items.length > 0 ? (
          <ul className="result-trace-closing">
            {items.map((item) => (
              <li key={item.key}>
                <p>{item.text}</p>
                <em>{closingCopy(item)}</em>
                <ClosingSources item={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p>无</p>
        )}
        {leftover.length > 0 ? (
          <ul className="result-trace-leftover">
            {leftover.map((source) => (
              <li key={source.url}>
                <TraceLink url={source.url} title={source.title} />
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </section>
  );
}

function leftoverSources(items: ResultTraceItem[], sources: CiteSource[]): CiteSource[] {
  const seen = new Set(items.flatMap((item) => item.sources.map((source) => source.url)));
  return sources.filter((source) => !seen.has(source.url));
}

function CopyQuery({ query }: { query: string }) {
  const [copied, setCopied] = useState(false);
  const text = query.trim();
  if (!text) return <p className="result-trace-query">无</p>;
  return (
    <div className="result-trace-query">
      <pre>{text}</pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            },
            () => undefined
          );
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

function TraceLink({ url, title }: { url: string; title: string }) {
  const href = /^https?:\/\//i.test(url) ? url : "";
  if (!href) return <span>{title || url || "无"}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {title || url}
    </a>
  );
}

function closingCopy(item: ResultTraceItem): string {
  if (item.kind === "stance") return "立场型 / 不适用真/假判断";
  if (item.kind === "atom") return "无";
  if (item.sourcesRelatedOnly && item.sources.length > 0) return "仅为相关检索";
  const bound = item.sources.length > 0 && !item.sourcesRelatedOnly;
  if (!bound) return "没有绑定出处";
  return item.verdictLabel || "无";
}

function ClosingSources({ item }: { item: ResultTraceItem }) {
  if (item.sources.length === 0) return null;
  return (
    <ul className="result-trace-sources">
      {item.sourcesRelatedOnly ? <li className="result-trace-related">仅为相关检索</li> : null}
      {item.sources.map((source) => (
        <li key={source.url}>
          <TraceLink url={source.url} title={source.title} />
        </li>
      ))}
    </ul>
  );
}
