import { useEffect, useState, type FormEvent } from "react";
import { listSearchProviders, type SearchProviderRow } from "../lib/api.js";
import {
  NETWORK_ERROR,
  SEARCH_BACK,
  SEARCH_BYO,
  SEARCH_BYO_HINT,
  SEARCH_INCLUDED,
  SEARCH_INCLUDED_HINT,
  SEARCH_KEY_SAVED,
  SEARCH_OPEN,
  SEARCH_PLACEHOLDER,
  SEARCH_RECHARGE,
  SEARCH_SAVE,
  SEARCH_SAVED,
  SEARCH_SETTINGS_TITLE,
} from "../lib/copy.js";
import { loadSearchKeys, saveSearchKeys } from "../lib/searchKeys.js";

type Props = { onBack: () => void };

export function SearchSettings(props: Props) {
  const [rows, setRows] = useState<SearchProviderRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadSearchKeys();
    setDraft(stored);
    void listSearchProviders()
      .then(setRows)
      .catch(() => setError(NETWORK_ERROR));
  }, []);

  const included = rows.filter((row) => row.billing === "included" && row.configured);
  const byo = rows.filter((row) => row.billing === "byo");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    saveSearchKeys(draft);
    setSaved(true);
  }

  return (
    <div className="settings">
      <button type="button" className="settings-back" onClick={props.onBack}>
        {SEARCH_BACK}
      </button>
      <h1 className="font-serif">{SEARCH_SETTINGS_TITLE}</h1>

      <section className="settings-group">
        <h2>{SEARCH_INCLUDED}</h2>
        <p className="muted settings-lead">{SEARCH_INCLUDED_HINT}</p>
        {included.length === 0 ? (
          <p className="muted">还没有预置源</p>
        ) : (
          <ul className="settings-included">
            {included.map((row) => (
              <li key={row.id}>
                <strong>{row.label}</strong>
                <span className="muted">{row.hint}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="settings-group" onSubmit={onSubmit}>
        <h2>{SEARCH_BYO}</h2>
        <p className="muted settings-lead">{SEARCH_BYO_HINT}</p>
        {byo.map((row) => (
          <label key={row.id} className="settings-field">
            <span className="settings-label">{row.label}</span>
            <span className="muted settings-field-hint">{row.hint}</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={draft[row.id] ? SEARCH_KEY_SAVED : SEARCH_PLACEHOLDER}
              value={draft[row.id] ?? ""}
              onChange={(event) => {
                setSaved(false);
                setDraft((prev) => ({ ...prev, [row.id]: event.target.value }));
              }}
            />
            <span className="settings-links">
              {row.signupUrl ? (
                <a href={row.signupUrl} target="_blank" rel="noreferrer">
                  {SEARCH_OPEN}
                </a>
              ) : null}
              {row.rechargeUrl ? (
                <a href={row.rechargeUrl} target="_blank" rel="noreferrer">
                  {SEARCH_RECHARGE}
                </a>
              ) : null}
            </span>
          </label>
        ))}
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary">
            {SEARCH_SAVE}
          </button>
        </div>
        {saved ? <p className="muted">{SEARCH_SAVED}</p> : null}
        {error ? <p className="err">{error}</p> : null}
      </form>
    </div>
  );
}
