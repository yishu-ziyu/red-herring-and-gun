/**
 * agentExpansion.byo.test.ts — 发起调查时携带本地 BYO 配置（验收契约 Change 1）。
 *
 * 覆盖：保存过密钥 → orchestrate-stream 请求体带 byoKey；
 * 未保存 / 存储损坏 → 请求体与现状完全一致（无 byoKey 字段，行为零变化）。
 * 全部走 stub fetch，零真实外呼。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestOrchestrateStream } from "./agentExpansion";
import { BYO_KEY_STORAGE_KEY, obfuscateByoKey, readSavedByoKey } from "./byoKeyRequest";

const SAVED_KEY = {
  baseUrl: "https://api.minimaxi.com/v1",
  apiKey: "user-secret-key-456",
  modelName: "MiniMax-M3",
};

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

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("readSavedByoKey — 本地 BYO 配置读取", () => {
  it("未保存 → null", () => {
    expect(readSavedByoKey()).toBeNull();
  });

  it("保存过 → 解出原值", () => {
    window.localStorage.setItem(BYO_KEY_STORAGE_KEY, obfuscateByoKey(SAVED_KEY));
    expect(readSavedByoKey()).toEqual(SAVED_KEY);
  });

  it("损坏数据 / 任一字段为空 → 视为没有配置", () => {
    window.localStorage.setItem(BYO_KEY_STORAGE_KEY, "not-base64-json!!");
    expect(readSavedByoKey()).toBeNull();
    window.localStorage.setItem(
      BYO_KEY_STORAGE_KEY,
      obfuscateByoKey({ baseUrl: "https://a.test", apiKey: "", modelName: "m" })
    );
    expect(readSavedByoKey()).toBeNull();
  });
});

describe("requestOrchestrateStream — BYO 配置随请求上行（Change 1）", () => {
  it("保存过密钥 → 请求体带 byoKey（baseUrl/apiKey/modelName 原样上行）", async () => {
    const fetchMock = installSseFetchStub();
    window.localStorage.setItem(BYO_KEY_STORAGE_KEY, obfuscateByoKey(SAVED_KEY));

    await drainStream(requestOrchestrateStream("测试说法"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body);
    expect(body.byoKey).toEqual(SAVED_KEY);
  });

  it("未保存密钥 → 请求体没有 byoKey 字段，与现状完全一致", async () => {
    const fetchMock = installSseFetchStub();

    await drainStream(requestOrchestrateStream("测试说法"));

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body);
    expect("byoKey" in body).toBe(false);
    expect(body.claim).toBe("测试说法");
  });

  it("存储数据损坏 → 同样不带 byoKey（半份配置绝不上行）", async () => {
    const fetchMock = installSseFetchStub();
    window.localStorage.setItem(BYO_KEY_STORAGE_KEY, "corrupted!!!");

    await drainStream(requestOrchestrateStream("测试说法"));

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body);
    expect("byoKey" in body).toBe(false);
  });
});
