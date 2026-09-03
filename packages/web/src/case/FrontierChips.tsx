import type { Case, Pivot } from '@rhg/core/casefile';
import { FRONTIER_TITLE, PURSUING } from "../lib/copy.js";
import { openFrontier, pivotLabel } from "../lib/select.js";

export function FrontierChips(props: {
  current: Case;
  running: boolean;
  pendingId?: string | null;
  onPursue: (pivot: Pivot) => void;
}) {
  const items = openFrontier(props.current);
  if (items.length === 0) return null;
  return (
    <div className="frontier">
      <p className="frontier-title">{FRONTIER_TITLE}</p>
      <div className="frontier-row">
        {items.map((pivot) => {
          const pending = props.pendingId === pivot.id;
          const used = props.current.consumedPivotIds.includes(pivot.id);
          return (
            <button
              key={pivot.id}
              type="button"
              className="chip-frontier"
              disabled={pending || used || props.running}
              onClick={() => props.onPursue(pivot)}
            >
              {pending ? PURSUING : pivotLabel(pivot)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
