import type { Case } from '@rhg/core/casefile';
import { ClaimList } from "../panel/ClaimList.js";
import { EvidenceBoard } from "../panel/EvidenceBoard.js";
import { ProvenanceGraph } from "../panel/ProvenanceGraph.js";
import { Timeline } from "../panel/Timeline.js";
import { VerdictCard } from "../panel/VerdictCard.js";

export function CasePanel(props: {
  current: Case;
  running: boolean;
  aborted?: boolean;
  onFocusClaim: (claimId: string) => void;
}) {
  return (
    <div className="case-panel">
      <VerdictCard current={props.current} running={props.running} aborted={props.aborted} />
      <ClaimList current={props.current} onFocus={props.onFocusClaim} />
      <EvidenceBoard current={props.current} />
      <ProvenanceGraph current={props.current} />
      <Timeline current={props.current} />
    </div>
  );
}
