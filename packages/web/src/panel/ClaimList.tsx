import type { Case } from '@rhg/core/casefile';
import { CHECKING, CLAIM_SECTION, STANCE_TYPE, claimFace, faceTone } from "../lib/copy.js";
import { tallyText } from "../lib/select.js";
import { PanelFold } from "./PanelFold.js";

export function ClaimList(props: { current: Case; onFocus: (claimId: string) => void }) {
  return (
    <PanelFold title={CLAIM_SECTION}>
      <ol className="panel-claims">
        {props.current.claims.map((claim) => {
          const verdict = props.current.verdicts.find((row) => row.claimId === claim.id);
          const stance = !claim.checkable;
          const face = stance ? STANCE_TYPE : verdict ? claimFace(verdict.verdict) : CHECKING;
          const tone = stance || !verdict ? "muted" : faceTone(verdict.verdict);
          const tally = tallyText(verdict?.tally);
          return (
            <li key={claim.id}>
              <button type="button" className="claim-jump" onClick={() => props.onFocus(claim.id)}>
                <span className={`chip ${tone}`}>{face}</span>
                <span>{claim.text}</span>
                {tally ? <span className="tally font-mono">{tally}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </PanelFold>
  );
}
