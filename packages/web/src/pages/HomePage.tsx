import { useState, type FormEvent } from "react";
import { createCase } from "../lib/api.js";
import { APP_TITLE, SUBMIT_HOME } from "../lib/copy.js";

export function HomePage(props: { onCreated: (caseId: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = text.trim();
    if (!next || pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await createCase(next);
      props.onCreated(created.caseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "立案失败");
      setPending(false);
    }
  }

  return (
    <div className="home">
      <h1 className="font-serif">{APP_TITLE}</h1>
      <p className="muted">贴一句要核的话。先给判断，再拆问题。</p>
      <form onSubmit={onSubmit}>
        <label>
          <span className="muted">要核的句子</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4000}
            required
          />
        </label>
        <div className="home-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {SUBMIT_HOME}
          </button>
        </div>
        {error ? <p className="err">{error}</p> : null}
      </form>
    </div>
  );
}
