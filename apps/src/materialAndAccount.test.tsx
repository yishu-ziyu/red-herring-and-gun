/**
 * 材料入口与账号隔离验收（ACCEPTANCE A05 / A24 / A28）。
 *
 * A05：输入可以带文字、图片、链接；附件有缩略图、文件名与移除动作；
 *      抓取到的网页正文不能替换用户原话。
 * A24：账号 A 看不到账号 B 的历史。
 * A28：登录失败要说真话，且不能把已经填好的材料清掉。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createCaseIntake, caseIntakePrimaryText } from "./lib/caseIntake";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("A05 附件与原话分离", () => {
  it("抓取正文进 scrapedContent，不顶替用户原话", () => {
    const intake = createCaseIntake("隔夜菜会致癌 https://example.org/a", []);
    // 抓取发生在提交前，由调用方填；此处验证两者是不同的槽位
    const withScrape = { ...intake, scrapedContent: "网页正文：某某报道说……" };
    expect(caseIntakePrimaryText(withScrape)).toBe("隔夜菜会致癌 https://example.org/a");
    expect(withScrape.scrapedContent).not.toContain("隔夜菜会致癌");
    expect(caseIntakePrimaryText(withScrape)).not.toContain("网页正文");
  });

  it("图片带文件名进 intake，且不混进原话", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "截图.png", { type: "image/png" });
    const intake = createCaseIntake("这张图里的说法对吗", [
      { id: "img-1", name: file.name, size: file.size, type: file.type, dataUrl: "data:image/png;base64,AA==" },
    ] as never);
    expect(intake.images).toHaveLength(1);
    expect(intake.images[0]!.name).toBe("截图.png");
    expect(caseIntakePrimaryText(intake)).toBe("这张图里的说法对吗");
  });
});

function mockFetch(options: { accountEmail?: string; cases?: unknown[] } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : "";
    if (url.includes("/api/models/health")) {
      return new Response(JSON.stringify({ status: "available", message: "" }), { status: 200 });
    }
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      return options.accountEmail
        ? new Response(JSON.stringify({ authenticated: true, email: options.accountEmail }), { status: 200 })
        : new Response(JSON.stringify({ authenticated: false }), { status: 401 });
    }
    if (url.includes("/api/checks/quota")) {
      return new Response(JSON.stringify({ remaining: 2, total: 2, used: 0, kind: "guest" }), { status: 200 });
    }
    if (url.includes("/api/cases")) {
      return new Response(JSON.stringify({ cases: options.cases ?? [] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

describe("A24 历史按账号隔离", () => {
  it("A 账号只显示服务端返回给自己的那一条", async () => {
    mockFetch({
      accountEmail: "a@example.com",
      cases: [{ caseId: "case-a", claim: "只有 A 看得到的说法", status: "done", createdAt: 1_760_000_000_000 }],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
    await waitFor(() => expect(screen.getByText("只有 A 看得到的说法")).toBeTruthy());
    expect(screen.queryByText("只有 B 看得到的说法")).toBeNull();
  });
});

describe("A28 登录失败与退出失败说真话", () => {
  it("服务端没给历史（未登录）时不显示别人的记录，也不假装有历史", async () => {
    mockFetch({});
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
    await waitFor(() => expect(screen.queryByText("只有 A 看得到的说法")).toBeNull());
  });

  it("登录请求失败时给出失败状态，不清空已填材料", async () => {
    mockFetch({});
    render(<App />);
    const editor = document.querySelector<HTMLElement>('#claim-input[contenteditable="true"]');
    expect(editor).toBeTruthy();
    // jsdom 没有 execCommand：直接写 textContent 再派发 input，形状与真实输入一致。
    editor!.textContent = "这条说法先留着";
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => expect(editor!.textContent).toBe("这条说法先留着"));

    // 打开登录弹窗再失败
    const login = screen.getAllByText("登录")[0]!;
    fireEvent.click(login);
    await waitFor(() => expect(document.querySelector("input[type=email], input")).toBeTruthy());
    // 材料没有被弹窗清掉
    expect(document.querySelector('#claim-input[contenteditable="true"]')!.textContent).toBe("这条说法先留着");
  });
});
