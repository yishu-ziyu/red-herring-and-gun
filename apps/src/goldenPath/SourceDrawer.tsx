/**
 * 全部资料：结果页上唯一一份完整的资料清单。各个要点下面只放一个引用，不再各列一遍资料；
 * 一份资料被几个要点用到，这里也只出现一次，和每个要点的关系都写在这一行里。
 *
 * #151 要求出处能查：材料是搜索摘要还是取得的正文、正文读到哪、摘句能不能跳到原文那一句、发布日期。
 * 这些都收在每一行的「看出处」里（EvidenceRow），不能因为页面变简单就丢掉。
 *
 * 抽屉由 AllSourcesButton 打开，它同时向引用卡登记打开方法，所以引用卡里「在全部资料里看」能打开抽屉并跳到那一行。
 * 结果页之外（比如没查完的页面）要让人看到全部资料，放一个 AllSourcesButton 即可。
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";
import { materialKindLabel, materialRetrievedLabel, sourceReadStatus } from "../lib/investigation";
import { Icon } from "./Icon";
import { journeyCopy } from "./journeyCopy";
import { publishedDay } from "./snapshotUi";
import { SourceFavicon, useRegisterDrawerOpener } from "./SourcePill";
import {
  hostOf,
  publisherOf,
  relationHref,
  relationPassage,
  relationText,
  ROLE_LABEL,
  ROLE_TONE,
  siteOf,
  snapshotSourceEntries,
  sourceEntryDomId,
  type SourceEntry,
} from "./sourceUi";
import "./drawer.css";

/* ---------- 一条依据的出处 ---------- */

/**
 * 一条依据（一份资料 × 一个要点）实际取得了什么材料。进度页没查完的要点也直接用它。
 * claimNo：放在全部资料里时，资料名和标题已经写在这一行上面，这里只写它和第几个要点的关系；不给就写立场词和资料标题。
 */
export function EvidenceProvenance({
  claimId,
  link,
  source,
  claimNo,
}: {
  claimId: string;
  link: InvestigationEvidenceLink;
  source: InvestigationSource;
  claimNo?: number;
}) {
  // 引文只保证出自这条依据实际取得的文字；摘要不能冒充网页正文。
  const quote = link.quote?.trim() ?? "";
  const summary = quote ? "" : link.relationReason?.trim() ?? "";
  const href = relationHref({ source, link });
  const day = publishedDay(source);
  const passage = link.passage?.trim() ?? "";
  const limitation = link.limitation?.trim() ?? "";
  const name = claimNo ? siteOf(source.url) || publisherOf(source) : source.title?.trim() || publisherOf(source);
  return (
    <li
      className="gp-ev"
      data-gp-evidence-row
      data-gp-role={link.role}
      data-gp-evidence-claim={claimId}
      data-gp-source-id={source.id}
      data-gp-material-kind={link.excerptKind ?? "unknown"}
      data-gp-key-evidence={link.role === "support" || link.role === "contradict" ? "" : undefined}
      data-gp-related={link.role === "context-only" || link.role === "unassessed" ? "" : undefined}
    >
      <p className="gp-ev-head">
        {claimNo ? (
          <span className="gp-ev-rel">{relationText(link.role, claimNo)}</span>
        ) : (
          <span className={`gp-label gp-label--small gp-label--${ROLE_TONE[link.role]}`}>{ROLE_LABEL[link.role]}</span>
        )}
        {href ? (
          <a className="gp-ev-link" href={href} target="_blank" rel="noopener noreferrer" data-gp-evidence-link>
            {name}
            <Icon name="arrow-up-right" />
          </a>
        ) : (
          <span>{name}</span>
        )}
        <span className={day ? "gp-ev-date" : "gp-ev-date is-unknown"} data-gp-published={day ?? ""}>
          {day ?? journeyCopy.publishedUnknown}
        </span>
        {source.reachable === false ? <span className="gp-ev-dead">打不开</span> : null}
        {link.provenance === "prior-round" ? <span data-gp-prior-round-mark>依据来自刚才那一轮</span> : null}
      </p>
      {quote ? (
        <>
          <span className="gp-ev-kind">{materialKindLabel(link.excerptKind)}中的摘句</span>
          <q className="gp-ev-quote" data-gp-evidence-quote>{quote}</q>
        </>
      ) : null}
      {summary ? (
        <p className="gp-ev-summary" data-gp-evidence-summary>
          {journeyCopy.ourSummary(summary)}
        </p>
      ) : null}
      {/* 放在全部资料里时，关系句已经说了「还没读完，没有算进第 N 个要点的判断」。 */}
      {link.role === "unassessed" && !claimNo ? <p className="gp-ev-note">{journeyCopy.notRead}</p> : null}
      {limitation ? <p className="gp-ev-note">{limitation}</p> : null}
      <p className="gp-ev-status" data-gp-material-status>
        资料状态：{sourceReadStatus(source)}
        {source.fetchNote ? `；${source.fetchNote}` : ""}
        {link.excerptKind === "search-snippet" && source.excerptKind === "page-excerpt" ? "。这条依据核对的是搜索摘要，不是已取得的正文" : ""}
      </p>
      <details className="gp-ev-material" data-gp-material>
        <summary>
          <Icon name="chevron-right" className="gp-chevron" />
          查看取得的资料
        </summary>
        <div className="gp-ev-material-body">
          <p className="gp-ev-status">这条依据用到的资料：{materialKindLabel(link.excerptKind)}</p>
          {passage ? <blockquote data-gp-material-text>{passage}</blockquote> : <p>这条依据没有保存可检查的上下文。</p>}
          <p className="gp-ev-status">资料{materialRetrievedLabel(source.retrievedAt)}</p>
        </div>
      </details>
    </li>
  );
}

/** 找到了、但没挂到任何要点上的资料：没有依据可说，只交代读取情况和日期，不给它安一个立场。 */
function SourceOnlyOrigin({ source }: { source: InvestigationSource }) {
  const day = publishedDay(source);
  return (
    <div className="gp-ev" data-gp-material-kind={source.excerptKind ?? "unknown"}>
      <p className="gp-ev-head">
        <span className={day ? "gp-ev-date" : "gp-ev-date is-unknown"} data-gp-published={day ?? ""}>
          {day ?? journeyCopy.publishedUnknown}
        </span>
        {source.reachable === false ? <span className="gp-ev-dead">打不开</span> : null}
      </p>
      <p className="gp-ev-status" data-gp-material-status>
        资料状态：{sourceReadStatus(source)}
        {source.fetchNote ? `；${source.fetchNote}` : ""}
      </p>
      <p className="gp-ev-status">资料类型：{materialKindLabel(source.excerptKind)}</p>
      <p className="gp-ev-status">资料{materialRetrievedLabel(source.retrievedAt)}</p>
      {source.excerpt ? <blockquote data-gp-material-text>{source.excerpt}</blockquote> : null}
    </div>
  );
}

/* ---------- 抽屉里的一行 ---------- */

function SourceRow({ entry, claims }: { entry: SourceEntry; claims: InvestigationClaim[] }) {
  const { source, relations, primaryRole } = entry;
  const primary = relations.find((relation) => relation.role === primaryRole);
  const title = source.title?.trim() || publisherOf(source);
  const quote = primary ? relationPassage({ source, link: primary.link }) : source.excerpt?.trim() ?? "";
  const meta = [siteOf(source.url) || publisherOf(source), ...relations.map((r) => relationText(r.role, r.claimNo))].join(" · ");
  return (
    <li
      id={sourceEntryDomId(source.id)}
      className="gp-srow"
      tabIndex={-1}
      data-gp-source-entry={source.id}
      data-gp-source-role={primaryRole ?? ""}
      data-gp-source-pill={source.id}
    >
      <SourceFavicon url={source.url} className="gp-srow-fav" />
      <div className="gp-srow-body">
        <div className="gp-srow-head">
          {hostOf(source.url) ? (
            <a className="gp-srow-title" href={source.url} target="_blank" rel="noopener noreferrer" title={title}>
              {title}
            </a>
          ) : (
            <span className="gp-srow-title" title={title}>
              {title}
            </span>
          )}
          {primaryRole ? (
            <span className={`gp-label gp-label--small gp-label--${ROLE_TONE[primaryRole]}`}>{ROLE_LABEL[primaryRole]}</span>
          ) : null}
        </div>
        <p className="gp-srow-meta">{meta}</p>
        {quote ? <blockquote className="gp-srow-quote">「{quote}」</blockquote> : null}
        <details className="gp-srow-origin" data-gp-source-origin>
          <summary>
            <Icon name="chevron-right" className="gp-chevron" />
            {journeyCopy.showOrigin}
          </summary>
          {relations.length > 0 ? (
            <ul className="gp-srow-evidence">
              {claims.flatMap((claim, index) => claim.evidence
                .filter((link) => link.sourceId === source.id)
                .map((link, evidenceIndex) => (
                  <EvidenceProvenance
                    key={`${claim.id}:${evidenceIndex}`}
                    claimId={claim.id}
                    claimNo={index + 1}
                    link={link}
                    source={source}
                  />
                )))}
            </ul>
          ) : (
            <SourceOnlyOrigin source={source} />
          )}
        </details>
      </div>
    </li>
  );
}

/* ---------- 打开抽屉的按钮 ---------- */

type Opened = { sourceId: string | null; trigger: HTMLElement | null; seq: number };

/**
 * 「全部 N 份资料」。claims 必须是页面上显示的那一组要点（和引用用同一组），否则「第 N 个要点」对不上。
 * 一份资料都没有就不显示，也不登记，引用卡上就不出现「在全部资料里看」。
 */
export function AllSourcesButton({ sources, claims }: { sources: InvestigationSource[]; claims: InvestigationClaim[] }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const seq = useRef(0);
  const drawerId = useId();
  const open = (sourceId: string | null, trigger: HTMLElement | null) =>
    setOpened({ sourceId, trigger, seq: ++seq.current });
  useRegisterDrawerOpener(sources.length > 0 ? open : undefined);
  const onClosed = useCallback(() => setOpened(null), []);

  if (sources.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="gp-text-btn"
        aria-haspopup="dialog"
        aria-expanded={Boolean(opened)}
        aria-controls={opened ? drawerId : undefined}
        data-gp-open-sources
        onClick={(event) => open(null, event.currentTarget)}
      >
        {journeyCopy.allSources(sources.length)}
      </button>
      {opened ? (
        <SourceDrawer
          key={opened.seq}
          id={drawerId}
          sources={sources}
          claims={claims}
          focusSourceId={opened.sourceId}
          returnFocus={opened.trigger}
          onClosed={onClosed}
        />
      ) : null}
    </>
  );
}

/* ---------- 抽屉 ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), summary, [tabindex="0"]';
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function SourceDrawer({
  id,
  sources,
  claims,
  focusSourceId,
  returnFocus,
  onClosed,
}: {
  id: string;
  sources: InvestigationSource[];
  claims: InvestigationClaim[];
  /** 从引用卡「在全部资料里看」打开时，要跳到的那份资料。 */
  focusSourceId: string | null;
  /** 打开抽屉的按钮或引用。 */
  returnFocus: HTMLElement | null;
  onClosed: () => void;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);
  const entered = useRef(false);
  const entries = useMemo(() => snapshotSourceEntries(sources, claims), [sources, claims]);
  const close = useCallback(() => setClosing(true), []);

  // 打开时：焦点进抽屉，页面不能在抽屉后面跟着滚。留出滚动条的位置，页面不会横跳。
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previous = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter, bodyOverflow: body.style.overflow };
    root.style.overflow = "hidden";
    root.style.scrollbarGutter = "stable";
    body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
      body.style.overflow = previous.bodyOverflow;
      // 关上以后把焦点还给打开它的那个按钮或引用，键盘用户不会被扔回页首。
      if (returnFocus?.isConnected) {
        const suppressPopover = (event: Event) => event.stopPropagation();
        returnFocus.addEventListener("focusin", suppressPopover);
        returnFocus.focus({ preventScroll: true });
        returnFocus.removeEventListener("focusin", suppressPopover);
      }
    };
    // 只在打开和关上时做一次；每次打开都是新的一个抽屉（key）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const keepFocus = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && !panel.contains(event.target)) panel.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", keepFocus);
    };
  }, [close]);

  // 没有退场动画（浏览器或系统关掉了动画）时直接收起，不等一个不会来的 animationend。
  useEffect(() => {
    const panel = panelRef.current;
    if (closing && (!panel || getComputedStyle(panel).animationName === "none")) onClosed();
  }, [closing, onClosed]);

  // 跳到那一行：等抽屉滑进来再滚过去、亮一下，不然用户看不到是哪一行。
  const showSource = useCallback(() => {
    if (!focusSourceId) return;
    const row = document.getElementById(sourceEntryDomId(focusSourceId));
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
    const done = (event: globalThis.AnimationEvent) => {
      if (event.animationName !== "gp-srow-flash") return;
      row.classList.remove("flash");
      row.removeEventListener("animationend", done);
    };
    row.addEventListener("animationend", done);
  }, [focusSourceId]);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && getComputedStyle(panel).animationName === "none") {
      entered.current = true;
      showSource();
    }
  }, [showSource]);

  const onAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (closing) onClosed();
    else if (!entered.current) {
      entered.current = true;
      showSource();
    }
  };

  // 焦点只在抽屉里转：Tab 到最后一个回到第一个，反过来也一样。
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const panel = panelRef.current;
    if (event.key !== "Tab" || !panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel || !items.includes(active as HTMLElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`gp-sources-layer${closing ? " is-closing" : ""}`}>
      <div className="gp-sources-scrim" aria-hidden="true" onClick={close} />
      <aside
        ref={panelRef}
        id={id}
        className="gp-sources-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        data-gp-source-drawer
        onKeyDown={onKeyDown}
        onAnimationEnd={onAnimationEnd}
      >
        <header className="gp-sources-head">
          <div className="gp-sources-heading">
            <h2 id={titleId} className="gp-sources-title">
              {journeyCopy.drawerTitle}
            </h2>
            <span id={subtitleId} className="gp-sources-sub">
              {journeyCopy.drawerSubtitle(sources.length)}
            </span>
          </div>
          <button type="button" className="gp-text-btn gp-text-btn--quiet" onClick={close} data-gp-drawer-close>
            {journeyCopy.drawerClose}
          </button>
        </header>
        <ul className="gp-sources-list">
          {entries.map((entry) => (
            <SourceRow key={entry.source.id} entry={entry} claims={claims} />
          ))}
        </ul>
      </aside>
    </div>,
    document.body,
  );
}
