import { useRef, useState } from "react";
import { ABORT, COMPOSER_LABEL, SUBMIT_TURN } from "../lib/copy.js";

export function Composer(props: {
  running: boolean;
  onSend: (text: string) => Promise<void>;
  onAbort: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function submit() {
    const next = text.trim();
    if (!next || props.running) return;
    await props.onSend(next);
    setText("");
    queueMicrotask(resize);
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        <span className="muted">{COMPOSER_LABEL}</span>
        <textarea
          ref={ref}
          value={text}
          rows={2}
          onChange={(event) => {
            setText(event.target.value);
            queueMicrotask(resize);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </label>
      <div className="composer-actions">
        {props.running ? (
          <button type="button" className="btn" onClick={() => void props.onAbort()}>
            {ABORT}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            {SUBMIT_TURN}
          </button>
        )}
      </div>
    </form>
  );
}
