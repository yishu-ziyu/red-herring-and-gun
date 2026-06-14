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

  // Spawn initial burst of fragments
  useEffect(() => {
    for (let i = 0; i < 8; i++) {
      setTimeout(() => spawnFragment(), i * 200);
    }
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
