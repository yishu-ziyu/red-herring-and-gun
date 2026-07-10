/**
 * ClaimSpanText - Change A highlighter + Change B outward source chips.
 *
 * Taste: highlighter only for types; chips name external sources (not 可说/不可说).
 */

import type { BoundarySpan, ClaimSpan, SourceRef, SpanType } from "../../lib/schemas";

function spanClass(spanType: SpanType): string {
  return `claim-span claim-span--${spanType}`;
}

function SourceChip({
  source,
  onOpen,
}: {
  source: SourceRef;
  onOpen?: (source: SourceRef) => void;
}) {
  const label = source.title || source.domain || source.sourceId;
  const className = `source-chip source-chip--${source.role}${
    source.independence === "folded_repost" ? " source-chip--folded" : ""
  }`;

  if (source.url) {
    return (
      <a
        className={className}
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        title={source.domain ? `${label} · ${source.domain}` : label}
        onClick={(e) => {
          if (onOpen) {
            e.preventDefault();
            onOpen(source);
          }
        }}
      >
        {label}
        <span className="source-chip-arrow" aria-hidden="true">
          ↗
        </span>
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={source.domain ? `${label} · ${source.domain}` : label}
      onClick={() => onOpen?.(source)}
    >
      {label}
      <span className="source-chip-arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

export function ClaimSpanText({
  spans,
  className = "",
  onSourceOpen,
}: {
  spans: ClaimSpan[];
  className?: string;
  onSourceOpen?: (source: SourceRef) => void;
}) {
  if (!spans.length) return null;

  return (
    <p className={`claim-span-text ${className}`.trim()}>
      {spans.map((span) => (
        <span
          key={span.id}
          id={`attn-${span.id}`}
          className={spanClass(span.spanType)}
          data-span-type={span.spanType}
          data-span-id={span.id}
          title={span.attentionReason}
        >
          {span.text}
          {span.sources?.map((source) => (
            <SourceChip key={source.sourceId} source={source} onOpen={onSourceOpen} />
          ))}
        </span>
      ))}
    </p>
  );
}

export function BoundarySpanList({
  spans,
  emptyLabel = "暂无",
}: {
  spans: BoundarySpan[];
  emptyLabel?: string;
}) {
  if (!spans.length) {
    return <p className="boundary-empty">{emptyLabel}</p>;
  }

  return (
    <ul className="boundary-list">
      {spans.map((span) => (
        <li
          key={span.id}
          className={`boundary-list-item boundary-span boundary-span--${span.spanType}`}
          data-span-type={span.spanType}
          data-license={span.license}
          title={span.attentionReason}
        >
          {span.text}
        </li>
      ))}
    </ul>
  );
}
