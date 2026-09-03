import type { Case } from '@rhg/core/casefile';
import { actionWord, roleWord, stopReasonWord, timelineTitle } from "../lib/copy.js";
import { gainText, timelineCounts } from "../lib/select.js";
import { PanelFold } from "./PanelFold.js";

export function Timeline(props: { current: Case }) {
  const counts = timelineCounts(props.current);
  const steps = props.current.investigatorSteps;
  return (
    <PanelFold title={timelineTitle(counts.chase, counts.exam)} defaultOpen={false}>
      <ol className="timeline">
        {steps.map((step) => (
          <li key={`${step.seq}-${step.n}-${step.role}`}>
            <span className="role-badge">{roleWord(step.role)}</span>
            <span>{step.goal}</span>
            <span>{actionWord(step.action.kind)}</span>
            <span>{step.result}</span>
            {gainText(step.gain) ? <span className="gain">{gainText(step.gain)}</span> : null}
          </li>
        ))}
      </ol>
      {props.current.investigatorStops.map((stop) => (
        <p key={stop.seq} className="muted">
          {roleWord(stop.role)} · {stopReasonWord(stop.reason)}
        </p>
      ))}
    </PanelFold>
  );
}
