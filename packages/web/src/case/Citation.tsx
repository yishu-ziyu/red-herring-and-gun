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

export function HostMark(props: { host: string }) {
  const letter = (props.host.replace(/^www\./, "")[0] ?? "?").toUpperCase();
  return (
    <span className="host-mark" aria-hidden>
      {letter}
    </span>
  );
}

export function CitePopover(props: { title: string; host: string; tier: string; quote?: string }) {
  return (
    <span className="cite-pop" role="tooltip">
      <span className="cite-pop-head">
        <HostMark host={props.host} />
        <strong>{props.title}</strong>
      </span>
      <span>{props.host}</span>
      <TierBadge tier={props.tier} />
      {props.quote ? <q>{props.quote}</q> : null}
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
      {open ? <CitePopover title={title} host={evidence.host} tier={evidence.tier} quote={quote} /> : null}
    </span>
  );
}

export function SourceChip(props: { current: Case; n: number }) {
  const [open, setOpen] = useState(false);
  const evidence = citationEvidence(props.current, props.n);
  if (!evidence) return null;
  const quote = quoteForEvidence(props.current, evidence.id);
  const title = evidence.title ?? evidence.host;
  return (
    <span className="cite-wrap">
      <a
        className="source-chip"
        href={evidence.url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <HostMark host={evidence.host} />
        {evidence.host.replace(/^www\./, "")}
      </a>
      {open ? <CitePopover title={title} host={evidence.host} tier={evidence.tier} quote={quote} /> : null}
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
