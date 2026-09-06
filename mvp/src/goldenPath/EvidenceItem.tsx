/**
 * EvidenceItem — 一条材料行：角色 + 标题 + 域名，点击进入来源下钻。
 * unassessed（待核对）保持中性，绝不能看起来像支持/反驳。
 */
import { domainOf } from "./snapshotUi";
import type { InvestigationEvidenceLink, InvestigationSource } from "@rhg/core/investigation";

type EvidenceItemProps = {
  link: InvestigationEvidenceLink;
  source: InvestigationSource | undefined;
  onSelect: (link: InvestigationEvidenceLink, source: InvestigationSource) => void;
};

export function EvidenceItem({ link, source, onSelect }: EvidenceItemProps) {
  if (!source) return null;
  const unreachable = source.reachable === false;
  return (
    <button
      type="button"
      className={`gp-evidence-item is-${link.role}`}
      data-gp-unreachable={unreachable || undefined}
      data-gp-role={link.role}
      onClick={() => onSelect(link, source)}
    >
      <span className={`gp-evidence-dot is-${link.role}`} aria-hidden="true">
        {link.role === "support" || link.role === "contradict" ? "●" : link.role === "context-only" ? "○" : "◌"}
      </span>
      <div className="gp-evidence-body">
        <div className="gp-evidence-header">
          <strong className="gp-evidence-title">
            {source.title || source.url}
          </strong>
          {unreachable ? <em className="gp-evidence-dead">（打不开）</em> : null}
          <span className="gp-evidence-domain">
            {domainOf(source.url)}
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" className="gp-ext-arrow">
              <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        {source.excerpt ? (
          <p className="gp-evidence-excerpt">{source.excerpt}</p>
        ) : null}
      </div>
    </button>
  );
}
