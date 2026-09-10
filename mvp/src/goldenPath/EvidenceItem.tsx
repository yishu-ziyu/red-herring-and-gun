/**
 * EvidenceItem — 一条材料行：左侧关系（文字+符号）+ 标题 + 已有摘录 + 域名。
 * 整行进入来源下钻。unassessed（待核对）保持中性，绝不能看起来像支持/反驳。
 * 摘录只展示快照已有字段，不编造。Issue #63：同一节点上做 layout 归位。
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { domainOf, ROLE_LABEL, ROLE_ROW_LABEL, roleGlyph, sourceExcerpt, type EvidenceIdentityKind } from "./snapshotUi";
import type { InvestigationEvidenceLink, InvestigationSource } from "@rhg/core/investigation";

/** 与 `--gp-motion-layout: 280ms` / `--gp-ease-out` 对齐（260–360ms 窗）。 */
const SETTLE_TRANSITION = {
  layout: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const },
};

type EvidenceItemProps = {
  claimId: string;
  link: InvestigationEvidenceLink;
  source: InvestigationSource | undefined;
  evidenceKey: string;
  identity: EvidenceIdentityKind;
  order: number;
  layoutEnabled: boolean;
  groupLabelId: string;
  onSelect: (link: InvestigationEvidenceLink, source: InvestigationSource, trigger: HTMLElement) => void;
};

export function EvidenceItem({
  claimId,
  link,
  source,
  evidenceKey,
  identity,
  order,
  layoutEnabled,
  groupLabelId,
  onSelect,
}: EvidenceItemProps) {
  const [settling, setSettling] = useState(false);
  const title = source?.title || source?.url || link.sourceId;
  const unreachable = source?.reachable === false;
  const roleLabel = ROLE_LABEL[link.role];
  const rowLabel = ROLE_ROW_LABEL[link.role];
  const excerpt = sourceExcerpt(source);

  return (
    <motion.button
      type="button"
      className={`gp-evidence-item is-${link.role}`}
      id={`gp-ev-${evidenceKey}`}
      style={{ order }}
      layout={layoutEnabled ? "position" : false}
      layoutDependency={link.role}
      initial={false}
      transition={SETTLE_TRANSITION}
      onLayoutAnimationStart={() => setSettling(true)}
      onLayoutAnimationComplete={() => setSettling(false)}
      data-gp-unreachable={unreachable || undefined}
      data-gp-role={link.role}
      data-source-id={link.sourceId}
      data-gp-source-id={link.sourceId}
      data-gp-evidence-claim={claimId}
      data-gp-evidence-key={evidenceKey}
      data-gp-identity={identity}
      data-gp-settling={settling ? "1" : undefined}
      aria-describedby={groupLabelId}
      aria-label={`${roleLabel}：${title}`}
      onClick={(event) => {
        if (!source) return;
        onSelect(link, source, event.currentTarget);
      }}
    >
      <span className={`gp-evidence-relation is-${link.role}`} data-gp-relation={link.role} aria-hidden="true">
        <span className={`gp-role-glyph is-${link.role}`}>{roleGlyph(link.role)}</span>
        <span className="gp-evidence-relation-label">{rowLabel}</span>
      </span>
      <div className="gp-evidence-body">
        <div className="gp-evidence-header">
          <strong className="gp-evidence-title">{title}</strong>
          {unreachable ? <em className="gp-evidence-dead">（打不开）</em> : null}
          {source?.url ? (
            <span className="gp-evidence-domain">
              {domainOf(source.url)}
              <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" className="gp-ext-arrow">
                <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ) : null}
        </div>
        {excerpt ? (
          <blockquote className="gp-evidence-excerpt" data-gp-evidence-excerpt>
            {excerpt}
          </blockquote>
        ) : null}
      </div>
    </motion.button>
  );
}
