import type { Case } from "@rhg/core/casefile";
import { CONTESTED_LINE, VERDICT_SECTION } from "../lib/copy.js";
import { firstSentence, summaryLine } from "../lib/select.js";
import { PanelFold } from "./PanelFold.js";

export function VerdictCard(props: { current: Case; running: boolean; aborted?: boolean }) {
  const overall = props.current.overall;
  const head = props.current.report?.conclusion
    ? firstSentence(props.current.report.conclusion).head
    : summaryLine(props.current, props.running, props.aborted);
  const max = Math.max(1, ...(overall?.breakdown.map((row) => Math.abs(row.value)) ?? [1]));
  return (
    <PanelFold title={VERDICT_SECTION}>
      {head ? (
        <p className="verdict-lede font-serif">{head}</p>
      ) : null}
      {overall?.breakdown.map((row) => (
        <div key={row.key} className="bar-row">
          <span className="bar-label">{row.label}</span>
          <div className={row.value < 0 ? "bar-track neg" : "bar-track"}>
            <div className="bar-fill" style={{ width: `${(Math.abs(row.value) / max) * 100}%` }} />
          </div>
          <span className="bar-val font-mono">{row.value}</span>
        </div>
      ))}
      {overall?.contested ? <p className="contested-line">{CONTESTED_LINE}</p> : null}
    </PanelFold>
  );
}
