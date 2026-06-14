import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import gsap from "gsap";
import type { HandoffStep } from "../../../../lib/agentExpansion";

interface DetectiveClueNetworkProps {
  claim: string;
  steps: HandoffStep[];
  currentStep: HandoffStep | null;
}

interface FlowFragment {
  id: string;
  text: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
  size: "sm" | "md" | "lg";
}

const KEYWORD_POOL = [
  "健康谣言", "社会谣言", "科技谣言", "恐惧诉求", "匿名信源",
  "伪科学", "交叉验证", "信源追溯", "事实核查", "官方通报",
  "学术论文", "媒体报道", "已辟谣", "存疑", "待验证"
];

const FRAGMENT_TEXTS = [
  "WHO 官方声明", "CDC 研究报告", "新华社通稿", "中科院论文",
  "丁香医生科普", "果壳网解读", "微博热搜", "微信群截图"
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function DetectiveClueNetworkGSAP({ claim, steps }: DetectiveClueNetworkProps) {
  const [fragments, setFragments] = useState<FlowFragment[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerHaloRef = useRef<HTMLDivElement>(null);
  const outerHaloRef = useRef<HTMLDivElement>(null);

  const keywordPool = useMemo(() => {
    const fromSteps: string[] = [];
    steps.forEach((s) => {
      if (s.agent) fromSteps.push(s.agentName || s.agent);
      if (s.output && typeof s.output === "object") {
        Object.values(s.output).forEach((v) => {
          if (typeof v === "string" && v.length < 30) fromSteps.push(v);
        });
      }
    });
    return [...KEYWORD_POOL, ...FRAGMENT_TEXTS, ...fromSteps];
  }, [steps]);

  // Halo rotation via GSAP
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to(innerHaloRef.current, {
        rotate: 360,
        duration: 15,
        repeat: -1,
        ease: "none"
      });
      gsap.to(outerHaloRef.current, {
        rotate: -360,
        duration: 25,
        repeat: -1,
        ease: "none"
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const triggerAbsorption = useCallback((endX: number, endY: number) => {
    if (!containerRef.current) return;

    // 1. Center node shock pulse
    const centerEl = containerRef.current.querySelector(".dcn-center");
    if (centerEl) {
      gsap.fromTo(centerEl,
        { scale: 1 },
        { scale: 1.05, duration: 0.1, yoyo: true, repeat: 1, ease: "power1.out" }
      );
    }

    // 2. Ripple rings
    const rip = document.createElement("div");
    rip.className = "dcn-ripple-circle";
    rip.style.left = "50%";
    rip.style.top = "50%";
    rip.style.transform = "translate(-50%, -50%) scale(0.6)";
    rip.style.position = "absolute";
    containerRef.current.appendChild(rip);

    gsap.to(rip, {
      scale: 1.8,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out",
      onComplete: () => rip.remove()
    });

    // 3. Particle scattering
    for (let i = 0; i < 8; i++) {
      const p = document.createElement("div");
      p.className = "dcn-particle";
      p.style.left = `${endX}%`;
      p.style.top = `${endY}%`;
      containerRef.current.appendChild(p);

      const angle = randomRange(0, Math.PI * 2);
      const dist = randomRange(30, 80);
      const tarX = Math.cos(angle) * dist;
      const tarY = Math.sin(angle) * dist;

      gsap.to(p, {
        x: tarX,
        y: tarY,
        scale: 0,
        opacity: 0,
        duration: randomRange(0.4, 0.7),
        ease: "power2.out",
        onComplete: () => p.remove()
      });
    }
  }, []);

  // GSAP animation dynamic logic per fragment
  const animateFragment = useCallback((f: FlowFragment) => {
    setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-id="${f.id}"]`);
      const lineEl = containerRef.current?.querySelector(`[data-line-id="${f.id}"]`);
      if (!el) return;

      const tl = gsap.timeline({
        onComplete: () => {
          triggerAbsorption(f.endX, f.endY);
          el.remove();
          lineEl?.remove();
          setFragments((prev) => prev.filter((item) => item.id !== f.id));
        }
      });

      tl.fromTo(el,
        { left: `${f.startX}%`, top: `${f.startY}%`, opacity: 0, scale: 0.6 },
        {
          left: `${f.endX}%`,
          top: `${f.endY}%`,
          scale: 0.3,
          ease: "power1.in", // speeds up as it gets closer
          duration: f.duration
        }
      );

      // Fade in-out
      tl.to(el, {
        opacity: 0.8,
        duration: f.duration * 0.2
      }, 0);

      tl.to(el, {
        opacity: 0,
        duration: f.duration * 0.2
      }, f.duration * 0.8);

      // SVG line animation in sync
      if (lineEl) {
        gsap.fromTo(lineEl,
          { attr: { x1: `${f.startX}%`, y1: `${f.startY}%` }, opacity: 0 },
          {
            attr: { x1: `${f.endX}%`, y1: `${f.endY}%` },
            opacity: 0.3,
            duration: f.duration,
            ease: "power1.in"
          }
        );
      }
    }, 50);
  }, [triggerAbsorption]);

  const spawnFragment = useCallback(() => {
    const id = `f-${Date.now()}-${Math.random()}`;
    const text = randomItem(keywordPool);

    const side = Math.floor(Math.random() * 4);
    let startX: number, startY: number;
    switch (side) {
      case 0: startX = randomRange(10, 90); startY = -5; break;
      case 1: startX = 105; startY = randomRange(10, 70); break;
      case 2: startX = randomRange(10, 90); startY = 75; break;
      default: startX = -5; startY = randomRange(10, 70); break;
    }

    const endX = randomRange(46, 54);
    const endY = randomRange(42, 50);
    const size = randomItem<"sm" | "md" | "lg">(["sm", "md", "lg"]);
    const duration = randomRange(5, 8); // GSAP runs slightly faster

    const newFrag = { id, text, startX, startY, endX, endY, duration, size };
    setFragments((prev) => [...prev.slice(-20), newFrag]);
    animateFragment(newFrag);
  }, [keywordPool, animateFragment]);

  useEffect(() => {
    const timer = setInterval(spawnFragment, 850);
    return () => clearInterval(timer);
  }, [spawnFragment]);

  // Spawn initial burst of fragments
  useEffect(() => {
    for (let i = 0; i < 8; i++) {
      setTimeout(() => spawnFragment(), i * 200);
    }
  }, [spawnFragment]);

  const shortClaim = claim.length > 30 ? claim.slice(0, 30) + "…" : claim;

  return (
    <div ref={containerRef} className="dcn-engine-container" style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Rotating Background Halos */}
      <div className="dcn-halo-container">
        <div ref={innerHaloRef} className="dcn-halo dcn-halo-inner" />
        <div ref={outerHaloRef} className="dcn-halo dcn-halo-outer" />
      </div>

      {/* SVG Attraction Lines */}
      <svg className="dcn-svg-overlay">
        {fragments.map((f) => (
          <line
            key={`line-${f.id}`}
            data-line-id={f.id}
            x2={`${f.endX}%`}
            y2={`${f.endY}%`}
            className="dcn-connection-line"
          />
        ))}
      </svg>

      {/* Flowing Fragments */}
      <div className="dcn-flow-layer">
        {fragments.map((f) => {
          const sizeClass = f.size === "sm" ? "dcn-fragment--sm" : f.size === "lg" ? "dcn-fragment--lg" : "dcn-fragment--md";
          return (
            <div
              key={f.id}
              data-id={f.id}
              className={`dcn-fragment ${sizeClass}`}
              style={{ position: "absolute", opacity: 0 }}
            >
              {f.text}
            </div>
          );
        })}
      </div>

      {/* Center CLAIM card */}
      <div className="dcn-center-layer">
        <div className="dcn-center" style={{ scale: 1, opacity: 1 }}>
          <div className="dcn-center-inner" style={{ zIndex: 5, position: "relative" }}>
            <span className="dcn-center-label">CLAIM</span>
            <span className="dcn-center-text">{shortClaim}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
