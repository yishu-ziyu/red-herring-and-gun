/**
 * 追问关联通道：前端接线（契约 docs/evals/2026-09-12-followup-observation.md Change 1/3）。
 *
 * 走真实 requestOrchestrateStream + 真实 useInvestigationRun，只把网络挡在 fetch：
 * 完成态追问：登录且有存档 → caseId + followUp:true；
 * 访客 / 取不到 caseId → 无 caseId、followUp:true、带上一轮可见材料。
 * 首轮请求不带这些字段。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { investigatingUnassessed, refutedComplete, REFUTED_CLAIM } from "./goldenPath/fixtures";

const SERVER_CASE_ID = "srv-case-9527";

/** 首轮与追问共用同一条脚本化 SSE：拆题快照 → 完成快照 → complete。 */
function sseStream(): string {
  const frames = [
    { type: "investigation_snapshot", investigation: investigatingUnassessed() },
    { type: "investigation_snapshot", investigation: refutedComplete() },
    { type: "complete", finalReport: { conclusion: "原句站不住。", investigation: refutedComplete() } },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** savedCaseId 为 null/缺省 = POST /api/case 没给 caseId（完成态拿不到 caseId）。 */
function mockFetch(plan: { accountEmail?: string; savedCaseId?: string | null }): Record<string, unknown>[] {
  const orchestrateBodies: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : ((input as { url?: string })?.url ?? "");
    if (url.includes("/api/agent/orchestrate-stream")) {
      orchestrateBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(sseStream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.includes("/api/models/health")) return jsonResponse({ status: "available", message: "" });
    // 一条模型都没有时输入态会锁住提交（blocked）；给一条，模拟正常服务端。
    if (url.includes("/api/models/list")) {
      return jsonResponse({ models: [{ provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }] });
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      if (!plan.accountEmail) return jsonResponse({ authenticated: false }, 401);
      return jsonResponse({
        authenticated: true,
        email: plan.accountEmail,
        displayName: "核对人",
        createdAt: 1757000000000,
        loginCount: 1,
        lastLoginAt: 1757000000000,
      });
    }
    if (url.includes("/api/checks/quota")) return jsonResponse({ remaining: 1, total: 1, used: 0, kind: "guest" });
    if (url.endsWith("/api/cases")) return jsonResponse({ cases: [] });
    if (/\/api\/case\/[^/]+$/.test(url)) return new Response("not-found", { status: 404 });
    // 服务端存档只在已登录时发生（匿名案件没有 caseId）。
    if (url.endsWith("/api/case")) {
      return plan.savedCaseId ? jsonResponse({ caseId: plan.savedCaseId }) : new Response("save-failed", { status: 404 });
    }
    return new Response("not-found", { status: 404 });
  });
  return orchestrateBodies;
}

async function submitFirstClaim() {
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
  editor.textContent = REFUTED_CLAIM;
  fireEvent.input(editor);
  // 模型清单到手前提交按钮是锁住的（blocked）；等解锁再点。
  const submit = screen.getByRole("button", { name: /开始调查/ });
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy());
}

async function sendFollowUp(question: string) {
  const box = await screen.findByPlaceholderText(/针对此结论追问/);
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "发送追问" }));
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("追问 payload 关联刚完成案件", () => {
  it("完成态追问：第二次请求带 caseId + followUp:true；首轮两个字段都不带", async () => {
    const bodies = mockFetch({ accountEmail: "checker@example.com", savedCaseId: SERVER_CASE_ID });
    await submitFirstClaim();
    // 分享入口出现 = 服务端存档已回 id，active.serverCaseId 已拿到（同一来源）
    await waitFor(() => expect(document.querySelector("[data-gp-share-start]")).toBeTruthy());

    await sendFollowUp("那孕妇可以吃吗？");
    await waitFor(() => expect(bodies.length).toBe(2));

    const first = bodies[0]!;
    expect("caseId" in first).toBe(false);
    expect("followUp" in first).toBe(false);

    const followUpBody = bodies[1]!;
    expect(followUpBody.caseId).toBe(SERVER_CASE_ID);
    expect(followUpBody.followUp).toBe(true);
    expect("priorRound" in followUpBody).toBe(false);
  });

  it("未登录追问：无 caseId，带 followUp 与上一轮可见材料", async () => {
    const bodies = mockFetch({});
    await submitFirstClaim();

    await sendFollowUp("那孕妇可以吃吗？");
    await waitFor(() => expect(bodies.length).toBe(2));

    const first = bodies[0]!;
    expect("caseId" in first).toBe(false);
    expect("followUp" in first).toBe(false);
    expect("priorRound" in first).toBe(false);

    const followUpBody = bodies[1]!;
    expect("caseId" in followUpBody).toBe(false);
    expect(followUpBody.followUp).toBe(true);
    expect(followUpBody.priorRound).toMatchObject({
      originalClaim: REFUTED_CLAIM,
      claims: [
        expect.objectContaining({
          text: expect.stringContaining("隔夜水"),
          judgment: "refuted",
          evidence: [expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//) })],
        }),
      ],
    });
    expect(JSON.stringify(followUpBody.priorRound)).not.toContain("finding");
    expect(JSON.stringify(followUpBody.priorRound)).not.toContain("请直接回答这次追问");
  });

  it("取不到 caseId（服务端存档失败）：无 caseId，仍带 followUp 与上一轮材料", async () => {
    const bodies = mockFetch({ accountEmail: "checker@example.com", savedCaseId: null });
    await submitFirstClaim();
    await screen.findByText("账户历史同步失败，暂时无法跨设备找回。");

    await sendFollowUp("那孕妇可以吃吗？");
    await waitFor(() => expect(bodies.length).toBe(2));

    const followUpBody = bodies[1]!;
    expect("caseId" in followUpBody).toBe(false);
    expect(followUpBody.followUp).toBe(true);
    expect(followUpBody.priorRound).toMatchObject({
      originalClaim: REFUTED_CLAIM,
    });
  });
});
