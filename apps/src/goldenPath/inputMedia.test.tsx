import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputStage } from "./InputStage";
import { Dashboard } from "../components/v3/Dashboard";
import { extractFramesFromVideo } from "../lib/videoFrames";

vi.mock("../lib/videoFrames", () => ({ extractFramesFromVideo: vi.fn(async () => [
  { id: "frame-1", name: "clip-frame.jpg", type: "image/jpeg", size: 20, dataUrl: "data:image/jpeg;base64,AA==" },
]) }));

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input); let body: unknown = {};
    if (url.includes("/models/health")) body = { status: "available" };
    else if (url.includes("/models/list")) body = { models: [{ provider: "deepseek", model: "test-model" }] };
    else if (url.includes("/checks/quota")) body = { remaining: 2, total: 2, used: 0, kind: "guest" };
    else if (url.includes("/auth")) body = { enabled: false, authenticated: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe.each(["default", "legacy"])("%s input media", (surface) => {
  function mount() {
    const submit = vi.fn();
    render(surface === "default" ? <InputStage onSubmit={submit} /> : <Dashboard onStartAnalysis={submit} />);
    return submit;
  }

  it.each([
    [new File(["pdf"], "report.pdf", { type: "application/pdf" })],
    [new File(["png"], "capture.png", { type: "image/png" }), new File(["doc"], "report.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })],
  ])("rejects unsupported media without silently discarding part of the selection", async (...files) => {
    const submit = mount();
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
    await screen.findByText("只支持图片和视频文件。");
    expect(document.querySelectorAll('[aria-label^="移除 "]')).toHaveLength(0);
    expect(submit).not.toHaveBeenCalled();
    expect(extractFramesFromVideo).not.toHaveBeenCalled();
  });

  it("retains both an image and extracted video frames in the submitted intake", async () => {
    const submit = mount();
    const image = new File(["png"], "capture.png", { type: "image/png" });
    const video = new File(["video"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [image, video] } });
    await screen.findByRole("button", { name: "移除 capture.png" });
    await screen.findByRole("button", { name: "移除 clip-frame.jpg" });
    const send = document.querySelector<HTMLButtonElement>("[data-prompt-send]")!;
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const intake = submit.mock.calls[0][0];
    expect(intake.images.map((x: { name: string }) => x.name)).toEqual(["capture.png", "clip-frame.jpg"]);
    expect(extractFramesFromVideo).toHaveBeenCalledExactlyOnceWith(video);
  });
});
