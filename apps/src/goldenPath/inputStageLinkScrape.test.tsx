/**
 * 链接抓取失败在输入态的用户可见行为（主路 P0 Change A）。
 *
 * 关键点：提交后 App 立刻切到调查态、输入态整块卸载，所以提示不能挂在输入态的树上
 * （wiring-review.md P8）。这里断言提示真的落到文档里、并且 claim 里没有空信封。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { type CaseIntake } from "../lib/caseIntake";
import { InputStage } from "./InputStage";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return { ...actual, requestOrchestrateStream: vi.fn(async function* () {}) };
});

const WEIBO_URL = "https://weibo.com/status/50891234";
const NOTICE = "链接打不开（可能需要登录），已按你输入的文字继续";

const ARTICLE = [
  "天津卫健委的实验数据：炒青菜在室温存放 18 小时后，亚硝酸盐含量比存放 6 小时增加 443%。",
  "同一实验里红烧鲫鱼增加 54%、韭菜炒蛋增加 47%、红烧肉变化不大。",
  "食药署说明：隔夜菜本身并不会致癌，亚硝酸盐要在胃酸环境下与胺类结合生成亚硝胺才有致癌性。",
  "多来源确认隔夜菜里的亚硝酸盐会随时间上升，但只有摄入量超过 500 毫克时才谈得上致癌。",
  "这份材料只说明含量随时间上升，不能推出「超标百倍」的计算依据；存放温度、菜品类型都会改变结果。",
  "可见的关键缺口是：没有给出与国家标准限值对照的检测数据，也就无法核实「百倍」这个倍数。",
].join("");

const LOGIN_WALL = `Title: Sina Visitor System\n\nURL Source: ${WEIBO_URL}\n\nMarkdown Content:`;

function stubFetch(scrapeBody: string) {
  const fetcher = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/models/health")) return new Response(JSON.stringify({ status: "available" }), { status: 200 });
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models: [{ provider: "deepseek", model: "deepseek-v4-pro" }] }), { status: 200 });
    }
    if (url.includes("/api/checks/quota")) {
      return new Response(JSON.stringify({ remaining: 2, total: 2, used: 0, kind: "guest" }), { status: 200 });
    }
    if (url.startsWith("https://r.jina.ai/")) return new Response(scrapeBody, { status: 200 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function submitClaim(text: string) {
  const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
  const send = document.querySelector<HTMLButtonElement>("[data-prompt-send]")!;
  editor.textContent = text;
  fireEvent.input(editor);
  await waitFor(() => expect(send).not.toBeDisabled());
  fireEvent.click(send);
}

async function submittedIntake(onSubmit: ReturnType<typeof vi.fn>): Promise<CaseIntake> {
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0]![0] as CaseIntake;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll(".gp-link-scrape-notice").forEach((node) => node.remove());
});

describe("链接抓不到：提示必须出现，材料照旧继续", () => {
  it("文字 + 打不开的链接：提示出现，claim 只有用户自己的话", async () => {
    stubFetch(LOGIN_WALL);
    const onSubmit = vi.fn();
    render(<InputStage onSubmit={onSubmit} />);

    await submitClaim(`${WEIBO_URL} 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？`);

    const intake = await submittedIntake(onSubmit);
    expect(intake.links[0]!.scrapeFailed).toBe(true);
    expect(intake.text).toContain("隔夜菜亚硝酸盐超标百倍直接致癌");
    expect(intake.text).not.toContain("【链接抓取内容】");
    expect(intake.text).not.toContain("Sina Visitor System");
    await waitFor(() => expect(document.body.textContent).toContain(NOTICE));
  });

  it("只贴打不开的链接且无正文：请求补充材料，不发起无对象调查", async () => {
    stubFetch(LOGIN_WALL);
    const onSubmit = vi.fn();
    render(<InputStage onSubmit={onSubmit} />);

    await submitClaim(WEIBO_URL);

    await screen.findByText(/请补充原文或截图，尚未开始调查/);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(NOTICE);
  });

  it("提示挂在页面容器上，不在输入态里面（输入态卸载也不丢）", async () => {
    stubFetch(LOGIN_WALL);
    const view = render(<InputStage onSubmit={vi.fn()} />);

    await submitClaim(`${WEIBO_URL} 隔夜菜会致癌吗？`);
    await waitFor(() => expect(document.body.textContent).toContain(NOTICE));

    const notice = document.querySelector(".gp-link-scrape-notice")!;
    expect(notice.closest(".gp-input-stage")).toBeNull();

    view.unmount();

    expect(document.body.textContent).toContain(NOTICE);
  });
});

describe("链接抓得到：不打扰用户，正文进 claim", () => {
  it("抓到的正文拼进 claim，且不出现打不开的提示", async () => {
    stubFetch(ARTICLE);
    const onSubmit = vi.fn();
    render(<InputStage onSubmit={onSubmit} />);

    await submitClaim(`${WEIBO_URL} 隔夜菜会致癌吗？`);

    const intake = await submittedIntake(onSubmit);
    expect(intake.links[0]!.scrapeFailed).toBe(false);
    expect(intake.text).toContain("【链接抓取内容】");
    expect(intake.text).toContain("炒青菜在室温存放 18 小时");
    expect(document.body.textContent).not.toContain(NOTICE);
  });
});

describe("真实 App 接线：提交后输入态卸载，提示仍在", () => {
  function stubAppFetch(scrapeBody: string) {
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/models/health")) return new Response(JSON.stringify({ status: "available" }), { status: 200 });
      if (url.includes("/api/models/list")) {
        return new Response(JSON.stringify({ models: [{ provider: "deepseek", model: "deepseek-v4-pro" }] }), { status: 200 });
      }
      if (url.includes("/api/checks/quota")) {
        return new Response(JSON.stringify({ remaining: 2, total: 2, used: 0, kind: "guest" }), { status: 200 });
      }
      if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
      }
      if (url.includes("/api/cases")) return new Response(JSON.stringify({ cases: [] }), { status: 200 });
      if (url.startsWith("https://r.jina.ai/")) return new Response(scrapeBody, { status: 200 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("贴微博登录墙链接：切到调查态后提示还在页面上（P8 的失败模式）", async () => {
    stubAppFetch(LOGIN_WALL);
    render(<App />);

    const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
    const send = document.querySelector<HTMLButtonElement>("[data-prompt-send]")!;
    editor.textContent = `${WEIBO_URL} 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？`;
    fireEvent.input(editor);
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);

    await waitFor(() => expect(document.querySelector(".gp-input-stage")).toBeNull());
    expect(document.body.textContent).toContain(NOTICE);
    expect(document.body.textContent).not.toContain("【链接抓取内容】");
    expect(document.querySelector(".gp-global-notice")?.textContent).toContain(NOTICE);
    await waitFor(() => expect(document.querySelectorAll(".gp-link-scrape-notice")).toHaveLength(0));
    const duplicateNotices = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].filter((el) =>
      (el.textContent ?? "").includes(NOTICE)
    );
    expect(duplicateNotices).toHaveLength(1);
  });

  it("只贴打不开的链接：保留输入，让用户补材料，不发送核查请求", async () => {
    const fetcher = stubAppFetch(LOGIN_WALL);
    render(<App />);

    const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
    const send = document.querySelector<HTMLButtonElement>("[data-prompt-send]")!;
    editor.textContent = WEIBO_URL;
    fireEvent.input(editor);
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);

    await screen.findByText(/请补充原文或截图，尚未开始调查/);
    expect(document.querySelector(".gp-input-stage")).toBeTruthy();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/orchestrate-stream"))).toBe(false);
  });
});
