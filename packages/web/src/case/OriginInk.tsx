import type { Case } from "@rhg/core/casefile";
import { ORIGIN_SECTION } from "../lib/copy.js";
import { originSegments, pickOriginSource } from "../lib/originInk.js";
import { Citation } from "./Citation.js";

export function OriginInk(props: { current: Case; flashClaim?: string | null }) {
  const source = pickOriginSource(props.current);
  if (!source) return null;
  const parts = originSegments(props.current);
  return (
    <section className="origin-ink" aria-label={ORIGIN_SECTION}>
      <p className="origin-sentence font-serif">
        {parts.map((part, index) => {
          if (part.kind === "claim") {
            return (
              <span key={index}>
                <span
                  className={props.flashClaim === part.claimId ? "origin-mark origin-flash" : "origin-mark"}
                  data-claim-id={part.claimId}
                >
                  {part.text}
                </span>
                {part.citeNs.map((n) => (
                  <Citation key={n} n={n} current={props.current} />
                ))}
              </span>
            );
          }
          return <span key={index}>{part.text}</span>;
        })}
      </p>
    </section>
  );
}

export function paintedClaimIds(current: Case): Set<string> {
  return new Set(originSegments(current).map((part) => part.claimId).filter((id): id is string => Boolean(id)));
}
