import type { Case, Evidence } from '@rhg/core/casefile';
import { useState } from "react";
import { StanceMarks, TierBadge } from "../case/Citation.js";
import { EVIDENCE_SECTION, OPEN_ORIGINAL, moreInCluster } from "../lib/copy.js";
import { clusterGroups, quoteForEvidence, stancesForEvidence } from "../lib/select.js";
import { PanelFold } from "./PanelFold.js";

export function EvidenceBoard(props: { current: Case }) {
  const groups = clusterGroups(props.current.evidence, props.current.cites);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  return (
    <PanelFold title={EVIDENCE_SECTION}>
      {groups.map((group) => {
        const expanded = openIds[group.id] === true;
        const hidden = Math.max(0, group.items.length - 1);
        const shown = expanded ? group.items : group.items.slice(0, 1);
        return (
          <div key={group.id} className="cluster">
            {shown.map((item) => (
              <EvidenceRow key={item.id} current={props.current} item={item} />
            ))}
            {!expanded && hidden > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpenIds((state) => ({ ...state, [group.id]: true }))}
              >
                {moreInCluster(hidden)}
              </button>
            ) : null}
          </div>
        );
      })}
    </PanelFold>
  );
}

function EvidenceRow(props: { current: Case; item: Evidence }) {
  const [open, setOpen] = useState(false);
  const quote = quoteForEvidence(props.current, props.item.id);
  return (
    <div className="evidence-row">
      <button type="button" className="evidence-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <TierBadge tier={props.item.tier} />
        <span>{props.item.title ?? props.item.host}</span>
        <span className="muted">{props.item.host}</span>
        <StanceMarks stances={stancesForEvidence(props.current, props.item.id)} />
      </button>
      {open ? (
        <div className="evidence-body">
          {quote ? <q>{quote}</q> : <p>{props.item.excerpt}</p>}
          <a href={props.item.url} target="_blank" rel="noopener noreferrer">
            {OPEN_ORIGINAL}
          </a>
        </div>
      ) : null}
    </div>
  );
}
