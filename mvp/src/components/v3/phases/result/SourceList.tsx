export interface Source {
  id: string;
  title: string;
  url?: string;
  summary?: string;
  reliability?: "high" | "medium" | "low" | "unverified";
  type?: string;
}

interface SourceListProps {
  sources: Source[];
}

const RELIABILITY_LABELS: Record<NonNullable<Source["reliability"]>, string> = {
  high: "高可信",
  medium: "中可信",
  low: "低可信",
  unverified: "待核验",
};

export function SourceList({ sources }: SourceListProps) {
  if (sources.length === 0) {
    return (
      <section className="source-list-panel" aria-label="证据来源">
        <div className="report-section-heading">
          <span>Evidence</span>
          <h3>证据来源</h3>
        </div>
        <p className="source-list-empty">当前报告未返回可展开的证据来源。</p>
      </section>
    );
  }

  return (
    <section className="source-list-panel" aria-label="证据来源">
      <div className="report-section-heading">
        <span>Evidence</span>
        <h3>证据来源</h3>
      </div>
      <ol className="source-list">
        {sources.map((source) => {
          const reliability = source.reliability ?? "unverified";

          return (
            <li key={source.id} className="source-list-item">
              <div className="source-list-title-row">
                <strong>{source.id}</strong>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                ) : (
                  <span>{source.title}</span>
                )}
              </div>
              {source.summary ? <p>{source.summary}</p> : null}
              <div className="source-list-meta">
                <span className={`source-reliability source-reliability--${reliability}`}>
                  {RELIABILITY_LABELS[reliability]}
                </span>
                {source.type ? <span>{source.type}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
