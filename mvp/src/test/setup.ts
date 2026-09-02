import { vi } from "vitest";

if (typeof window === "undefined") {
  // node-environment tests (deploy pipeline) skip jsdom polyfills
} else {
  await import("@testing-library/jest-dom/vitest");

  Object.defineProperty(window, "scrollTo", {
    value: vi.fn(),
    writable: true,
  });

  // jsdom 无 ResizeObserver：@xyflow/react（核查地图）挂载即需要，给一个 no-op 实现。
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }

  // jsdom 不提供可调用的 matchMedia：mission 组件（雷达/拆解图/动效）默认按「桌面 + 不减弱动效」渲染。
  // 单个测试文件仍可覆写（ClaimDecompositionFlow.test 的窄屏用例即如此）。
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }

  // jsdom 在 vitest 环境下 window.localStorage 可能未挂载（取决于 jsdom 版本与环境配置）。
  // 提供一个 in-memory Storage polyfill，避免 App.test.tsx 的 beforeEach localStorage.clear() 报 undefined。
  if (!window.localStorage) {
    const store = new Map<string, string>();
    const localStorageMock: Storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() { return store.size; },
    };
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  }
}
