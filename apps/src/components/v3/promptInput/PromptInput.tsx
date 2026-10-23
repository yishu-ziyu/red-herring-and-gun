import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import styles from "./PromptInput.module.css";
import { useUiLang } from "../../../lib/useUiLang";
import { gpCopyFor } from "../../../goldenPath/copy";

function Icon({
  name,
  size = 14,
  className,
}: {
  name: "image" | "loader" | "x";
  size?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "image":
      return (
        <svg {...common}>
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      );
    case "loader":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
  }
}

export type PromptAttachment = {
  id: string;
  name: string;
};

type PromptInputProps = {
  /** 文字由父组件持有。 */
  value: string;
  onChange: (value: string) => void;
  /** 回车（不按 Shift）或点发送。 */
  onSubmit: () => void;
  /** 编辑框上方的附件条。 */
  attachments: PromptAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  placeholder: string;
  ariaLabel: string;
  submitLabel: string;
  busy: boolean;
};

export function PromptInput({
  value,
  onChange,
  onSubmit,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  placeholder,
  ariaLabel,
  submitLabel,
  busy,
}: PromptInputProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastExternalValue = useRef(value);
  const composing = useRef(false);

  const hasText = value.trim().length > 0;
  const sendActive = (hasText || attachments.length > 0) && !busy;

  // Focus the editor and drop the caret at the very end of its content.
  const focusEnd = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const syncFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(editor.innerText ?? editor.textContent ?? "");
  };

  // Sync external text into the contenteditable when the parent changes it
  // (e.g. demo claim fill) without fighting local typing.
  useEffect(() => {
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    const editor = editorRef.current;
    if (!editor) return;
    if ((editor.textContent ?? "") === value) return;
    editor.textContent = value;
    syncFromEditor();
    requestAnimationFrame(focusEnd);
  }, [value]);

  const onEditorKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Seed editor from the initial value once on mount.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value && !editor.textContent) {
      editor.textContent = value;
      syncFromEditor();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    if (busy || composing.current) return;
    onSubmit();
  };

  const openPicker = () => {
    const input = fileRef.current;
    if (!input || busy) return;
    input.value = "";
    input.click();
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          onAddFiles(files);
          e.target.value = "";
          requestAnimationFrame(() => editorRef.current?.focus());
        }}
      />

      <div className={styles.frame} data-prompt-frame>
        {attachments.length > 0 && (
          <div className={styles.chips}>
            {attachments.map((att) => (
              <span key={att.id} className={styles.chip}>
                <span className={styles.chipIcon}>
                  <Icon name="image" size={14} />
                </span>
                <span className={styles.chipName}>{att.name}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={"移除 " + att.name}
                  onClick={() => onRemoveAttachment(att.id)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          ref={editorRef}
          id="claim-input"
          className={styles.field}
          contentEditable={!busy}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-empty={!hasText || undefined}
          data-placeholder={placeholder}
          onInput={syncFromEditor}
          onKeyDown={onEditorKeyDown}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; syncFromEditor(); }}
        />

        <div className={styles.row}>
          <button
            type="button"
            className={styles.add}
            data-prompt-add
            disabled={busy}
            onClick={openPicker}
          >
            <Icon name="image" size={16} />
            {copy.addImage}
          </button>
          <button
            type="button"
            className={styles.send}
            data-prompt-send
            aria-label={submitLabel}
            disabled={!sendActive}
            onClick={send}
          >
            {busy ? <Icon name="loader" size={16} className={styles.spinner} /> : submitLabel}
          </button>
        </div>
      </div>
    </>
  );
}
