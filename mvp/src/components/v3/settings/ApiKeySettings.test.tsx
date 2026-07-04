import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeySettings } from "./ApiKeySettings";

describe("ApiKeySettings", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("renders three fields: baseUrl, apiKey, modelName", () => {
    render(<ApiKeySettings />);
    expect(screen.getByLabelText(/Base URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Model Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/API Key/i)).toHaveAttribute("type", "password");
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
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue("https://api.example.com/v1");
    expect(screen.getByLabelText(/API Key/i)).toHaveValue("sk-test-1234");
    expect(screen.getByLabelText(/Model Name/i)).toHaveValue("gpt-4o-mini");
  });

  it("saves base64-obfuscated values to localStorage on save", () => {
    render(<ApiKeySettings />);

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "https://api.deepseek.com" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/i), {
      target: { value: "sk-abc" },
    });
    fireEvent.change(screen.getByLabelText(/Model Name/i), {
      target: { value: "deepseek-v4-flash" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    const stored = window.localStorage.getItem("gun-byo-key");
    expect(stored).toBeTruthy();
    const decoded = JSON.parse(atob(stored as string));
    expect(decoded).toEqual({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-abc",
      modelName: "deepseek-v4-flash",
    });
  });

  it("POSTs to /api/agent/test-llm when 测试连接 is clicked and shows success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, latencyMs: 321, status: 200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as Response
    );

    render(<ApiKeySettings />);

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "https://api.deepseek.com/v1" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/i), {
      target: { value: "sk-xyz" },
    });
    fireEvent.change(screen.getByLabelText(/Model Name/i), {
      target: { value: "deepseek-v4-pro" },
    });

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

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "https://api.example.com" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/i), {
      target: { value: "sk-bad" },
    });

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    expect(await screen.findByText(/上游返回 401/)).toBeInTheDocument();
  });

  it("rejects http://10.x baseUrl client-side before calling backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    render(<ApiKeySettings />);

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "http://10.0.0.5:8000" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/i), {
      target: { value: "sk-x" },
    });

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

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "https://api.deepseek.com" },
    });
    fireEvent.change(screen.getByLabelText(/API Key/i), {
      target: { value: "sk-y" },
    });

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    await screen.findByText(/连接成功/);
    expect(screen.getByText(/上次测试/)).toBeInTheDocument();
  });
});