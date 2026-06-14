# DetectiveClueNetwork Dual Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create two distinct, high-fidelity visual versions of the `DetectiveClueNetwork` component (Framer Motion and GSAP) and combine them with an in-UI Engine Switcher to allow the user to compare their interactive and performance characteristics.

**Architecture:** We will decompose the component into a main wrapper (`DetectiveClueNetwork.tsx`) that handles the Engine Switcher state, and two sub-components: `DetectiveClueNetworkFramer.tsx` (Approach 1) and `DetectiveClueNetworkGSAP.tsx` (Approach 2). CSS styles will be centralized in `styles.css` using the `.dcn-` class prefix.

**Tech Stack:** React 18, TypeScript, Framer Motion, GSAP, CSS.

---

## File Structure Map
- Create: `src/components/v3/phases/mission/DetectiveClueNetworkFramer.tsx` (Framer Motion engine)
- Create: `src/components/v3/phases/mission/DetectiveClueNetworkGSAP.tsx` (GSAP engine)
- Modify: `src/components/v3/phases/mission/DetectiveClueNetwork.tsx` (Unified Switcher container)
- Modify: `src/styles.css` (Visual effects & Layout styles)

---

### Task 1: CSS Style Upgrades in `styles.css`

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add new style rules for halos, ripples, particles, lines, and toggle switcher**

```css
/* ── Engine Switcher ── */
.dcn-engine-toggle {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  padding: 2px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.dcn-toggle-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  font-weight: 600;
  color: #6b6b7b;
  padding: 6px 14px;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dcn-toggle-btn.active {
  background: #050c23;
  color: #ffffff;
}

/* ── Glowing Halos ── */
.dcn-halo-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 0;
}

.dcn-halo {
  position: absolute;
  border-radius: 50%;
  border: 1.5px dashed rgba(107, 120, 255, 0.15);
  pointer-events: none;
  box-shadow: 0 0 20px rgba(107, 120, 255, 0.05);
}

.dcn-halo-inner {
  width: 380px;
  height: 380px;
}

.dcn-halo-outer {
  width: 520px;
  height: 520px;
  border-style: dotted;
}

/* ── Connection Lines ── */
.dcn-svg-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.dcn-connection-line {
  stroke: rgba(107, 120, 255, 0.2);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  fill: none;
}

/* ── Particles & Ripples ── */
.dcn-ripple-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}

.dcn-ripple-circle {
  position: absolute;
  border: 1px solid rgba(107, 120, 255, 0.4);
  border-radius: 50%;
  width: 320px;
  height: 320px;
  pointer-events: none;
}

.dcn-particle {
  position: absolute;
  width: 4px;
  height: 4px;
  background: #6b78ff;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 0 6px #6b78ff;
}
```

- [ ] **Step 2: Verify compilation and code inclusion**
Run: `npm run build`
Expected: Build passes.

---

### Task 2: Implement Framer Motion Engine

**Files:**
- Create: `src/components/v3/phases/mission/DetectiveClueNetworkFramer.tsx`

- [ ] **Step 1: Write `DetectiveClueNetworkFramer.tsx` with advanced visual metaphors**

```tsx
import { useState, useMemo, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

interface Ripple {
  id: string;
}

interface Particle {
  id: string;
  startX: number;
  startY: number;
  angle: number;
  distance: number;
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

export function DetectiveClueNetworkFramer({ claim, steps }: DetectiveClueNetworkProps) {
  const [fragments, setFragments] = useState<FlowFragment[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);

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

  // Trigger ripple and particle blast on clue arrival
  const triggerAbsorption = useCallback((x: number, y: number) => {
    const rippleId = `r-${Date.now()}-${Math.random()}`;
    setRipples((prev) => [...prev, { id: rippleId }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== rippleId));
    }, 1000);

    const newParticles: Particle[] = Array.from({ length: 6 }).map((_, i) => ({
      id: `p-${Date.now()}-${i}-${Math.random()}`,
      startX: x,
      startY: y,
      angle: randomRange(0, Math.PI * 2),
      distance: randomRange(40, 100)
    }));

    setParticles((prev) => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 800);
  }, []);

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

    const endX = randomRange(45, 55);
    const endY = randomRange(42, 52);
    const size = randomItem<"sm" | "md" | "lg">(["sm", "md", "lg"]);
    const duration = randomRange(6, 10);

    const newFrag = { id, text, startX, startY, endX, endY, duration, size };
    setFragments((prev) => [...prev.slice(-20), newFrag]);

    // Schedule absorption effects
    setTimeout(() => {
      triggerAbsorption(endX, endY);
    }, duration * 1000);
  }, [keywordPool, triggerAbsorption]);

  useEffect(() => {
    const timer = setInterval(spawnFragment, 800);
    return () => clearInterval(timer);
  }, [spawnFragment]);

  const shortClaim = claim.length > 30 ? claim.slice(0, 30) + "…" : claim;

  return (
    <div className="dcn-engine-container" style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Dual Rotating Background Halos */}
      <div className="dcn-halo-container">
        <motion.div
          className="dcn-halo dcn-halo-inner"
          animate={{ rotate: 360 }}
          transition={{ duration: 15, ease: "linear", repeat: Infinity }}
        />
        <motion.div
          className="dcn-halo dcn-halo-outer"
          animate={{ rotate: -360 }}
          transition={{ duration: 25, ease: "linear", repeat: Infinity }}
        />
      </div>

      {/* SVG Attraction Lines */}
      <svg className="dcn-svg-overlay">
        {fragments.map((f) => (
          <motion.line
            key={`line-${f.id}`}
            x1={`${f.startX}%`}
            y1={`${f.startY}%`}
            x2={`${f.endX}%`}
            y2={`${f.endY}%`}
            className="dcn-connection-line"
            initial={{ opacity: 0 }}
            animate={{
              x1: [`${f.startX}%`, `${f.endX}%`],
              y1: [`${f.startY}%`, `${f.endY}%`],
              opacity: [0, 0.4, 0.2, 0]
            }}
            transition={{ duration: f.duration, ease: "linear" }}
          />
        ))}
      </svg>

      {/* Ripples & Particles */}
      <div className="dcn-ripple-layer">
        <AnimatePresence>
          {ripples.map((r) => (
            <motion.div
              key={r.id}
              className="dcn-ripple-circle"
              initial={{ scale: 0.8, opacity: 0.6 }}
              animate={{ scale: 1.8, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          ))}
        </AnimatePresence>

        {particles.map((p) => {
          const tarX = Math.cos(p.angle) * p.distance;
          const tarY = Math.sin(p.angle) * p.distance;
          return (
            <motion.div
              key={p.id}
              className="dcn-particle"
              style={{ left: `${p.startX}%`, top: `${p.startY}%` }}
              animate={{
                x: [0, tarX],
                y: [0, tarY],
                scale: [1, 0],
                opacity: [1, 0]
              }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          );
        })}
      </div>

      {/* Flowing Fragments */}
      <div className="dcn-flow-layer">
        <AnimatePresence>
          {fragments.map((f) => {
            const sizeClass = f.size === "sm" ? "dcn-fragment--sm" : f.size === "lg" ? "dcn-fragment--lg" : "dcn-fragment--md";
            return (
              <motion.div
                key={f.id}
                className={`dcn-fragment ${sizeClass}`}
                initial={{ left: `${f.startX}%`, top: `${f.startY}%`, opacity: 0, scale: 0.6 }}
                animate={{
                  left: `${f.endX}%`,
                  top: `${f.endY}%`,
                  opacity: [0, 0.8, 0.5, 0],
                  scale: [0.6, 1.1, 0.8, 0.3]
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: f.duration, ease: "linear" }}
              >
                {f.text}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Center CLAIM card */}
      <div className="dcn-center-layer">
        <motion.div
          className="dcn-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <div className="dcn-center-inner" style={{ zIndex: 5, position: "relative" }}>
            <span className="dcn-center-label">CLAIM</span>
            <span className="dcn-center-text">{shortClaim}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Compile the newly created component to verify syntax**
Run: `npm run build`
Expected: Build passes.

---

### Task 3: Implement GSAP Engine

**Files:**
- Create: `src/components/v3/phases/mission/DetectiveClueNetworkGSAP.tsx`

- [ ] **Step 1: Write `DetectiveClueNetworkGSAP.tsx` with high performance Bezier flows and Timeline particles**

```tsx
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

      // Curve movement (Magnetic pull) using sinusoidal waves
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
          scale: 0.4,
          ease: "power1.in", // Speeds up near the center
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
```

- [ ] **Step 2: Verify GSAP component builds cleanly**
Run: `npm run build`
Expected: Build passes.

---

### Task 4: Unified Selector Wrapper & Integration

**Files:**
- Modify: `src/components/v3/phases/mission/DetectiveClueNetwork.tsx`

- [ ] **Step 1: Integrate Engine Switcher in unified entry file**

```tsx
import { useState } from "react";
import { DetectiveClueNetworkFramer } from "./DetectiveClueNetworkFramer";
import { DetectiveClueNetworkGSAP } from "./DetectiveClueNetworkGSAP";
import type { HandoffStep } from "../../../../lib/agentExpansion";

interface DetectiveClueNetworkProps {
  claim: string;
  steps: HandoffStep[];
  currentStep: HandoffStep | null;
}

export function DetectiveClueNetwork({ claim, steps, currentStep }: DetectiveClueNetworkProps) {
  const [engine, setEngine] = useState<"framer" | "gsap">("framer");

  return (
    <section className="detective-clue-network" aria-label="侦探线索网络">
      {/* Engine Switcher Toggle Buttons */}
      <div className="dcn-engine-toggle">
        <button
          className={`dcn-toggle-btn ${engine === "framer" ? "active" : ""}`}
          onClick={() => setEngine("framer")}
        >
          Framer Motion
        </button>
        <button
          className={`dcn-toggle-btn ${engine === "gsap" ? "active" : ""}`}
          onClick={() => setEngine("gsap")}
        >
          GSAP Timeline
        </button>
      </div>

      {/* Selected Animation Engine */}
      {engine === "framer" ? (
        <DetectiveClueNetworkFramer
          claim={claim}
          steps={steps}
          currentStep={currentStep}
        />
      ) : (
        <DetectiveClueNetworkGSAP
          claim={claim}
          steps={steps}
          currentStep={currentStep}
        />
      )}
    </section>
  );
}

export default DetectiveClueNetwork;
```

- [ ] **Step 2: Build the entire codebase successfully**
Run: `npm run build`
Expected: Build passes with 0 warnings.
