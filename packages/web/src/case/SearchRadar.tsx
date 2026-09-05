import { createRef, useEffect, useRef, useState, type RefObject } from "react";
import { MATERIALS_SHORT } from "../lib/copy.js";
import {
  providerDetail,
  type RadarModel,
  type RadarProvider,
  type RadarStatus,
} from "../lib/searchInstrument.js";
import { AnimatedBeam } from "./AnimatedBeam.js";

const REDUCE = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCE)?.matches,
  );
  useEffect(() => {
    const mql = typeof window !== "undefined" ? window.matchMedia?.(REDUCE) : undefined;
    if (!mql?.addEventListener) return;
    const onChange = () => setReduce(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function StatusIcon(props: { status: RadarStatus }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 14,
    height: 14,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (props.status) {
    case "pending":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" strokeDasharray="2 4" />
        </svg>
      );
    case "running":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="8" opacity="0.35" />
        </svg>
      );
    case "completed":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5.2" />
        </svg>
      );
    case "partial":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 12V7" />
          <path d="M12 12l4 2.4" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      );
  }
}

export function SearchRadar(props: RadarModel) {
  const reduce = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  const ports = useRef(new Map<string, RefObject<HTMLSpanElement | null>>());
  const portFor = (id: string) => {
    let ref = ports.current.get(id);
    if (!ref) {
      ref = createRef<HTMLSpanElement>();
      ports.current.set(id, ref);
    }
    return ref;
  };

  if (props.providers.length === 0) return null;

  return (
    <div className="radar" data-testid="search-radar" data-phase={props.phase} data-reduced-motion={reduce ? "true" : "false"}>
      <div className="radar-canvas" ref={containerRef}>
        {props.providers.map((row) => (
          <AnimatedBeam
            key={row.id}
            containerRef={containerRef}
            fromRef={portFor(row.id)}
            toRef={poolRef}
            play={!reduce && row.status === "running"}
          />
        ))}
        <ul className="radar-providers">
          {props.providers.map((row) => (
            <ProviderRow key={row.id} row={row} portRef={portFor(row.id)} />
          ))}
        </ul>
        <div className="radar-pool" ref={poolRef} data-testid="radar-pool">
          <span>{MATERIALS_SHORT}</span>
          {props.stats ? <span data-testid="radar-stats">{props.stats.uniqueSourceCount}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ProviderRow(props: { row: RadarProvider; portRef: RefObject<HTMLSpanElement | null> }) {
  return (
    <li className="radar-provider" data-status={props.row.status} data-testid={`radar-provider-${props.row.id}`}>
      <span className="radar-icon">
        <StatusIcon status={props.row.status} />
      </span>
      <span>{props.row.label}</span>
      <span className="radar-detail">{providerDetail(props.row)}</span>
      <span className="radar-port" ref={props.portRef} aria-hidden />
    </li>
  );
}
