import { useUiLang } from "../../lib/useUiLang";
import type { UiLang } from "../../lib/uiLang";

const OPTIONS: Array<{ id: UiLang; label: string }> = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
];

export function UiLangSwitch() {
  const { lang, copy, setLang } = useUiLang();

  return (
    <div className="ui-lang-switch" role="group" aria-label={copy.langGroup}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          aria-pressed={lang === opt.id}
          onClick={() => setLang(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
