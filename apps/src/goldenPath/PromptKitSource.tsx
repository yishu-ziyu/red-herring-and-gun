/**
 * PromptKitSource — 严格遵循 Prompt-Kit Source 设计规范的来源组件。
 * 参考: https://www.prompt-kit.com/docs/source
 *
 * 1. SourceTrigger: 胶囊状药丸（Pill），内嵌对应站点高清 Favicon、域名简称、立场微徽标（反驳/支持/待核对）。
 * 2. SourceContent: 悬浮 / 聚焦浮层 Popover 卡片，展示完整标题、权威摘录、外链，
 *    并提供「查看完整引文卡片」无缝联动 SourceDrawer。
 */
import { useState, type CSSProperties } from "react";
import type { InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";
import { domainOf, ROLE_LABEL, sourceExcerpt } from "./snapshotUi";

type PromptKitSourceProps = {
  link: InvestigationEvidenceLink;
  source: InvestigationSource;
  claimId: string;
  onSelect: (link: InvestigationEvidenceLink, source: InvestigationSource, claimId: string, trigger: HTMLElement) => void;
  entering?: boolean;
  enterDelayMs?: number;
};

export function PromptKitSource({ link, source, claimId, onSelect, entering = false, enterDelayMs = 0 }: PromptKitSourceProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const domain = domainOf(source.url || "") || "source";
  const title = source.title || source.url || link.sourceId;
  const excerpt = sourceExcerpt(source);
  const roleLabel = ROLE_LABEL[link.role];
  const displayBadgeLabel = roleLabel.endsWith("材料") ? roleLabel : `${roleLabel}材料`;
  const faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(domain)}`;

  return (
    <div
      className={`gp-source-container${entering ? " is-enter" : ""}`}
      data-gp-source-pill={link.sourceId}
      data-gp-pill-role={link.role}
      style={entering ? ({ ["--gp-enter-delay" as string]: `${enterDelayMs}ms` } as CSSProperties) : undefined}
    >
      {/* SourceTrigger (Pill) */}
      <button
        type="button"
        className={`gp-source-pill is-${link.role}`}
        data-gp-pill-id={link.sourceId}
        aria-label={`${roleLabel}：${title}`}
        onClick={(e) => onSelect(link, source, claimId, e.currentTarget)}
      >
        {!imgFailed ? (
          <img
            src={faviconUrl}
            alt=""
            className="gp-source-favicon"
            onError={() => setImgFailed(true)}
            aria-hidden="true"
          />
        ) : (
          <span className="gp-source-favicon-fallback" aria-hidden="true">🌐</span>
        )}
        <span className="gp-source-domain">{domain}</span>
        <span className={`gp-source-stance-tag is-${link.role}`}>{roleLabel}</span>
      </button>

      {/* SourceContent (Hover/Focus Popover) */}
      <div className="gp-source-popover" role="tooltip">
        <div className="gp-source-popover-meta">
          <span className={`gp-source-popover-badge is-${link.role}`}>{displayBadgeLabel}</span>
          <span className="gp-source-popover-domain">{domain} ↗</span>
        </div>
        <h5 className="gp-source-popover-title">{title}</h5>
        {excerpt ? (
          <blockquote className={`gp-source-popover-snippet is-${link.role}`}>
            {excerpt}
          </blockquote>
        ) : null}
        <div className="gp-source-popover-footer">
          <span className="gp-source-popover-tip">点击查看详细档案</span>
          <button
            type="button"
            className="gp-source-popover-action"
            onClick={(e) => onSelect(link, source, claimId, e.currentTarget)}
          >
            查看完整引文卡片 ❯
          </button>
        </div>
      </div>
    </div>
  );
}
