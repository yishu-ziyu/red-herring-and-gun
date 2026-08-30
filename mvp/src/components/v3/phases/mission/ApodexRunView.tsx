/**
 * Live Apodex-shaped run surface. Events come from orchestrate-stream.
 * Completed rounds can send a follow-up; it stays on this thread.
 */
import { useEffect, useRef, useState } from "react";
import { TodoList } from "./TodoList";
import type { ApodexRunModel, ApodexStep } from "./apodexRunMap";
import { ResearchMemo } from "./ResearchMemo";
import { UiLangSwitch } from "../../UiLangSwitch";
import { processStepLabel, stopChromeLabel, type UiCopy } from "../../../../lib/uiLang";
import { useUiLang } from "../../../../lib/useUiLang";
import styles from "./ApodexRunView.module.css";

export type ApodexRunViewProps = {
  model: ApodexRunModel;
  elapsedMs?: number;
  runStatus?: "idle" | "running" | "completed" | "failed";
  onStop: () => void;
  stopLabel?: string;
  stallNotice?: string;
  fallbackNotice?: string;
  /** Prior completed turns stay above the current bubble. */
  priorTurns?: ApodexRunModel[];
  /** Same-case follow-up. Omit to keep the box decorative (previews). */
  onFollowUp?: (text: string) => void;
};

function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const IcoThink = () => (
  <svg className={styles.ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v5l3 2" strokeLinecap="round" />
  </svg>
);
const IcoSearch = () => (
  <svg className={styles.ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" strokeLinecap="round" />
  </svg>
);
const IcoFile = () => (
  <svg className={styles.ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <path d="M7 4.5h7l4 4V19.5H7z" />
    <path d="M14 4.5V9h4" />
  </svg>
);
const IcoList = () => (
  <svg className={styles.ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
    <path d="M8 7h12M8 12h12M8 17h12" strokeLinecap="round" />
    <circle cx="4" cy="7" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="17" r="1" fill="currentColor" stroke="none" />
  </svg>
);
const IcoCheck = () => (
  <svg className={`${styles.ico} ${styles.check}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M5 12.5 10 17.5 19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IcoChev = () => (
  <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="m6 9 6 6 6-6" strokeLinecap="round" />
  </svg>
);
const IcoUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 19V6M6 12l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function statusGlyph(status: ApodexStep["status"]) {
  if (status === "loading") return <span className={styles.spin} aria-hidden />;
  if (status === "error") return <span aria-hidden>×</span>;
  return <IcoCheck />;
}

export function ApodexRunView({
  model,
  elapsedMs = 0,
  runStatus,
  onStop,
  stopLabel,
  stallNotice,
  fallbackNotice,
  priorTurns = [],
  onFollowUp,
}: ApodexRunViewProps) {
  const { copy } = useUiLang();
  const live =
    runStatus === "running" ||
    (runStatus !== "completed" && runStatus !== "failed" && model.live);
  const canFollow = Boolean(onFollowUp) && !live;
  const [boardOpen, setBoardOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const currentTurnRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (!live && model.report) {
      const current = currentTurnRef.current;
      if (priorTurns.length > 0 && current && typeof current.scrollIntoView === "function") {
        current.scrollIntoView({ block: "start", behavior: "auto" });
      } else {
        el.scrollTop = 0;
      }
      return;
    }
    if (!live) return;
    el.scrollTop = el.scrollHeight;
  }, [live, model.steps.length, model.report?.verdictLabel, priorTurns.length]);

  useEffect(() => {
    if (!canFollow) return;
    sentRef.current = false;
    composeRef.current?.focus();
  }, [canFollow]);

  const showBoard = model.boardVisible && boardOpen && model.board.length > 0;
  const boardDone = model.board.filter((t) => t.status === "done").length;
  const doneLabel = stopChromeLabel(live, stopLabel, copy);
  const canSend = canFollow && draft.trim().length > 0;

  const fitCompose = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const submitFollowUp = () => {
    const next = draft.trim();
    if (!canFollow || !next || !onFollowUp || sentRef.current) return;
    sentRef.current = true;
    onFollowUp(next);
    setDraft("");
    if (composeRef.current) composeRef.current.style.height = "";
  };

  return (
    <div
      className={styles.desk}
      data-testid="apodex-run"
      data-board={showBoard ? "on" : "off"}
      data-live={live ? "true" : "false"}
    >
      <div className={styles.thread} ref={threadRef}>
        <div className={styles.langDock}>
          <UiLangSwitch />
        </div>
        {priorTurns.map((turn, index) => (
          <TurnSection
            key={`prior-${index}`}
            model={turn}
            live={false}
            copy={copy}
            boardOpen={false}
            onBoardToggle={() => undefined}
          />
        ))}
        <div ref={currentTurnRef}>
          <TurnSection
            key={`current-${priorTurns.length}`}
            model={model}
            live={live}
            elapsedMs={elapsedMs}
            stallNotice={stallNotice}
            fallbackNotice={fallbackNotice}
            copy={copy}
            boardOpen={boardOpen}
            onBoardToggle={() => setBoardOpen((v) => !v)}
          />
        </div>

        <div className={styles.follow}>
          <form
            className={styles.compose}
            onSubmit={(e) => {
              e.preventDefault();
              submitFollowUp();
            }}
          >
            <textarea
              ref={composeRef}
              rows={1}
              value={canFollow ? draft : ""}
              onChange={(e) => {
                setDraft(e.target.value);
                fitCompose(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                submitFollowUp();
              }}
              placeholder={live ? copy.checking : copy.followUp}
              disabled={!canFollow}
              aria-disabled={!canFollow}
              aria-label={copy.followUp}
              title={live ? copy.followLiveTitle : copy.followDoneTitle}
            />
            <button
              className={styles.stopBtn}
              type="button"
              data-done={live ? "false" : "true"}
              onClick={onStop}
            >
              {live ? `■ ${doneLabel}` : doneLabel}
            </button>
            <button
              className={styles.send}
              type="submit"
              disabled={!canSend}
              aria-label={canFollow ? copy.send : copy.sendUnavailable}
            >
              <IcoUp />
            </button>
          </form>
          <p className={styles.disclaimer}>
            {copy.disclaimer}
          </p>
        </div>
      </div>

      {showBoard ? (
        <aside className={styles.board} aria-label={copy.taskBoard}>
          <div className={styles.boardHead}>
            <span>{copy.taskBoard}</span>
            <span className={styles.boardCount}>
              {boardDone}/{model.board.length}
            </span>
            <button className={styles.boardClose} type="button" onClick={() => setBoardOpen(false)}>
              ×
            </button>
          </div>
          <TodoList items={model.board} title={copy.todoTitle} hideHead />
        </aside>
      ) : null}
    </div>
  );
}

function TurnSection({
  model,
  live,
  elapsedMs = 0,
  stallNotice,
  fallbackNotice,
  copy,
  boardOpen,
  onBoardToggle,
}: {
  model: ApodexRunModel;
  live: boolean;
  elapsedMs?: number;
  stallNotice?: string;
  fallbackNotice?: string;
  copy: UiCopy;
  boardOpen: boolean;
  onBoardToggle: () => void;
}) {
  const [processOpen, setProcessOpen] = useState(!model.report);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [ticker, setTicker] = useState<{ id: string; at: number } | null>(null);
  const tickingId = model.steps.find((s) => s.kind === "thought" && s.ticker && s.status === "loading")?.id;
  if (tickingId && ticker?.id !== tickingId) setTicker({ id: tickingId, at: Date.now() });
  if (!tickingId && ticker != null) setTicker(null);

  useEffect(() => {
    if (model.report) setProcessOpen(false);
    else if (live) setProcessOpen(true);
  }, [model.report?.verdictLabel, live]);

  const isOpen = (id: string) => openIds[id] === true;
  const toggle = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const stepCount = model.steps.filter((s) => s.kind !== "board").length;
  const pill = live
    ? `${formatClock(elapsedMs)} · ${stepCount} ${copy.stepsUnit}`
    : `${stepCount} ${copy.stepsUnit} · ${copy.stepsComplete}`;

  return (
    <div className={styles.turn}>
      <div className={styles.qRow}>
        <div className={styles.qBubble} data-testid="claim-bubble">
          {model.claim}
        </div>
      </div>

      {live && stallNotice ? <p className={styles.stall}>{stallNotice}</p> : null}
      {live && fallbackNotice ? <p className={styles.stall}>{fallbackNotice}</p> : null}
      {model.errorMessage && !model.report ? (
        <p className={styles.alert} role="alert">
          {model.errorMessage}
        </p>
      ) : null}

      {model.steps.length === 0 && live ? (
        <div className={styles.planning}>
          <span className={styles.spin} aria-hidden />
          <span>{copy.planning}</span>
        </div>
      ) : null}

      {model.steps.length > 0 && (live || stepCount > 0) ? (
        <div>
          <button
            className={styles.runHead}
            type="button"
            aria-expanded={processOpen}
            onClick={() => setProcessOpen((v) => !v)}
          >
            <span className={styles.runLeft}>
              {live ? <span className={styles.spin} aria-hidden /> : <IcoCheck />}
              <span>{copy.runProcess}</span>
            </span>
            <span className={styles.runRight}>
              <span className={styles.runPill}>{pill}</span>
              <IcoChev />
            </span>
          </button>

          {processOpen ? (
            <div className={styles.steps}>
              {model.steps.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  open={isOpen(step.id)}
                  tickerOrigin={ticker?.at ?? null}
                  onToggle={() => {
                    if (step.kind === "board") {
                      onBoardToggle();
                      return;
                    }
                    toggle(step.id);
                  }}
                  boardOpen={boardOpen}
                  copy={copy}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {model.report ? (
        <article className={styles.report} aria-label="核心结论">
          <ResearchMemo
            markdown={model.report.memo}
            sources={model.report.sources}
            tone={model.report.tone}
          />
          {fallbackNotice && !live ? (
            <p className={styles.advice}>{fallbackNotice}</p>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}



function TickerSeconds({ startedAt }: { startedAt: number }) {
  const [sec, setSec] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => {
      setSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return <span>{` ${sec}s`}</span>;
}

function StepRow({
  step,
  open,
  onToggle,
  boardOpen,
  tickerOrigin,
  copy,
}: {
  step: ApodexStep;
  open: boolean;
  onToggle: () => void;
  boardOpen: boolean;
  tickerOrigin: number | null;
  copy: UiCopy;
}) {
  const label = processStepLabel(step, copy);
  if (step.kind === "thought") {
    const hasBody = Boolean(step.paragraphs && step.paragraphs.length > 0);
    const liveTicker = Boolean(step.ticker && step.status === "loading");
    const head = (
      <>
        {liveTicker ? <span className={styles.spin} aria-hidden /> : <IcoThink />}
        {label}
        {liveTicker && tickerOrigin != null ? <TickerSeconds startedAt={tickerOrigin} /> : null}
        {hasBody ? <IcoChev /> : null}
      </>
    );
    return (
      <div className={styles.stepEnter}>
        {hasBody ? (
          <button
            className={styles.thoughtBtn}
            type="button"
            aria-expanded={open}
            onClick={onToggle}
          >
            {head}
          </button>
        ) : (
          <div className={styles.thoughtBtn} aria-live={step.ticker ? "polite" : undefined}>
            {head}
          </div>
        )}
        {open && hasBody ? (
          <div className={styles.thoughtBody}>
            {step.paragraphs!.map((p, i) => (
              <p key={`${step.id}-${i}`}>{p}</p>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (step.kind === "board") {
    return (
      <button className={`${styles.boardCreated} ${styles.stepEnter}`} type="button" onClick={onToggle}>
        <IcoList />
        <span>{label}</span>
        <span className={styles.hideBoard}>{boardOpen ? copy.hideBoard : copy.viewBoard}</span>
      </button>
    );
  }

  return (
    <div className={`${styles.toolCard} ${styles.stepEnter}`}>
      <button
        className={styles.toolBtn}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        {step.kind === "search" ? <IcoSearch /> : <IcoFile />}
        <span className={styles.toolKind}>{label}</span>
        {step.detail ? <span className={styles.toolDetail}>{step.detail}</span> : null}
        <span className={styles.toolEnd} data-status={step.status}>
          {statusGlyph(step.status)}
          <IcoChev />
        </span>
      </button>
      {open ? (
        <div className={styles.visitPanel}>
          {step.kind === "search" ? (
            <>
              {step.query || step.detail ? (
                <div className={styles.visitBox}>{step.query || step.detail}</div>
              ) : null}
              {step.sites && step.sites.length > 0
                ? step.sites.map((site, i) => (
                    <div
                      key={site.id}
                      className={styles.visitBox}
                      style={{ animationDelay: `${Math.min(i, 7) * 70}ms` }}
                    >
                      {site.href ? (
                        <a href={site.href} target="_blank" rel="noopener noreferrer">
                          {site.title}
                        </a>
                      ) : (
                        site.title
                      )}
                    </div>
                  ))
                : null}
            </>
          ) : (
            <>
              {(step.visit?.urls?.length ? step.visit.urls : step.visit?.url ? [step.visit.url] : []).map((url) => (
                <div key={url} className={styles.visitBox}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </div>
              ))}
              {step.visit?.query ? <div className={styles.visitBox}>{step.visit.query}</div> : null}
              {step.visit?.info ? <div className={styles.visitBox}>{step.visit.info}</div> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
