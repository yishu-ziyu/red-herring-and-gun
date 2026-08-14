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
