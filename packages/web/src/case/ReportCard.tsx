import type { Case, Pivot, Report } from '@rhg/core/casefile';
import { useState } from "react";
import { CHECKING, STANCE_TYPE, claimFace, expandCitations, faceTone, materialsLine } from "../lib/copy.js";
import {
  evidenceById,
  firstSentence,
  latestStatus,
  overallTone,
  stancesForEvidence,
} from "../lib/select.js";
import { CitedText, SourceChip, StanceMarks, TierBadge } from "./Citation.js";
import { FrontierChips } from "./FrontierChips.js";
import { InstrumentStrip } from "./InstrumentStrip.js";
import { OriginInk, paintedClaimIds } from "./OriginInk.js";

export function ReportCard(props: {
  current: Case;
  running: boolean;
  aborted?: boolean;
  historical?: string;
  pursuingId?: string | null;
  flashClaim?: string | null;
  onPursue?: (pivot: Pivot) => void;
}) {
  const { current, running } = props;
  const report = props.historical ? undefined : current.report;
  const conclusion = props.historical ?? report?.conclusion;
  const tone = overallTone(current.overall?.verdictType);
  const split = conclusion ? firstSentence(conclusion) : { head: "", tail: "" };

  return (
    <article className="report-card" data-running={running ? "true" : "false"}>
      {running || props.aborted ? (
        <p className="status-line">
          {running ? <span className="wait-ring" aria-hidden /> : null}
          {latestStatus(current, running, props.aborted)}
        </p>
      ) : null}
      {conclusion ? (
        <p className="conclusion font-serif">
          <CitedText text={split.head} current={current} className={`lede lede-${tone}`} />
          {split.tail ? <CitedText text={split.tail} current={current} /> : null}
        </p>
      ) : null}
      {!props.historical && running && current.evidence.length > 0 ? (
        <p className="materials" key={current.evidence.length}>
          {materialsLine(current.evidence.length).split(/(\d+)/).map((part, index) =>
            /^\d+$/.test(part) ? (
              <span key={index} className="font-mono tally-n">
                {part}
              </span>
            ) : (
              <span key={index}>{part}</span>
            ),
          )}
        </p>
      ) : null}
      {!props.historical ? <OriginInk current={current} flashClaim={props.flashClaim} /> : null}
      {!props.historical ? (
        <ClaimLines current={current} report={report} flashClaim={props.flashClaim} />
      ) : null}
      {report && !props.historical ? <CitationList current={current} /> : null}
      {!props.historical && props.onPursue ? (
        <FrontierChips
          current={current}
          running={running}
          pendingId={props.pursuingId}
          onPursue={props.onPursue}
        />
      ) : null}
      {!props.historical ? <InstrumentStrip current={current} running={running} /> : null}
    </article>
  );
}

function ClaimLines(props: { current: Case; report: Report | undefined; flashClaim?: string | null }) {
  const painted = paintedClaimIds(props.current);
  const items = (props.report?.claimItems ?? []).filter((item) => !painted.has(item.claimId));
  if (items.length > 0) {
    return (
      <ol className="report-claims">
        {items.map((item) => {
          const claim = props.current.claims.find((row) => row.id === item.claimId);
          return (
            <ClaimRow
              key={item.claimId}
              current={props.current}
              claimId={item.claimId}
              stance={claim ? !claim.checkable : false}
              line={item.line}
              flash={props.flashClaim === item.claimId}
            />
          );
        })}
      </ol>
    );
  }
  const leftover = props.current.claims.filter((claim) => !painted.has(claim.id));
  if (leftover.length === 0) return null;
  return (
    <ol className="report-claims">
      {leftover.map((claim) => (
        <ClaimRow
          key={claim.id}
          current={props.current}
          claimId={claim.id}
          stance={!claim.checkable}
          line={claim.text}
          flash={props.flashClaim === claim.id}
          plain
        />
      ))}
    </ol>
  );
}

function ClaimRow(props: {
  current: Case;
  claimId: string;
  stance: boolean;
  line: string;
  flash: boolean;
  plain?: boolean;
}) {
  const verdict = props.current.verdicts.find((row) => row.claimId === props.claimId);
  const face = props.stance ? STANCE_TYPE : verdict ? claimFace(verdict.verdict) : CHECKING;
  const tone = props.stance || !verdict ? "muted" : faceTone(verdict.verdict);
  return (
    <li
      id={`claim-item-${props.claimId}`}
      data-claim-item={props.claimId}
      className={props.flash ? "claim-flash" : undefined}
    >
      <span className={`chip ${tone}`}>{face}</span>
      {props.plain ? props.line : <CitedText text={props.line} current={props.current} />}
    </li>
  );
}

function CitationList(props: { current: Case }) {
  const rows = props.current.report?.citations ?? [];
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const shown = open ? rows : rows.slice(0, 5);
  return (
    <div className="cite-list">
      <div className="source-chips">
        {rows.map((row) => (
          <SourceChip key={row.n} current={props.current} n={row.n} />
        ))}
      </div>
      <ol>
        {shown.map((row) => {
          const evidence = evidenceById(props.current, row.evidenceId);
          if (!evidence) return null;
          return (
            <li key={row.n} className="cite-row">
              <a className="cite font-mono" href={evidence.url} target="_blank" rel="noopener noreferrer">
                [{row.n}]
              </a>
              <span className="cite-title">{evidence.title ?? evidence.host}</span>
              <span className="cite-meta">
                {evidence.host} <TierBadge tier={evidence.tier} />
                <StanceMarks stances={stancesForEvidence(props.current, evidence.id)} />
              </span>
            </li>
          );
        })}
      </ol>
      {rows.length > 5 && !open ? (
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          {expandCitations(rows.length)}
        </button>
      ) : null}
    </div>
  );
}
