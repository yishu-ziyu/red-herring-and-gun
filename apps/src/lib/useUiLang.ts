import { useEffect, useState } from "react";
import {
  applyUiLang,
  readUiLang,
  setUiLang,
  subscribeUiLang,
  UI_COPY,
  type UiCopy,
  type UiLang,
} from "./uiLang";

export function useUiLang(): {
  lang: UiLang;
  copy: UiCopy;
  setLang: (lang: UiLang) => void;
} {
  const [lang, setLangState] = useState<UiLang>(() => readUiLang());

  useEffect(() => {
    applyUiLang(readUiLang());
    return subscribeUiLang(() => setLangState(readUiLang()));
  }, []);

  return { lang, copy: UI_COPY[lang], setLang: setUiLang };
}
