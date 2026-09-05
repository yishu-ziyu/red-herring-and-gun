import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { ApiError, createCase, listCases, type Attachment, type CaseListItem } from "../lib/api.js";
import {
  ADD_IMAGE,
  APP_TITLE,
  EMPTY_CASES,
  HOME_DEMOS,
  HOME_EXAMPLES,
  HOME_MISSION,
  HOME_OUTCOME,
  HOME_PLACEHOLDER,
  IMAGE_TOO_LARGE,
  LINK_HINT,
  NETWORK_ERROR,
  NEW_CASE,
  QUOTA_EXCEEDED,
  RECENT_CASES,
  REMOVE_IMAGE,
  SEARCH_SETTINGS,
  SUBMIT_HOME,
} from "../lib/copy.js";
import { saveOpening } from "../lib/opening.js";
import { formatRelativeTime, previewText } from "../lib/time.js";

const URL_PATTERN = /https?:\/\//i;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const RECENT_LIMIT = 5;

type Props = {
  onCreated: (caseId: string) => void;
  onOpenCase: (caseId: string) => void;
  onSettings: () => void;
};

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("read failed"));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function pickImageFile(files: FileList | DataTransferItemList | null | undefined): File | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i += 1) {
    const entry = files[i];
    const file = entry instanceof File ? entry : entry.kind === "file" ? entry.getAsFile() : null;
    if (file?.type.startsWith("image/")) return file;
  }
  return null;
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HomePage(props: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recent, setRecent] = useState<CaseListItem[]>([]);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listCases()
      .then((items) => setRecent(items.slice(0, RECENT_LIMIT)))
      .catch(() => setRecent([]));
  }, []);

  const showLinkHint = URL_PATTERN.test(text);
  const canSend = text.trim().length > 0 && !pending;

  const attachImage = useCallback(async (file: File) => {
    if (file.size > MAX_IMAGE_BYTES) {
      setError(IMAGE_TOO_LARGE);
      return;
    }
    setError(null);
    try {
      const dataUrl = await readImageFile(file);
      setImage({ kind: "image", value: dataUrl });
      setPreviewUrl(dataUrl);
    } catch {
      setError(NETWORK_ERROR);
    }
  }, []);

  function clearImage() {
    setImage(null);
    setPreviewUrl(null);
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = pickImageFile(event.clipboardData?.items ?? null);
    if (!file) return;
    event.preventDefault();
    void attachImage(file);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = pickImageFile(event.dataTransfer.files);
    if (file) void attachImage(file);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = text.trim();
    if (!next || pending) return;
    setPending(true);
    setError(null);
    try {
      const attachments = image ? [image] : undefined;
      const created = await createCase(next, attachments);
      saveOpening(created.caseId, next);
      props.onCreated(created.caseId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(QUOTA_EXCEEDED);
      } else if (err instanceof TypeError) {
        setError(NETWORK_ERROR);
      } else {
        setError(err instanceof Error ? err.message : "立案失败");
      }
      setPending(false);
    }
  }

  const recentList =
    recent.length === 0 ? (
      <p className="muted home-rail-empty">{EMPTY_CASES}</p>
    ) : (
      <ul className="home-rail-list">
        {recent.map((item) => (
          <li key={item.caseId}>
            <button type="button" className="home-rail-item" onClick={() => props.onOpenCase(item.caseId)}>
              <span>{previewText(item.text)}</span>
              <span className="muted">{formatRelativeTime(item.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="home-desk">
      <nav className="home-rail" aria-label={RECENT_CASES}>
        <div className="home-rail-brand">
          <img src="/logo.png" alt="" width="28" height="28" />
          <span className="font-serif">{APP_TITLE}</span>
        </div>
        <button type="button" className="home-new" onClick={() => fieldRef.current?.focus()}>
          {NEW_CASE}
        </button>
        <p className="home-rail-label">{RECENT_CASES}</p>
        {recentList}
        <div className="home-rail-foot">
          <button type="button" className="home-rail-link" onClick={props.onSettings}>
            {SEARCH_SETTINGS}
          </button>
        </div>
      </nav>

      <main className="home-stage">
        <header className="home-hero">
          <h1 className="home-title font-serif">
            <span>红鲱鱼</span>
            <span className="home-title-accent">与</span>
            <span>枪</span>
          </h1>
          <p className="home-mission font-serif">{HOME_MISSION}</p>
          <p className="home-outcome">{HOME_OUTCOME}</p>
        </header>

        <form className="home-card" onSubmit={onSubmit}>
          <label className="visually-hidden" htmlFor="home-claim">
            {HOME_PLACEHOLDER}
          </label>
          <div ref={dropRef} className="home-card-field" onDragOver={onDragOver} onDrop={onDrop}>
            <textarea
              id="home-claim"
              ref={fieldRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={onPaste}
              maxLength={4000}
              placeholder={HOME_PLACEHOLDER}
              required
            />
            {previewUrl ? (
              <div className="home-preview">
                <img src={previewUrl} alt="" className="home-preview-img" />
                <button type="button" className="home-preview-remove" aria-label={REMOVE_IMAGE} onClick={clearImage}>
                  ×
                </button>
              </div>
            ) : null}
          </div>
          <div className="home-card-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void attachImage(file);
              }}
            />
            <button type="button" className="home-icon-btn" aria-label={ADD_IMAGE} onClick={() => fileRef.current?.click()}>
              <IconPlus />
            </button>
            <button type="submit" className="home-send" aria-label={SUBMIT_HOME} disabled={!canSend}>
              <IconSend />
            </button>
          </div>
        </form>
        {showLinkHint ? <p className="home-hint muted">{LINK_HINT}</p> : null}
        {error ? <p className="err">{error}</p> : null}

        <section className="home-examples" aria-label={HOME_EXAMPLES}>
          <p className="home-examples-label">{HOME_EXAMPLES}</p>
          <ul>
            {HOME_DEMOS.map((claim) => (
              <li key={claim}>
                <button type="button" className="home-example" onClick={() => setText(claim)}>
                  {claim}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-recent-mobile" aria-label={RECENT_CASES}>
          <p className="home-rail-label">{RECENT_CASES}</p>
          {recentList}
        </section>
      </main>
    </div>
  );
}
