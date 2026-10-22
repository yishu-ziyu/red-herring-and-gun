import { useEffect, useState } from "react";
import { applyUiLang, readUiLang, type UiLang } from "./uiLang";

export function useUiLang(): { lang: UiLang } {
  const [lang] = useState<UiLang>(() => readUiLang());

  useEffect(() => {
    applyUiLang(readUiLang());
  }, []);

  return { lang };
}
