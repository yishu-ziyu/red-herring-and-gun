/**
 * 追问关联通道（契约 docs/evals/2026-09-12-followup-observation.md Change 1）。
 *
 * 登录传 priorCaseId → payload 带 caseId + followUp:true；
 * 访客无 caseId 时传 priorRound → followUp:true + 上一轮可见材料；
 * 首轮与 legacy 不传，这些字段都不出现。
 * 全部走 stub fetch，零真实外呼。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestOrchestrateStream } from "./agentExpansion";

function installSseFetchStub() {
  const fetchMock = vi.fn(async (_input: unknown, init?: Record<string, any>) => {
    void init;
    return new Response('data: {"type":"error","message":"测试结束"}\n\n', { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function drainStream(run: AsyncGenerator<unknown>) {
  for await (const _event of run) {
    void _event;
  }
}

function requestBody(fetchMock: ReturnType<typeof installSseFetchStub>): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]![1]!.body) as Record<string, unknown>;
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("requestOrchestrateStream — 追问关联字段", () => {
  it("传 priorCaseId → payload 带 caseId 与 followUp:true", async () => {
    const fetchMock = installSseFetchStub();

    await drainStream(requestOrchestrateStream("测试说法", undefined, undefined, "req-follow-1", "case-abc123"));

    const body = requestBody(fetchMock);
    expect(body.caseId).toBe("case-abc123");
    expect(body.followUp).toBe(true);
    expect(body.clientRequestId).toBe("req-follow-1");
  });

  it("不传 priorCaseId → payload 没有 caseId / followUp（首轮与 legacy 与现状一致）", async () => {
    const fetchMock = installSseFetchStub();

    await drainStream(requestOrchestrateStream("测试说法", undefined, undefined, "req-first-1"));

    const body = requestBody(fetchMock);
    expect("caseId" in body).toBe(false);
    expect("followUp" in body).toBe(false);
    expect(body.claim).toBe("测试说法");
  });

  it("priorCaseId 为空串 → 视为没传，两个字段都不上行", async () => {
    const fetchMock = installSseFetchStub();

    await drainStream(requestOrchestrateStream("测试说法", undefined, undefined, undefined, ""));

    const body = requestBody(fetchMock);
    expect("caseId" in body).toBe(false);
    expect("followUp" in body).toBe(false);
  });

  it("无 caseId、带上一轮可见材料 → followUp:true + priorRound，不带 caseId", async () => {
    const fetchMock = installSseFetchStub();
    const priorRound = {
      originalClaim: "隔夜菜会中毒",
      conclusion: "普通家庭剂量谈不上中毒。",
      claims: [
        {
          text: "吃了隔夜菜会导致中毒",
          judgment: "refuted" as const,
          evidence: [
            { url: "https://who.example/foodborne", title: "食源性疾病", excerpt: "谈不上中毒", role: "contradict" as const },
          ],
        },
      ],
    };

    await drainStream(
      requestOrchestrateStream("测试说法", undefined, undefined, "req-guest-1", { priorRound })
    );

    const body = requestBody(fetchMock);
    expect("caseId" in body).toBe(false);
    expect(body.followUp).toBe(true);
    expect(body.priorRound).toEqual(priorRound);
  });
});

describe("requestOrchestrateStream — 接口进程死掉", () => {
  it("Failed to fetch 不原样上屏，换成连接中断说明", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const events: Array<{ type?: string; message?: string }> = [];
    for await (const event of requestOrchestrateStream("测试说法")) {
      events.push(event as { type?: string; message?: string });
    }
    expect(events).toEqual([
      { type: "error", message: "与核查服务的连接中断了，这次没有查完。请重试。" },
    ]);
  });
});
