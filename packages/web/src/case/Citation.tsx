import type { Case } from '@rhg/core/casefile';
import { useState } from "react";
import { stanceWord } from "../lib/copy.js";
import { citationEvidence, citationNumbers, parseCiteMarks, quoteForEvidence } from "../lib/select.js";

export function TierBadge(props: { tier: string }) {
  const letter = props.tier === "unknown" ? "?" : props.tier;
  return <span className={`tier-badge ${props.tier === "A" ? "solid" : "line"}`}>{letter}</span>;
}

export function StanceMarks(props: { stances: string[] }) {
  if (props.stances.length === 0) return null;
  return (
    <span className="stance-marks">
      {props.stances.map((stance) => (
        <span key={stance}>{stanceWord(stance)}</span>
      ))}
    </span>
  );
}

export function Citation(props: { n: number; current: Case }) {
  const [open, setOpen] = useState(false);
  const evidence = citationEvidence(props.current, props.n);
  if (!evidence) return <span>[{props.n}]</span>;
  const quote = quoteForEvidence(props.current, evidence.id);
  const title = evidence.title ?? evidence.host;
  return (
    <span className="cite-wrap">
      <a
        className="cite font-mono"
        href={evidence.url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        [{props.n}]
      </a>
      {open ? (
        <span className="cite-pop" role="tooltip">
          <strong>{title}</strong>
          <span>{evidence.host}</span>
          <TierBadge tier={evidence.tier} />
          {quote ? <q>{quote}</q> : null}
        </span>
      ) : null}
    </span>
  );
}

export function CitedText(props: { text: string; current: Case; className?: string }) {
  const valid = citationNumbers(props.current);
  const parts = parseCiteMarks(props.text, valid);
  return (
    <span className={props.className}>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={`t${index}`}>{part.value}</span>
        ) : (
          <Citation key={`c${part.n}-${index}`} n={part.n} current={props.current} />
        ),
      )}
    </span>
  );
}
