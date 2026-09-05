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
      className="gp-evidence-item"
      data-gp-unreachable={unreachable || undefined}
      onClick={() => onSelect(link, source)}
    >
      <span className="gp-evidence-title">
        {source.title || source.url}
        {unreachable ? <em className="gp-evidence-dead">（打不开）</em> : null}
      </span>
      <span className="gp-evidence-domain">{domainOf(source.url)}</span>
    </button>
  );
}
