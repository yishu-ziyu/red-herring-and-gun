/**
 * 界面语言。默认中文；localStorage 里存过就用存的，否则看网址里的 ?lang=。
 * 结论正文跟着说法本身的语言，不跟界面语言。
 */

export type UiLang = "zh" | "en";

const UI_LANG_KEY = "rhg.uiLang";

const DOC_TITLE: Record<UiLang, string> = {
  zh: "红鲱鱼与枪｜查出处，判断原句哪里站得住",
  en: "Red Herring & Gun | Trace the source, judge what holds up",
};

function asLang(value: string | null | undefined): UiLang | null {
  if (value === "zh" || value === "en") return value;
  return null;
}

export function readUiLang(): UiLang {
  if (typeof window === "undefined") return "zh";
  const stored = asLang(window.localStorage.getItem(UI_LANG_KEY));
  if (stored) return stored;
  return asLang(new URLSearchParams(window.location.search).get("lang")) ?? "zh";
}

export function applyUiLang(lang: UiLang): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.title = DOC_TITLE[lang];
  }
}
