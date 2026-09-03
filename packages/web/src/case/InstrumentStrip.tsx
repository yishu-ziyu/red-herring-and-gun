import type { Case } from '@rhg/core/casefile';
import { useState } from "react";
import { actionWord, chaseLine, stopReasonWord } from "../lib/copy.js";
import { latestStopReason } from "../lib/select.js";

export function InstrumentStrip(props: { current: Case; running: boolean }) {
  const steps = props.current.investigatorSteps;
  const stop = latestStopReason(props.current);
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const reason = stop ? stopReasonWord(stop) : undefined;
  const recent = steps.slice(-3);
  if (!props.running) {
    return (
      <div className="instrument">
        <button type="button" className="instrument-fold" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {chaseLine(steps.length, reason)}
        </button>
        {open ? <StepList steps={recent} /> : null}
      </div>
    );
  }
  return (
    <div className="instrument">
      <StepList steps={recent} />
    </div>
  );
}

function StepList(props: { steps: Case["investigatorSteps"] }) {
  if (props.steps.length === 0) return null;
  return (
    <ol className="instrument-list">
      {props.steps.map((step) => (
        <li key={`${step.seq}-${step.n}-${step.role}`}>
          <span className="dot" aria-hidden="true" />
          {step.goal} · {actionWord(step.action.kind)} · {step.result}
        </li>
      ))}
    </ol>
  );
}
