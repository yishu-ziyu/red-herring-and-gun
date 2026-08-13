import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeySettings } from "./ApiKeySettings";

function fillKey(value: string) {
  fireEvent.change(screen.getByLabelText(/API Key/i), {
    target: { value },
  });
}

function useCustomEndpoint(baseUrl: string, modelName?: string) {
  fireEvent.click(screen.getByRole("button", { name: "自定义" }));
  fireEvent.change(screen.getByLabelText(/Base URL/i), {
    target: { value: baseUrl },
  });
  if (modelName !== undefined) {
    fireEvent.change(screen.getByLabelText(/Model Name/i), {
      target: { value: modelName },
    });
  }
}

describe("ApiKeySettings", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("starts on a provider preset so the user only fills the key", () => {
    render(<ApiKeySettings />);

    expect(screen.getByRole("heading", { name: "模型设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "V4 Flash" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/API Key/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue("https://api.deepseek.com/v1");
    expect(screen.queryByLabelText(/Model Name/i)).not.toBeInTheDocument();
  });

  it("fills base URL and model when a provider chip is clicked", () => {
    render(<ApiKeySettings />);

    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));

    expect(screen.getByRole("button", { name: "OpenAI" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByRole("button", { name: "GPT-5.4 mini" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the prefilled address editable", () => {
    render(<ApiKeySettings />);

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "https://api.deepseek.com" },
    });

    expect(screen.getByLabelText(/Base URL/i)).toHaveValue("https://api.deepseek.com");
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the user pick a model by clicking a chip", () => {
    render(<ApiKeySettings />);

    fireEvent.click(screen.getByRole("button", { name: "V4 Pro" }));

    expect(screen.getByRole("button", { name: "V4 Pro" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "V4 Flash" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals address and model fields in custom mode", () => {
    render(<ApiKeySettings />);

    fireEvent.click(screen.getByRole("button", { name: "自定义" }));

    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Model Name/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "模型" })).not.toBeInTheDocument();
  });

  it("accurately explains local storage and test-time transmission", () => {
    render(<ApiKeySettings />);

    expect(screen.getByText(/本机浏览器存储/)).toBeInTheDocument();
    expect(screen.getAllByText(/测试连接时/).length).toBeGreaterThan(0);
    expect(screen.getByText(/当前站点的测试接口/)).toBeInTheDocument();
    expect(screen.getByText(/base64 不是加密/)).toBeInTheDocument();
    expect(screen.queryByText(/不会上传到我们的服务端/)).not.toBeInTheDocument();
  });

  it("renders 测试连接 and 保存 buttons", () => {
    render(<ApiKeySettings />);
    expect(screen.getByRole("button", { name: /测试连接/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeInTheDocument();
  });

  it("hydrates from localStorage on mount", () => {
    const stored = btoa(
      JSON.stringify({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test-1234",
        modelName: "gpt-4o-mini",
      })
    );
    window.localStorage.setItem("gun-byo-key", stored);

    render(<ApiKeySettings />);
    expect(screen.getByRole("button", { name: "自定义" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue("https://api.example.com/v1");
    expect(screen.getByLabelText(/API Key/i)).toHaveValue("sk-test-1234");
    expect(screen.getByLabelText(/Model Name/i)).toHaveValue("gpt-4o-mini");
  });

  it("recognizes a saved DeepSeek URL as the DeepSeek preset", () => {
    const stored = btoa(
      JSON.stringify({
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-saved",
        modelName: "deepseek-v4-pro",
      })
    );
    window.localStorage.setItem("gun-byo-key", stored);

    render(<ApiKeySettings />);
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "V4 Pro" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/API Key/i)).toHaveValue("sk-saved");
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue("https://api.deepseek.com");
  });

  it("saves base64-obfuscated values to localStorage on save", () => {
    render(<ApiKeySettings />);

    fireEvent.click(screen.getByRole("button", { name: "V4 Flash" }));
    fillKey("sk-abc");

    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    const stored = window.localStorage.getItem("gun-byo-key");
    expect(stored).toBeTruthy();
    const decoded = JSON.parse(atob(stored as string));
    expect(decoded).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-abc",
      modelName: "deepseek-v4-flash",
    });
  });

  it("does not reveal API key literal in save hint or test result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, latencyMs: 88, status: 200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as Response
    );

    const secret = "sk-visible-leak-check";
    render(<ApiKeySettings />);
    fillKey(secret);

    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    await screen.findByText(/连接成功/);

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toContain(secret);
  });

  it("POSTs to /api/agent/test-llm when 测试连接 is clicked and shows success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, latencyMs: 321, status: 200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as Response
    );

    render(<ApiKeySettings />);
    fireEvent.click(screen.getByRole("button", { name: "V4 Pro" }));
    fillKey("sk-xyz");

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/agent/test-llm");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-xyz",
      modelName: "deepseek-v4-pro",
    });

    expect(await screen.findByText(/连接成功|321ms/)).toBeInTheDocument();
  });

  it("surfaces upstream failure messages inline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "上游返回 401" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as Response
    );

    render(<ApiKeySettings />);
    fillKey("sk-bad");

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    expect(await screen.findByText(/上游返回 401/)).toBeInTheDocument();
  });

  it("rejects http://10.x baseUrl client-side before calling backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    render(<ApiKeySettings />);
    useCustomEndpoint("http://10.0.0.5:8000");
    fillKey("sk-x");

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/https:\/\/|localhost/)).toBeInTheDocument();
  });

  it("displays last test timestamp after a successful test", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, latencyMs: 100 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as Response
    );

    render(<ApiKeySettings />);
    fillKey("sk-y");

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    await screen.findByText(/连接成功/);
    expect(screen.getByText(/上次测试/)).toBeInTheDocument();
  });
});
