import { useEffect, useId, useState, type RefObject } from "react";

export function AnimatedBeam(props: {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  play?: boolean;
}) {
  const play = props.play !== false;
  const id = useId();
  const [pathD, setPathD] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => {
      const container = props.containerRef.current;
      const from = props.fromRef.current;
      const to = props.toRef.current;
      if (!container || !from || !to) return;
      const box = container.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      const x1 = a.left - box.left + a.width / 2;
      const y1 = a.top - box.top + a.height / 2;
      const x2 = b.left - box.left + b.width / 2;
      const y2 = b.top - box.top + b.height / 2;
      setPathD(`M ${x1},${y1} Q ${(x1 + x2) / 2},${y1} ${x2},${y2}`);
    };
    update();
    if (typeof ResizeObserver === "undefined" || !props.containerRef.current) return;
    const observer = new ResizeObserver(update);
    observer.observe(props.containerRef.current);
    return () => observer.disconnect();
  }, [props.containerRef, props.fromRef, props.toRef]);

  return (
    <svg
      className="beam"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      fill="none"
      aria-hidden
      data-testid={play ? "beam-animated" : "beam-static"}
    >
      <path d={pathD} className="beam-path" />
      {play ? <path d={pathD} className="beam-run" stroke={`url(#${id})`} /> : null}
      {play ? (
        <defs>
          <linearGradient id={id}>
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor="var(--ink)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      ) : null}
    </svg>
  );
}
