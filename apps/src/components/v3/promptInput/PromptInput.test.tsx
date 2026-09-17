import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptInput } from "./PromptInput";

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("material-only input", () => {
  it("offers only supported media, with an explicit video limitation", () => {
    render(<PromptInput />);
    fireEvent.click(screen.getByRole("button", { name: "添加材料" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: "添加图片或视频" })).toBeInTheDocument();
    expect(screen.getByText(/视频按画面抽帧核查/)).toBeInTheDocument();
    expect(screen.queryByText("技能")).not.toBeInTheDocument();
    expect(screen.queryByText("添加附件")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute("accept", "image/*,video/*");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps a slash and URLs as user text, without creating commands", () => {
    const onSubmit = vi.fn();
    render(<PromptInput onSubmit={onSubmit} />);
    const editor = screen.getByRole("textbox");
    editor.textContent = "/来源核验 https://example.org/news/a/b";
    fireEvent.input(editor);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.querySelector("[data-skill]")).toBeNull();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("/来源核验 https://example.org/news/a/b");
  });

  it("does not send while committing Chinese input or entering a new line", () => {
    const onSubmit = vi.fn();
    render(<PromptInput value="待核查原文" onSubmit={onSubmit} />);
    const editor = screen.getByRole("textbox");
    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: "Enter" });
    fireEvent.compositionEnd(editor);
    fireEvent.keyDown(editor, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("待核查原文");
  });

  it.each([{ disabled: true }, { busy: true }, { submitDisabled: true }])("blocks keyboard submission when %j", (props) => {
    const onSubmit = vi.fn();
    render(<PromptInput {...props} value="原文" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "开始核查" })).toBeDisabled();
  });

  it("forwards selected images and videos, and preserves attachment removal", async () => {
    const onAddFiles = vi.fn(); const onRemoveAttachment = vi.fn();
    render(<PromptInput onAddFiles={onAddFiles} onRemoveAttachment={onRemoveAttachment}
      attachments={[{ id: "one", name: "capture.png", kind: "image" }]} />);
    const files = [new File(["img"], "capture.png", { type: "image/png" }), new File(["vid"], "clip.mp4", { type: "video/mp4" })];
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
    expect(onAddFiles).toHaveBeenCalledExactlyOnceWith(files, "image");
    fireEvent.click(screen.getByRole("button", { name: "移除 capture.png" }));
    await waitFor(() => expect(onRemoveAttachment).toHaveBeenCalledExactlyOnceWith("one"));
  });
});
