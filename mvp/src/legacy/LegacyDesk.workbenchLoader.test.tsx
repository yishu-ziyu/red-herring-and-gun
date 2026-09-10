/**
 * 冷加载：不经过 LegacyDesk.test.tsx 的 beforeAll 预热，
 * 也不在本文件顶层 import 工作台模块或 LegacyDesk（避免 React.lazy 跨用例缓存）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionControlImporter } from "./loadMissionControlView";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return {
    ...actual,
    requestOrchestrateStream: vi.fn(async function* () {
      yield { type: "error", message: "test stream stopped" };
    }),
  };
});

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children?: unknown }) => <div data-testid="desk-shell">{children as never}</div>,
  Panel: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  Separator: () => null,
  usePanelRef: () => ({ current: { collapse() {}, expand() {}, isCollapsed: () => false } }),
}));

function mockModelsList() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
    if (url.includes("/api/models/health")) {
      return new Response(JSON.stringify({ status: "available", message: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/models/list")) {
      return new Response(
        JSON.stringify({
          models: [
            { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "high", hint: "强推理" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/checks/quota")) {
      return new Response(JSON.stringify({ remaining: 1, total: 1, used: 0, kind: "guest" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not-found", { status: 404 });
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function withCapturedUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason: unknown) => {
    reasons.push(reason);
  });
  return run()
    .then(async () => {
      await flushMicrotasks();
      return reasons;
    })
    .finally(() => {
      process.removeAllListeners("unhandledRejection");
      for (const entry of previous) {
        process.on("unhandledRejection", entry as NodeJS.UnhandledRejectionListener);
      }
    });
}

async function enableLaunch() {
  const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
  editor.textContent = "隔夜菜会致癌，吃了等于吃毒药";
  fireEvent.input(editor);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /开始核查/ })).toBeEnabled();
  });
}

async function renderDesk(importer: MissionControlImporter) {
  const loader = await import("./loadMissionControlView");
  loader.resetMissionControlViewLoaderForTests(importer);
  const desk = await import("./LegacyDesk");
  return render(<desk.default />);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  mockModelsList();
});

describe("LegacyDesk cold workbench loader", () => {
  it("prefetches on mount, shows fallback until the chunk resolves, then keeps apodex-run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loadCalls = 0;

    const unhandled = await withCapturedUnhandled(async () => {
      await renderDesk(() => {
        loadCalls += 1;
        return gate.then(() => import("../components/v3/phases/MissionControlView"));
      });

      await waitFor(() => {
        expect(loadCalls).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId("apodex-run")).not.toBeInTheDocument();
      expect(screen.queryByText("正在打开核查工作台…")).not.toBeInTheDocument();

      await enableLaunch();
      fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

      expect(await screen.findByText("正在打开核查工作台…")).toBeInTheDocument();
      expect(screen.queryByTestId("apodex-run")).not.toBeInTheDocument();

      await act(async () => {
        release();
        await gate;
      });

      expect(await screen.findByTestId("apodex-run")).toBeInTheDocument();
      expect(screen.queryByText("正在打开核查工作台…")).not.toBeInTheDocument();
    });

    expect(unhandled).toEqual([]);
  });

  it("recovers after the first prefetch failure without unhandled rejection", async () => {
    let attempts = 0;

    const unhandled = await withCapturedUnhandled(async () => {
      await renderDesk(() => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("chunk-load-failed"));
        return import("../components/v3/phases/MissionControlView");
      });

      await waitFor(() => {
        expect(attempts).toBeGreaterThan(0);
      });
      await flushMicrotasks();
      expect(screen.queryByTestId("apodex-run")).not.toBeInTheDocument();

      await enableLaunch();
      fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

      expect(await screen.findByTestId("apodex-run")).toBeInTheDocument();
      expect(attempts).toBeGreaterThan(1);
    });

    expect(unhandled).toEqual([]);
  });
});
