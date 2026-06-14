/**
 * EvidenceMatrixDemoPage.tsx — Evidence Matrix 演示对比页
 *
 * 用于同时展示方案 A（纯 CSS）和方案 B（GSAP）的对比效果
 */

import { EvidenceMatrixGSAP } from "./EvidenceMatrixGSAP";
import { mockConsensusReport, mockSearchJobs } from "./EvidenceMatrixMockData";

export function EvidenceMatrixDemoPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--zt-bg)",
        padding: "40px 24px",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "28px",
            fontWeight: 700,
            color: "var(--zt-ink)",
            marginBottom: "8px",
            letterSpacing: "0.02em",
          }}
        >
          证据矩阵 — 方案对比
        </h1>
        <p
          style={{
            color: "var(--zt-text-secondary)",
            fontSize: "14px",
            marginBottom: "32px",
          }}
        >
          当前展示：方案 B（GSAP Timeline）
        </p>

        <EvidenceMatrixGSAP
          consensusReport={mockConsensusReport}
          searchJobs={mockSearchJobs}
        />
      </div>
    </div>
  );
}

export default EvidenceMatrixDemoPage;
