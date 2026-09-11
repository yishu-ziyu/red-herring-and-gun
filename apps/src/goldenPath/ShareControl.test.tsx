/**
 * 显式分享的界面验收（docs/evals/2026-09-11-share-tokens.md）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareControl } from "./ShareControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : "";
    for (const [needle, handler] of Object.entries(handlers)) {
      if (url.includes(needle)) return handler(init);
    }
    return new Response("{}", { status: 404 });
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("创建之前先看公开字段", () => {
  it("点创建先出预览，不直接生成链接", async () => {
    mockFetch({
      "share-preview": () => json({ preview: { claim: "隔夜菜会致癌", report: { conclusion: "x" }, createdAt: 1, checkedAt: "2026-09-11" } }),
      shares: () => json({ shareId: "tok", url: "/s/tok" }, 201),
    });
    render(<ShareControl caseId="case-1" />);
    fireEvent.click(screen.getByText("创建分享链接"));
    await waitFor(() => expect(screen.getByText("原说法")).toBeTruthy());
    expect(screen.getByText("结论与拆出的问题")).toBeTruthy();
    expect(screen.getByText(/不会公开：账号邮箱/)).toBeTruthy();
    // 预览阶段还没有链接
    expect(document.querySelector("[data-gp-share-url]")).toBeNull();
    expect(document.querySelector("[data-gp-share-state]")!.getAttribute("data-gp-share-state")).toBe("preview");
  });

  it("预览失败就不建链接", async () => {
    mockFetch({ "share-preview": () => json({ error: "nope" }, 404) });
    render(<ShareControl caseId="case-1" />);
    fireEvent.click(screen.getByText("创建分享链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-state]")!.getAttribute("data-gp-share-state")).toBe("error"));
    expect(document.querySelector("[data-gp-share-url]")).toBeNull();
  });
});

describe("创建与撤销", () => {
  it("确认后拿到链接；服务器没写成功就报错，不假装有链接", async () => {
    mockFetch({
      "share-preview": () => json({ preview: { claim: "x", createdAt: 1 } }),
      shares: () => json({ error: "boom" }, 500),
    });
    render(<ShareControl caseId="case-1" />);
    fireEvent.click(screen.getByText("创建分享链接"));
    await waitFor(() => expect(screen.getByText("生成链接")).toBeTruthy());
    fireEvent.click(screen.getByText("生成链接"));
    await waitFor(() => expect(screen.getByText(/链接没有创建成功/)).toBeTruthy());
    expect(document.querySelector("[data-gp-share-url]")).toBeNull();
  });

  it("拿到链接后可以撤销，撤销后明说读不到了", async () => {
    mockFetch({
      "share-preview": () => json({ preview: { claim: "x", createdAt: 1 } }),
      shares: () => json({ revoked: true }, 200),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : "";
      if (url.includes("share-preview")) return json({ preview: { claim: "x", createdAt: 1 } });
      if (url.includes("/shares/") && init?.method === "DELETE") return json({ revoked: true });
      if (url.includes("/shares")) return json({ shareId: "tok-abc", url: "/s/tok-abc" }, 201);
      return json({}, 404);
    });
    render(<ShareControl caseId="case-1" />);
    fireEvent.click(screen.getByText("创建分享链接"));
    await waitFor(() => expect(screen.getByText("生成链接")).toBeTruthy());
    fireEvent.click(screen.getByText("生成链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-url]")).toBeTruthy());
    expect(document.querySelector("[data-gp-share-url]")!.textContent).toContain("/s/tok-abc");
    // 文案先说明撤销的边界，再让用户撤
    expect(screen.getByText(/已经下载走的副本无法收回/)).toBeTruthy();
    fireEvent.click(screen.getByText("撤销链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-revoked]")).toBeTruthy());
  });
});
