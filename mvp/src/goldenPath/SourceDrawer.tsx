/**
 * SourceDrawer — 来源下钻（Issue #52 第五节第三层）。
 * 展示 title / excerpt / URL domain / 与命题的关系 / reachable=false 警示。
 */
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { domainOf } from "./snapshotUi";
import type { InvestigationSource } from "@rhg/core/investigation";

type SourceDrawerProps = {
  source: InvestigationSource;
  relationLabel: string;
  onClose: () => void;
};

export function SourceDrawer({ source, relationLabel, onClose }: SourceDrawerProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  return (
    <>
      <button type="button" className="gp-scrim" aria-label={copy.sourceClose} onClick={onClose} />
      <aside className="gp-drawer gp-drawer--source" role="dialog" aria-label={source.title || source.url}>
        <header className="gp-drawer-head">
          <strong className="gp-source-title">{source.title || domainOf(source.url)}</strong>
          <button type="button" className="gp-icon-btn" onClick={onClose} aria-label={copy.sourceClose}>
            ✕
          </button>
        </header>
        {source.excerpt ? <p className="gp-source-excerpt">{source.excerpt}</p> : null}
        <dl className="gp-source-meta">
          <div>
            <dt>{copy.sourceRelation}</dt>
            <dd>{relationLabel}</dd>
          </div>
          <div>
            <dt>URL</dt>
            <dd className="gp-source-domain">{domainOf(source.url)}</dd>
          </div>
        </dl>
        {source.reachable === false ? (
          <p className="gp-source-unreachable" role="alert">
            {copy.sourceUnreachable}
          </p>
        ) : null}
        <a className="gp-primary-btn gp-source-open" href={source.url} target="_blank" rel="noreferrer">
          {copy.viewSource}
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </aside>
    </>
  );
}
