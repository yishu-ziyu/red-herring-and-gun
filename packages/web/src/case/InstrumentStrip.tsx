import type { Case } from "@rhg/core/casefile";
import { useEffect, useState } from "react";
import { actionWord, chaseLine, PROCESS_FOLD, stepResultWord, stopReasonWord } from "../lib/copy.js";
import { latestStopReason } from "../lib/select.js";
import { radarFromCase } from "../lib/searchInstrument.js";
import { SearchRadar } from "./SearchRadar.js";

export function InstrumentStrip(props: { current: Case; running: boolean }) {
  const steps = props.current.investigatorSteps;
  const radar = radarFromCase(props.current, props.running);
  const stop = latestStopReason(props.current);
  const [open, setOpen] = useState(props.running);
  const hasRadar = radar.providers.length > 0;
  const hasSteps = steps.length > 0;

  useEffect(() => {
    setOpen(props.running);
  }, [props.running]);

  if (!hasRadar && !hasSteps) return null;

  const reason = stop ? stopReasonWord(stop) : undefined;
  const label = hasSteps ? chaseLine(steps.length, reason) : PROCESS_FOLD;

  return (
    <div className="instrument">
      <button
        type="button"
        className="instrument-fold"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? (
        <div className="instrument-body">
          {hasRadar ? <SearchRadar {...radar} /> : null}
          {hasSteps ? <StepList steps={props.running ? steps.slice(-5) : steps} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function StepList(props: { steps: Case["investigatorSteps"] }) {
  if (props.steps.length === 0) return null;
  return (
    <ol className="instrument-list">
      {props.steps.map((step, index) => (
        <li key={`${step.seq}-${step.n}-${step.role}`} data-last={index === props.steps.length - 1 ? "true" : "false"}>
          <span className="step-rail" aria-hidden="true" />
          <span>
            {step.goal} · {actionWord(step.action.kind)} · {stepResultWord(step.result)}
          </span>
        </li>
      ))}
    </ol>
  );
}
