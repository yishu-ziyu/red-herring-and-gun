import { afterEach, describe, expect, it } from "vitest";
import {
  processStepLabel,
  readUiLang,
  setUiLang,
  stopChromeLabel,
  UI_COPY,
  UI_LANG_KEY,
} from "./uiLang";

afterEach(() => {
  window.localStorage.removeItem(UI_LANG_KEY);
  window.history.replaceState(null, "", "/");
  setUiLang("zh");
});

describe("uiLang", () => {
  it("defaults to zh", () => {
    expect(readUiLang()).toBe("zh");
    expect(UI_COPY.zh.search).toBe("检索网页");
  });

  it("persists English and restores it", () => {
    setUiLang("en");
    expect(window.localStorage.getItem(UI_LANG_KEY)).toBe("en");
    expect(readUiLang()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("labels a live thought vs a finished thought", () => {
    expect(
      processStepLabel({ kind: "thought", status: "loading", ticker: true }, UI_COPY.zh)
    ).toBe("思考中…");
    expect(processStepLabel({ kind: "thought", status: "success" }, UI_COPY.zh)).toBe("深入思考");
    expect(processStepLabel({ kind: "search", status: "success" }, UI_COPY.en)).toBe("Search web");
  });

  it("maps stop chrome without leaking a raw English default in zh", () => {
    expect(stopChromeLabel(true, undefined, UI_COPY.zh)).toBe("停止");
    expect(stopChromeLabel(false, "再看一遍", UI_COPY.zh)).toBe("再看一遍");
    expect(stopChromeLabel(false, "再看一遍", UI_COPY.en)).toBe("Replay");
  });
});
