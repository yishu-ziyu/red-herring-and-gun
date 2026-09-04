import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CASES,
  IMAGE_TOO_LARGE,
  LINK_HINT,
  QUOTA_EXCEEDED,
  SEARCH_SETTINGS,
} from "../lib/copy.js";
import { HomePage } from "./HomePage.js";

const createCase = vi.fn();
const listCases = vi.fn();

vi.mock("../lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api.js")>();
  return {
    ...actual,
    createCase: (...args: Parameters<typeof actual.createCase>) => createCase(...args),
    listCases: (...args: Parameters<typeof actual.listCases>) => listCases(...args),
  };
});

const { ApiError } = await import("../lib/api.js");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  listCases.mockResolvedValue([]);
});

function renderHome(
  over: Partial<{ onCreated: (id: string) => void; onOpenCase: (id: string) => void; onSettings: () => void }> = {}
) {
  const onCreated = over.onCreated ?? vi.fn();
  const onOpenCase = over.onOpenCase ?? vi.fn();
  const onSettings = over.onSettings ?? vi.fn();
  render(<HomePage onCreated={onCreated} onOpenCase={onOpenCase} onSettings={onSettings} />);
  return { onCreated, onOpenCase, onSettings };
}

function pasteImage(textarea: HTMLElement, file: File) {
  const item = {
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  };
  const clipboardData = {
    items: [item],
    getData: () => "",
  };
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  textarea.dispatchEvent(event);
}

function mockFileReader(result: string) {
  class MockReader {
    onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
    readAsDataURL() {
      queueMicrotask(() => this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>));
    }
    get result() {
      return result;
    }
  }
  vi.stubGlobal("FileReader", MockReader);
}

describe("HomePage", () => {
  it("首页能进检索设置", () => {
    const { onSettings } = renderHome();
    fireEvent.click(screen.getByRole("button", { name: SEARCH_SETTINGS }));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("粘贴含链接文本时出现提示行", async () => {
    renderHome();
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "看看 https://www.gov.cn/zhengce/ 说的对不对" } });
    expect(await screen.findByText(LINK_HINT)).toBeTruthy();
  });

  it("粘贴图片后出现预览且 createCase 收到 image 附件", async () => {
    mockFileReader("data:image/png;base64,abc");
    createCase.mockResolvedValue({ caseId: "c1", turnId: "t1" });
    renderHome();
    const textarea = screen.getByRole("textbox");
    const file = new File(["x"], "note.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 1024 });
    pasteImage(textarea, file);
    await waitFor(() => {
      expect(document.querySelector(".home-preview-img")).toBeTruthy();
    });
    fireEvent.change(textarea, { target: { value: "这图说的是真的吗" } });
    fireEvent.click(screen.getByRole("button", { name: "开始核对" }));
    await waitFor(() => {
      expect(createCase).toHaveBeenCalledWith("这图说的是真的吗", [
        { kind: "image", value: "data:image/png;base64,abc" },
      ]);
    });
  });

  it("超过 2MB 的图片显示错误且不附带", async () => {
    renderHome();
    const textarea = screen.getByRole("textbox");
    const file = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 2 * 1024 * 1024 + 1 });
    pasteImage(textarea, file);
    expect(await screen.findByText(IMAGE_TOO_LARGE)).toBeTruthy();
    expect(document.querySelector(".home-preview-img")).toBeNull();
    expect(createCase).not.toHaveBeenCalled();
  });

  it("429 时显示配额文案", async () => {
    createCase.mockRejectedValue(new ApiError("quota", 429));
    renderHome();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "一句要核的话" } });
    fireEvent.click(screen.getByRole("button", { name: "开始核对" }));
    expect(await screen.findByText(QUOTA_EXCEEDED)).toBeTruthy();
  });

  it("空列表显示空态文案", async () => {
    renderHome();
    expect(await screen.findByText(EMPTY_CASES)).toBeTruthy();
  });

  it("点击最近案件进入案件页", async () => {
    listCases.mockResolvedValue([
      {
        caseId: "case-abc",
        text: "国家医保局宣布生育津贴直接发个人",
        createdAt: "2026-09-03T10:00:00.000Z",
        updatedAt: "2026-09-03T10:03:00.000Z",
      },
    ]);
    const onOpenCase = vi.fn();
    renderHome({ onOpenCase });
    const item = await screen.findByRole("button", { name: /国家医保局宣布生育津贴直接发个人/ });
    fireEvent.click(item);
    expect(onOpenCase).toHaveBeenCalledWith("case-abc");
  });
});
