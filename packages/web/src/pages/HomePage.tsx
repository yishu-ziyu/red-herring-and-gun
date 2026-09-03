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
  APP_TITLE,
  EMPTY_CASES,
  IMAGE_TOO_LARGE,
  LINK_HINT,
  NETWORK_ERROR,
  QUOTA_EXCEEDED,
  RECENT_CASES,
  REMOVE_IMAGE,
  SUBMIT_HOME,
} from "../lib/copy.js";
import { formatRelativeTime, previewText } from "../lib/time.js";

const URL_PATTERN = /https?:\/\//i;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const RECENT_LIMIT = 5;

type Props = {
  onCreated: (caseId: string) => void;
  onOpenCase: (caseId: string) => void;
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

export function HomePage(props: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recent, setRecent] = useState<CaseListItem[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listCases()
      .then((items) => setRecent(items.slice(0, RECENT_LIMIT)))
      .catch(() => setRecent([]));
  }, []);

  const showLinkHint = URL_PATTERN.test(text);

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

  return (
    <div className="home">
      <h1 className="font-serif">{APP_TITLE}</h1>
      <p className="home-tagline font-serif">贴一句要核的话。先给判断，再拆问题。</p>
      <form onSubmit={onSubmit}>
        <label>
          <span className="muted">要核的句子</span>
          <div
            ref={dropRef}
            className="home-input-wrap"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={onPaste}
              maxLength={4000}
              required
            />
            {previewUrl ? (
              <div className="home-preview">
                <img src={previewUrl} alt="" className="home-preview-img" />
                <button
                  type="button"
                  className="home-preview-remove"
                  aria-label={REMOVE_IMAGE}
                  onClick={clearImage}
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
        </label>
        {showLinkHint ? <p className="home-hint muted">{LINK_HINT}</p> : null}
        <div className="home-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {SUBMIT_HOME}
          </button>
        </div>
        {error ? <p className="err">{error}</p> : null}
      </form>
      <section className="home-recent" aria-label={RECENT_CASES}>
        <h2 className="home-recent-title">{RECENT_CASES}</h2>
        {recent.length === 0 ? (
          <p className="muted">{EMPTY_CASES}</p>
        ) : (
          <ul className="home-recent-list">
            {recent.map((item) => (
              <li key={item.caseId}>
                <button
                  type="button"
                  className="home-recent-item"
                  onClick={() => props.onOpenCase(item.caseId)}
                >
                  <span className="home-recent-text">{previewText(item.text)}</span>
                  <span className="home-recent-time">{formatRelativeTime(item.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
