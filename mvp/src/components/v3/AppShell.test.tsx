import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children?: unknown }) => <div data-testid="desk-shell">{children as never}</div>,
  Panel: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  Separator: () => null,
  usePanelRef: () => ({ current: { collapse() {}, expand() {}, isCollapsed: () => false } }),
}));

const account = {
  email: "yishuziyu@gmail.com",
  displayName: "奕枢",
  name: "奕枢",
  createdAt: Date.now(),
  loginCount: 2,
  lastLoginAt: Date.now(),
};

describe("AppShell account chip", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the nickname like ChatGPT/Kimi, not the raw email as the title", () => {
    render(
      <AppShell
        cases={[]}
        activeCaseId={null}
        onNewCase={() => undefined}
        onSelectCase={() => undefined}
        artifactTitle=""
        artifactOpen={false}
        onArtifactOpenChange={() => undefined}
        account={account}
        onAccountClick={() => undefined}
        onLogout={() => undefined}
      >
        <div />
      </AppShell>
    );
    expect(screen.getByRole("button", { name: /奕枢/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /奕枢/ }));
    expect(screen.getByRole("menuitem", { name: "账户" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "退出" })).toBeInTheDocument();
  });
});

const baseProps = {
  cases: [],
  activeCaseId: null,
  onNewCase: () => undefined,
  onSelectCase: () => undefined,
  artifactTitle: "",
  artifactOpen: false,
  onArtifactOpenChange: () => undefined,
};

describe("AppShell entry gating", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides 新查一条 on the blank entry but keeps 登录", () => {
    render(
      <AppShell {...baseProps} onLoginClick={() => undefined}>
        <div />
      </AppShell>
    );

    expect(screen.queryByRole("button", { name: "新查一条" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("shows 新查一条 while viewing a result", () => {
    render(
      <AppShell {...baseProps} showNewCase>
        <div />
      </AppShell>
    );

    expect(screen.getByRole("button", { name: "新查一条" })).toBeInTheDocument();
  });

  it("does not leak 模型设置 to the logged-out rail", () => {
    render(
      <AppShell {...baseProps} onLoginClick={() => undefined}>
        <div />
      </AppShell>
    );

    expect(screen.queryByRole("link", { name: "模型设置" })).not.toBeInTheDocument();
  });

  it("keeps /settings/api-key reachable from the signed-in account menu", () => {
    render(
      <AppShell
        {...baseProps}
        account={account}
        onAccountClick={() => undefined}
        onLogout={() => undefined}
      >
        <div />
      </AppShell>
    );

    fireEvent.click(screen.getByRole("button", { name: /奕枢/ }));
    expect(screen.getByRole("menuitem", { name: "模型设置" })).toHaveAttribute(
      "href",
      "/settings/api-key"
    );
  });

  it("keeps brand and 登录 (and no 新查一条) in the narrow entry bar", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("max-width: 860px"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      render(
        <AppShell {...baseProps} onLoginClick={() => undefined}>
          <div />
        </AppShell>
      );

      expect(await screen.findByText("红鲱鱼与枪")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "新查一条" })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
