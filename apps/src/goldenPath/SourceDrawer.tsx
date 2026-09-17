/**
 * SourceDrawer — 权威来源出处卡片下钻（Issue #65）。
 * 遵循消费级产品排版规范与卡片化设计，提供结构化引述、命题关联与主核查跳转。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { ROLE_LABEL, domainOf, identifyEvidenceLinks } from "./snapshotUi";
import type { InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export type SourceDrawerView = {
  claimId: string;
  claimIndex: number;
  claimText: string;
  source: InvestigationSource;
  link: InvestigationEvidenceLink;
  relatedSources?: InvestigationSource[];
};

type SourceDrawerProps = {
  view: SourceDrawerView;
  resolveState?: "live" | "held";
  onClose: () => void;
};

function isSheetPlacement(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("disabled")) return false;
    if (el.tabIndex < 0) return false;
    return true;
  });
}

export function SourceDrawer({ view, resolveState = "live", onClose }: SourceDrawerProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const reduced = prefersReducedMotion();
  const [openClass, setOpenClass] = useState(reduced);
  const [placement] = useState<"sheet" | "drawer">(isSheetPlacement() ? "sheet" : "drawer");
  const [imgFailed, setImgFailed] = useState(false);
  const { source, link, claimText, claimIndex } = view;
  const num = String(claimIndex + 1).padStart(2, "0");
  const relation = ROLE_LABEL[link.role];
  const excerpt = link.passage?.trim() || source.excerpt?.trim();
  const sectionTitle = link.sectionTitle?.trim();
  const relationReason = link.relationReason?.trim();
  const finding = link.finding?.trim();
  const limitation = link.limitation?.trim();
  const unreachable = source.reachable === false;
  const published = source.publishedAt?.trim();
  const retrieved = source.retrievedAt?.trim();
  const domain = domainOf(source.url) || "source";
  // 关联来源 chips：排除当前正在查看的来源（它的完整信息就在本抽屉里），
  // idx 保留在 relatedSources 里的原位置，让 [n] 角标编号与 chips 标注一致。
  const relatedChips = (view.relatedSources ?? [])
    .map((s, idx) => ({ source: s, idx }))
    .filter(({ source: s }) => s.id !== source.id);
  const faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(domain)}`;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpenClass(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const topbar = document.querySelector<HTMLElement>(".gp-topbar");
    const canvasInner = document.querySelector<HTMLElement>(".gp-canvas-inner");
    const inertTargets = [topbar, canvasInner].filter((el): el is HTMLElement => Boolean(el));
    for (const el of inertTargets) {
      el.setAttribute("inert", "");
    }

    const closeBtn = panel?.querySelector<HTMLElement>("[data-gp-source-close]");
    closeBtn?.focus();
    if (panel && document.activeElement !== closeBtn) {
      panel.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      event.preventDefault();
      const items = focusableIn(panel);
      if (items.length === 0) {
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const idx = items.indexOf(active as HTMLElement);
      if (event.shiftKey) {
        const next = idx <= 0 ? items[items.length - 1] : items[idx - 1];
        next?.focus();
      } else {
        const next = idx === -1 || idx >= items.length - 1 ? items[0] : items[idx + 1];
        next?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const el of inertTargets) {
        el.removeAttribute("inert");
        try {
          el.inert = false;
        } catch {
          /* jsdom may not implement the inert setter */
        }
      }
    };
  }, [onClose]);

  return (
    <div className="gp-source-layer" data-gp-source-layer>
      <button
        type="button"
        className={`gp-scrim${openClass ? " is-open" : ""}`}
        aria-label={copy.sourceClose}
        tabIndex={-1}
        data-gp-scrim="source"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className={`gp-drawer gp-drawer--source${openClass ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-gp-placement={placement}
        data-gp-reduced-motion={reduced || undefined}
        data-gp-claim-id={view.claimId}
        data-gp-source-id={source.id}
        data-gp-role={link.role}
        data-gp-source-resolve={resolveState}
      >
        <header className="gp-drawer-head">
          <div className="gp-source-head-text">
            <div className="gp-source-kicker">
              <span className={`gp-source-stance-badge is-${link.role}`}>
                <span className={`gp-role-glyph is-${link.role}`} aria-hidden="true">
                  {link.role === "support" || link.role === "contradict" ? "●" : link.role === "context-only" ? "○" : "◌"}
                </span>
                <span>
                  {copy.sourceRelation}：{relation}
                </span>
              </span>
              <span className="gp-source-domain-tag">
                {!imgFailed ? (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="gp-source-head-favicon"
                    onError={() => setImgFailed(true)}
                    aria-hidden="true"
                  />
                ) : (
                  <span aria-hidden="true">🌐</span>
                )}
                <span className="gp-source-domain">{domain}</span>
              </span>
            </div>
            <strong className="gp-source-title" id={titleId}>
              {source.title || domain}
            </strong>
            {sectionTitle ? (
              <p className="gp-source-section-hit" data-gp-source-section-title>
                {lang === "en" ? "Matched section" : "命中小节"}：{sectionTitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="gp-icon-btn gp-drawer-close-btn"
            onClick={onClose}
            aria-label={copy.sourceClose}
            data-gp-source-close
          >
            ✕
          </button>
        </header>

        <div className="gp-source-body">
          <div className="gp-source-card">
            {excerpt ? (
              <section className="gp-source-block is-excerpt-lead" data-gp-source-section="excerpt">
                <div className="gp-source-section-header">
                  <span className="gp-source-section-icon" aria-hidden="true">❝</span>
                  <h3 className="gp-source-label">{copy.sourceExcerpt}</h3>
                </div>
                <blockquote className={`gp-source-excerpt is-${link.role}`}>
                  <p className="gp-source-excerpt-text">{excerpt}</p>
                </blockquote>
              </section>
            ) : null}

            <section className="gp-source-block gp-source-claim-block" data-gp-source-section="claim">
              <div className="gp-source-claim-card">
                <span className="gp-source-claim-tag">{copy.sourceAgainstClaim}</span>
                <span className="gp-source-claim-num" aria-hidden="true">
                  {num}
                </span>
                <p className="gp-source-claim-text">{claimText}</p>
                {relationReason ? (
                  <p className="gp-source-relation-reason" data-gp-source-relation-reason>
                    {lang === "en" ? "Why this relation" : "为什么是这个关系"}：{relationReason}
                  </p>
                ) : null}
              </div>
            </section>

            {finding ? (
              <section className="gp-source-block gp-source-finding-block" data-gp-source-section="finding">
                <div className="gp-source-section-header">
                  <div className="gp-source-section-title-wrap">
                    <span className="gp-source-section-icon" aria-hidden="true">✦</span>
                    <h3 className="gp-source-label">{copy.sourceFinding}</h3>
                  </div>
                  <span className="gp-source-section-tag">核心核验洞察</span>
                </div>
                <p className="gp-source-prose">{renderFindingWithCitations(finding, view.relatedSources)}</p>

                {relatedChips.length > 0 ? (
                  <div className="gp-finding-sources" data-gp-source-section="cited-sources">
                    <div className="gp-finding-sources-head">
                      <span className="gp-finding-sources-label">关联核验来源 ({relatedChips.length})</span>
                    </div>
                    <div className="gp-finding-sources-chips">
                      {relatedChips.map(({ source: s, idx }) => {
                        const sDomain = domainOf(s.url);
                        const sFavicon = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(sDomain)}`;
                        const isCurrent = s.id === source.id;
                        return (
                          <a
                            key={s.id || idx}
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`gp-finding-source-chip${isCurrent ? " is-current" : ""}`}
                            title={`${s.title || sDomain} (${sDomain})`}
                          >
                            <span className="gp-finding-source-index">[{idx + 1}]</span>
                            <img src={sFavicon} alt="" className="gp-finding-source-fav" aria-hidden="true" />
                            <span className="gp-finding-source-title">{s.title || sDomain}</span>
                            <span className="gp-finding-source-arrow" aria-hidden="true">↗</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {limitation ? (
              <section className="gp-source-block gp-source-limitation-block" data-gp-source-section="limitation">
                <div className="gp-source-section-header">
                  <span className="gp-source-section-icon" aria-hidden="true">⚠️</span>
                  <h3 className="gp-source-label">{copy.sourceLimitation}</h3>
                </div>
                <p className="gp-source-prose">{limitation}</p>
              </section>
            ) : null}

            {(published || retrieved || unreachable) ? (
              <section className="gp-source-block gp-source-meta-block" data-gp-source-section="status">
                <div className="gp-source-meta-row">
                  {published ? (
                    <span className="gp-source-time">
                      {copy.sourcePublished} {published}
                    </span>
                  ) : null}
                  {retrieved ? (
                    <span className="gp-source-time">
                      {copy.sourceRetrieved} {retrieved}
                    </span>
                  ) : null}
                </div>
                {unreachable ? (
                  <p className="gp-source-unreachable" role="status">
                    {copy.sourceUnreachable}
                  </p>
                ) : null}
              </section>
            ) : null}

            {source.url ? (
              <div className="gp-source-action-row">
                <a
                  className="gp-source-open"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="gp-source-open-icon" aria-hidden="true">🌐</span>
                  <span className="gp-source-open-label">{copy.sourceOpen}</span>
                  <span className="gp-source-open-domain">({domain})</span>
                  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function renderFindingWithCitations(text: string, sources?: InvestigationSource[]): React.ReactNode {
  const regex = /\[(\d+)\]/g;
  const elements: (string | React.ReactElement)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const preText = text.slice(lastIndex, match.index);
    if (preText) {
      elements.push(preText);
    }
    const n = Number(match[1]);
    const s = sources && sources[n - 1];
    const tip = s ? `[${n}] ${s.title || domainOf(s.url)}` : `引证来源 [${n}]`;

    elements.push(
      s?.url ? (
        <a
          key={`cite-${match.index}-${n}`}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="gp-finding-cite-badge"
          title={tip}
          data-gp-cite={n}
        >
          {n}
        </a>
      ) : (
        <span
          key={`cite-${match.index}-${n}`}
          className="gp-finding-cite-badge"
          title={tip}
          data-gp-cite={n}
        >
          {n}
        </span>
      )
    );
    lastIndex = regex.lastIndex;
  }

  const rest = text.slice(lastIndex);
  if (rest) {
    elements.push(rest);
  }

  return elements.length > 0 ? elements : text;
}

/** 只有当前 snapshot 存在且唯一的 `identifyEvidenceLinks` key === identity 才返回 live view。 */
export function resolveSourceDrawerView(
  claims: Array<{ id: string; text: string; evidence: InvestigationEvidenceLink[] }>,
  sources: InvestigationSource[],
  claimId: string,
  identity: string,
): SourceDrawerView | null {
  const claimIndex = claims.findIndex((c) => c.id === claimId);
  const claim = claimIndex >= 0 ? claims[claimIndex] : undefined;
  if (!claim || !identity) return null;
  const identified = identifyEvidenceLinks(claim.id, claim.evidence);
  const matches = identified.filter((row) => row.key === identity);
  if (matches.length !== 1) return null;
  const link = matches[0]!.link;
  const source = sources.find((s) => s.id === link.sourceId);
  if (!source) return null;

  const relatedSources: InvestigationSource[] = [];
  for (const e of claim.evidence) {
    const s = sources.find((item) => item.id === e.sourceId);
    if (s && !relatedSources.some((item) => item.id === s.id)) {
      relatedSources.push(s);
    }
  }

  return {
    claimId: claim.id,
    claimIndex,
    claimText: claim.text,
    source,
    link,
    relatedSources: relatedSources.length > 0 ? relatedSources : [source],
  };
}

/** 用户刚点中的 exact EvidenceLink，不做 unique resolve，也不丢进全局 lastView。 */
export function buildSourceDrawerViewFromClick(
  claims: Array<{ id: string; text: string; evidence: InvestigationEvidenceLink[] }>,
  claimId: string,
  source: InvestigationSource,
  link: InvestigationEvidenceLink,
  allSources?: InvestigationSource[],
): SourceDrawerView | null {
  const claimIndex = claims.findIndex((c) => c.id === claimId);
  const claim = claimIndex >= 0 ? claims[claimIndex] : undefined;
  if (!claim) return null;

  const relatedSources: InvestigationSource[] = [];
  if (allSources) {
    for (const e of claim.evidence) {
      const s = allSources.find((item) => item.id === e.sourceId);
      if (s && !relatedSources.some((item) => item.id === s.id)) {
        relatedSources.push(s);
      }
    }
  }
  if (relatedSources.length === 0) {
    relatedSources.push(source);
  }

  return {
    claimId: claim.id,
    claimIndex,
    claimText: claim.text,
    source,
    link,
    relatedSources,
  };
}

/** 当前 Drawer 自己的 session identity：能对齐 view-layer evidence key 就用它，否则退回打开参数。 */
export function sourceDrawerSessionIdentity(
  claimId: string,
  evidence: InvestigationEvidenceLink[],
  link: InvestigationEvidenceLink,
): string {
  const identified = identifyEvidenceLinks(claimId, evidence);
  const row =
    identified.find((item) => item.link === link) ??
    identified.find(
      (item) =>
        item.link.sourceId === link.sourceId &&
        item.link.role === link.role &&
        item.link.finding === link.finding &&
        item.link.limitation === link.limitation,
    );
  return row?.key ?? `${claimId}:${link.sourceId}:${link.role}`;
}
