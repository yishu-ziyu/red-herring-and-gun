import { useState } from "react";
import { motion } from "framer-motion";
import { DetectiveClueNetworkFramer } from "./DetectiveClueNetworkFramer";
import { DetectiveClueNetworkGSAP } from "./DetectiveClueNetworkGSAP";
import type { HandoffStep } from "../../../../lib/agentExpansion";

interface DetectiveClueNetworkProps {
  claim: string;
  steps: HandoffStep[];
  currentStep: HandoffStep | null;
}

// ── 底部输入块 ──────────────────────────────────────────────────

function InputBlock({ claim }: { claim: string }) {
  const [value, setValue] = useState(claim);

  return (
    <motion.div
      className="dcn-input-block"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.4 }}
    >
      <div className="dcn-input-inner">
        <div className="dcn-input-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入一条你看到的疑似谣言或信息..."
          className="dcn-input-field"
        />
        <button className="dcn-input-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9"/>
          </svg>
          核查
        </button>
      </div>
    </motion.div>
  );
}

// ── 主选择容器组件 ──────────────────────────────────────────────

export function DetectiveClueNetwork({ claim, steps, currentStep }: DetectiveClueNetworkProps) {
  const [engine, setEngine] = useState<"framer" | "gsap">("framer");

  return (
    <section className="detective-clue-network" aria-label="侦探线索网络" style={{ position: "relative" }}>
      {/* 动效引擎一键切换器 */}
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

      {/* 动画引擎核心组件 */}
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

      {/* 底部输入层 */}
      <div className="dcn-input-layer">
        <InputBlock claim={claim} />
      </div>
    </section>
  );
}

export default DetectiveClueNetwork;
