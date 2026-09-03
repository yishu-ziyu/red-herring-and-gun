import type { Case } from '@rhg/core/casefile';
import { faceWord } from '@rhg/core/publicCopy';
import { useState, type FormEvent } from "react";
import { ABORT, SUBMIT_TURN, claimFace, faceTone, statusWord } from "../lib/copy.js";
import type { StreamStatus } from "../lib/useCaseStream.js";

export function ThreadView(props: {
  current: Case;
  running: boolean;
  status: StreamStatus;
  error: string | null;
  onSend: (text: string) => Promise<void>;
  onAbort: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const word = statusWord(props.current, props.running);
  const running = props.running;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = text.trim();
    if (!next || running) return;
    await props.onSend(next);
    setText("");
  }

  return (
    <div className="thread">
      <p className="status-line">{word}</p>
      {props.current.messages.map((message) => (
        <article
          key={message.id}
          className={message.role === "user" ? "bubble bubble-user font-serif" : "bubble"}
        >
          <p className="bubble-meta">{message.role === "user" ? "原句" : "回答"}</p>
          <p>{message.text}</p>
        </article>
      ))}
      {props.error ? <p className="err">{props.error}</p> : null}
      <form className="composer" onSubmit={onSubmit}>
        <label>
          <span className="muted">追问</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={false}
          />
        </label>
        <div className="composer-actions">
          {running ? (
            <button type="button" className="btn" onClick={() => void props.onAbort()}>
              {ABORT}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary">
              {SUBMIT_TURN}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function CasePanel(props: { current: Case; running: boolean }) {
  const word = statusWord(props.current, props.running);
  const overall = props.current.overall;
  return (
    <div>
      {overall ? (
        <p className="font-serif">
          {faceWord(overall.verdictType)}
          {` · ${overall.score}`}
        </p>
      ) : (
        <p className="muted">{word}</p>
      )}
      <p className="muted">
        命题 {props.current.claims.length} · 材料 {props.current.evidence.length}
      </p>
      <ul className="claim-list">
        {props.current.claims.map((claim) => {
          const verdict = props.current.verdicts.find((row) => row.claimId === claim.id);
          const face = claimFace(verdict?.verdict);
          return (
            <li key={claim.id} className="claim-item">
              <span className={`claim-face font-serif ${faceTone(verdict?.verdict)}`}>{face}</span>
              {claim.text}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
