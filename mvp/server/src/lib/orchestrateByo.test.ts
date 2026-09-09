/**
 * orchestrateByo.test.ts — BYO key 接管调查管线（验收契约 docs/evals/2026-09-09-byo-key-takeover.md）。
 *
 * 覆盖四条 Evaluator：
 *   1. 接管测试：请求带 BYO 时主力模型调用收到用户 baseUrl/apiKey/modelName；
 *      未带时与现状一致（env 凭证走原有 provider 链）。
 *   2. 检索绑定测试：BYO 命中 MiniMax / 阶跃 → 对应检索 provider 换用户密钥；
 *      DeepSeek / 自定义 → 检索凭证仍是 env。
 *   3. fail-closed 测试：BYO 返回 401 → 以用户可读错误收尾，后续零 env 凭证回退调用。
 *   4. 不落盘测试：步骤/报告序列化、console 输出、公开流事件均不含 apiKey 值。
 *
 * 全部走 stub fetch + stub DNS，零真实外呼；密钥只存在于测试断言里。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOrchestrateAdapter } from "./orchestrate";
import { createHandlers, toPublicStreamEvent } from "../handlers";
import {
  ByoKeyError,
  isMiniMaxByoHost,
  isStepFunByoHost,
  parseByoConfig,
  searchEnvWithByoCredentials,
  setDnsLookupForTests,
} from "./orchestrateByo";
import { resetProviderQuotaSkipForTests } from "./providerRouter";
import { resetSearchQuotaSkipForTests, retrieveAtomSources } from "./searchProviders";

// DNS 注入：公开域名解析成公网 IP、private 前缀域名解析成内网 IP，测试永不触网。
setDnsLookupForTests(async (host: string) =>
  String(host).startsWith("private.")
    ? [{ address: "10.0.0.5", family: 4 }]
    : [{ address: "93.184.216.34", family: 4 }]
);

const BYO = {
  baseUrl: "https://byo.test/v1",
  apiKey: "byo-secret-key-123",
  modelName: "user-model-1",
};

const ENV_KEYS = {
  MINIMAX_API_KEY: "env-mm-key",
  STEPFUN_API_KEY: "env-sf-key",
  OPENAI_API_KEY: "env-openai-key",
};

/** 拆题 agent 的合法 JSON 输出（云端路径只要求可解析，不校验 schema）。 */
const RUMOR_JSON = JSON.stringify({
  claimAtoms: ["测试说法"],
  stanceClaimType: { verifiable: true, type: "fact", reason: "测试理由" },
});

type FetchCall = { url: string; init: Record<string, any> };

function installFetchStub(responder: (url: string, init: Record<string, any>) => unknown) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: Record<string, any>) => {
    const call = { url: String(input), init: (init ?? {}) as Record<string, any> };
    calls.push(call);
    return responder(call.url, call.init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function openAiJsonResponse(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

afterEach(() => {
  resetSearchQuotaSkipForTests();
  resetProviderQuotaSkipForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────
// parseByoConfig
// ───────────────────────────────────────────────────────────────

describe("parseByoConfig — 请求内 BYO 配置校验", () => {
  it("未携带 byoKey → ok 且无 config，行为零变化", async () => {
    expect(await parseByoConfig(undefined)).toEqual({ ok: true });
    expect(await parseByoConfig(null)).toEqual({ ok: true });
  });

  it("携带但缺字段 / 类型不对 → 拒绝并给出中文错误", async () => {
    const missing = await parseByoConfig({ baseUrl: "https://byo.test/v1", apiKey: "k" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("byoKey");
    const wrongType = await parseByoConfig("not-an-object");
    expect(wrongType.ok).toBe(false);
  });

  it("http 非 localhost → 拒绝（只有 dev 的 http://localhost / 127.0.0.1 放行）", async () => {
    const result = await parseByoConfig({ ...BYO, baseUrl: "http://byo.test/v1" });
    expect(result.ok).toBe(false);
    const local = await parseByoConfig({ ...BYO, baseUrl: "http://localhost:8787/v1" });
    expect(local.ok).toBe(true);
    const loopback = await parseByoConfig({ ...BYO, baseUrl: "http://127.0.0.1:8787/v1" });
    expect(loopback.ok).toBe(true);
  });

  it("借 localhost 前缀的公网域名 → 拒绝（防 http://localhost.evil.com 穿透明文放行）", async () => {
    // 按 URL hostname 精确判定，前缀相似的公网域名不得借 loopback 豁免明文收密钥。
    const lookalike = await parseByoConfig({ ...BYO, baseUrl: "http://localhost.evil.com/v1" });
    expect(lookalike.ok).toBe(false);
    const loopbackSuffix = await parseByoConfig({ ...BYO, baseUrl: "http://127.0.0.1.evil.com/v1" });
    expect(loopbackSuffix.ok).toBe(false);
    const badUrl = await parseByoConfig({ ...BYO, baseUrl: "not-a-url" });
    expect(badUrl.ok).toBe(false);
  });

  it("域名解析到内网 IP → 拒绝（与 test-llm 同一 SSRF 纪律）", async () => {
    const result = await parseByoConfig({ ...BYO, baseUrl: "https://private.test/v1" });
    expect(result.ok).toBe(false);
  });

  it("合法配置 → 归一化（去尾斜杠、去空白）", async () => {
    const result = await parseByoConfig({
      baseUrl: "  https://byo.test/v1/  ",
      apiKey: "  k  ",
      modelName: " m ",
    });
    expect(result).toEqual({
      ok: true,
      config: { baseUrl: "https://byo.test/v1", apiKey: "k", modelName: "m" },
    });
  });
});

// ───────────────────────────────────────────────────────────────
// Evaluator 1：接管测试（BYO 两向）
// ───────────────────────────────────────────────────────────────

function adapterOpts(over: Record<string, unknown> = {}) {
  return {
    claim: "测试说法",
    modelChoice: undefined as any,
    intakeMetadata: undefined,
    visualExtraction: undefined,
    clientMemoryRecall: undefined,
    ...over,
  };
}

describe("接管测试：BYO 存在时主力模型调用收到用户凭证", () => {
  it("runAgent 只打用户端点：URL / Bearer 用户密钥 / body.model=用户模型名，env 密钥零调用", async () => {
    const { calls } = installFetchStub(() => openAiJsonResponse(RUMOR_JSON));
    const adapter = createOrchestrateAdapter({
      env: { ...ENV_KEYS },
      codexBin: "codex-unused",
      byo: BYO,
    });
    const runAgent = adapter.makeRunAgent(
      adapterOpts({
        // modelChoice 指定了主力模型也必须被忽略：endpoint 与 model 成对，以 BYO modelName 为准
        modelChoice: { rumor_detector: { provider: "minimax", model: "MiniMax-M3" } },
      })
    );

    const step = await runAgent("rumor_detector", []);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://byo.test/v1/chat/completions");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${BYO.apiKey}`);
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe(BYO.modelName);
    // 所有外呼都以用户 baseUrl 开头：env 的 MiniMax / 阶跃端点一次都没被打
    expect(calls.every((c) => c.url.startsWith(BYO.baseUrl))).toBe(true);
    expect(step.model).toBe(`byo:${BYO.modelName}`);
    expect(step.output.claimAtoms).toEqual(["测试说法"]);
  });

  it("未携带 BYO → 与现状一致：走 env 的 MiniMax provider 链（x-api-key=env 密钥）", async () => {
    const { calls } = installFetchStub(() => ({
      ok: true,
      status: 200,
      text: async () =>
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: RUMOR_JSON } })}\n`,
    }));
    const adapter = createOrchestrateAdapter({ env: { ...ENV_KEYS }, codexBin: "codex-unused" });
    const runAgent = adapter.makeRunAgent(adapterOpts());

    const step = await runAgent("rumor_detector", []);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.minimaxi.com/anthropic/v1/messages");
    expect(calls[0].init.headers["x-api-key"]).toBe(ENV_KEYS.MINIMAX_API_KEY);
    expect(step.model).toContain("minimax:");
    expect(step.output.claimAtoms).toEqual(["测试说法"]);
  });

  it("自证 / 改写 / 交叉质询三个子调用在 BYO 下同样只打用户端点", async () => {
    const { calls } = installFetchStub(() => openAiJsonResponse('{"ok":true}'));
    const adapter = createOrchestrateAdapter({
      env: { ...ENV_KEYS },
      codexBin: "codex-unused",
      byo: BYO,
    });
    const input = { systemPrompt: "s", userContent: "u", responseSchema: {}, maxTokens: 600 };

    const selfProof = await adapter.makeSelfProofCaller("claim", {
      fact_checker: { provider: "minimax", model: "MiniMax-M3" },
    })(input);
    const rewrite = await adapter.makeRewriteCaller({
      fact_checker: { provider: "minimax", model: "MiniMax-M3" },
    })(input);
    const crossExam = adapter.makeCrossExamCaller(undefined);
    expect(crossExam).toBeTruthy();
    const cross = await crossExam!(input);

    expect(selfProof.model).toBe(`byo:${BYO.modelName}`);
    expect(rewrite.model).toBe(`byo:${BYO.modelName}`);
    expect(cross.model).toBe(`byo:${BYO.modelName}`);
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.url === `${BYO.baseUrl}/chat/completions`)).toBe(true);
    expect(
      calls.every((c) => c.init.headers.Authorization === `Bearer ${BYO.apiKey}`)
    ).toBe(true);
    expect(calls.every((c) => JSON.parse(c.init.body).model === BYO.modelName)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Evaluator 2：检索凭证绑定
// ───────────────────────────────────────────────────────────────

describe("检索凭证绑定：命中哪家换哪家，其余全走 env", () => {
  it("BYO baseUrl=MiniMax → MiniMax 检索换用户密钥，阶跃检索仍走 env，原 env 不被改写", () => {
    const env = { ...ENV_KEYS };
    const searchEnv = searchEnvWithByoCredentials(env, {
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "user-mm-key",
      modelName: "MiniMax-M3",
    });
    expect(searchEnv.MINIMAX_API_KEY).toBe("user-mm-key");
    expect(searchEnv.MINIMAX_BASE_URL).toBe("https://api.minimaxi.com");
    expect(searchEnv.STEPFUN_API_KEY).toBe(ENV_KEYS.STEPFUN_API_KEY);
    expect(env.MINIMAX_API_KEY).toBe(ENV_KEYS.MINIMAX_API_KEY);
  });

  it("MiniMax 别名域（/anthropic、.minimax.io、.minimax.cn）同样命中", () => {
    expect(isMiniMaxByoHost("https://api.minimaxi.com/anthropic/v1")).toBe(true);
    expect(isMiniMaxByoHost("https://api.minimax.io/v1")).toBe(true);
    expect(isMiniMaxByoHost("https://api.minimax.cn/v1")).toBe(true);
    expect(isMiniMaxByoHost("https://api.deepseek.com/v1")).toBe(false);
  });

  it("BYO baseUrl=阶跃 → 阶跃检索换用户密钥，MiniMax 仍走 env", () => {
    const searchEnv = searchEnvWithByoCredentials({ ...ENV_KEYS }, {
      baseUrl: "https://api.stepfun.com/v1",
      apiKey: "user-sf-key",
      modelName: "step-3.7-flash",
    });
    expect(searchEnv.STEPFUN_API_KEY).toBe("user-sf-key");
    expect(searchEnv.MINIMAX_API_KEY).toBe(ENV_KEYS.MINIMAX_API_KEY);
    expect(isStepFunByoHost("https://api.stepfun.com/v1")).toBe(true);
  });

  it("BYO baseUrl=DeepSeek / 自定义 → 返回原 env，检索凭证与现状一致", () => {
    const env = { ...ENV_KEYS };
    expect(searchEnvWithByoCredentials(env, { ...BYO, baseUrl: "https://api.deepseek.com/v1" })).toBe(env);
    expect(searchEnvWithByoCredentials(env, BYO)).toBe(env);
    expect(searchEnvWithByoCredentials(env, undefined)).toBe(env);
  });

  it("端到端：BYO=MiniMax 时检索请求带用户密钥；BYO=自定义时同一检索带 env 密钥", async () => {
    const minimaxAuthSeen: string[] = [];
    const { calls } = installFetchStub((url) => {
      if (url.includes("coding_plan/search")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            organic: [{ title: "来源", url: "https://n.test/1", snippet: "摘要" }],
          }),
        };
      }
      void url;
      return { ok: false, status: 500, statusText: "boom", json: async () => ({}) };
    });

    const byoMinimaxEnv = searchEnvWithByoCredentials({ ...ENV_KEYS }, {
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "user-mm-key",
      modelName: "MiniMax-M3",
    });
    await retrieveAtomSources(byoMinimaxEnv, "测试说法", undefined);
    const codingPlanCalls = calls.filter((c) => c.url.includes("coding_plan/search"));
    expect(codingPlanCalls.length).toBeGreaterThan(0);
    for (const call of codingPlanCalls) {
      const auth = String(call.init.headers.Authorization);
      minimaxAuthSeen.push(auth);
      expect(auth).toBe("Bearer user-mm-key");
    }

    // 同一条检索，BYO 是自定义端点（DeepSeek 家族之外不命中任何检索家）→ env 密钥
    calls.length = 0;
    const customEnv = searchEnvWithByoCredentials({ ...ENV_KEYS }, {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "user-ds-key",
      modelName: "deepseek-v4-flash",
    });
    await retrieveAtomSources(customEnv, "测试说法", undefined);
    for (const call of calls.filter((c) => c.url.includes("coding_plan/search"))) {
      expect(String(call.init.headers.Authorization)).toBe(`Bearer ${ENV_KEYS.MINIMAX_API_KEY}`);
    }
  });

  it("端到端：BYO=阶跃时阶跃 Step Plan 检索请求带用户密钥", async () => {
    const { calls } = installFetchStub((url) => {
      if (url.includes("step_plan")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ result: { structuredContent: { results: [] } } }),
        };
      }
      void url;
      return { ok: false, status: 500, statusText: "boom", json: async () => ({}) };
    });
    const stepEnv = searchEnvWithByoCredentials({ ...ENV_KEYS }, {
      baseUrl: "https://api.stepfun.com/v1",
      apiKey: "user-sf-key",
      modelName: "step-3.7-flash",
    });
    await retrieveAtomSources(stepEnv, "测试说法", undefined);
    const stepPlanCalls = calls.filter((c) => c.url.includes("step_plan"));
    expect(stepPlanCalls.length).toBeGreaterThan(0);
    for (const call of stepPlanCalls) {
      expect(String(call.init.headers.Authorization)).toBe("Bearer user-sf-key");
    }
  });
});

// ───────────────────────────────────────────────────────────────
// Evaluator 3：fail-closed
// ───────────────────────────────────────────────────────────────

describe("fail-closed：BYO 凭证失败 → 用户可读错误收尾，零 env 回退", () => {
  it("401 → ByoKeyError 上抛、onByoFailure 触发、只打了一次用户端点", async () => {
    const { calls } = installFetchStub(() => new Response("Unauthorized", { status: 401 }));
    const onByoFailure = vi.fn();
    const adapter = createOrchestrateAdapter({
      env: { ...ENV_KEYS },
      codexBin: "codex-unused",
      byo: BYO,
      onByoFailure,
    });
    const errors: Array<{ agent: string; error: unknown }> = [];
    const runAgent = adapter.makeRunAgent(
      adapterOpts({ onError: (agent: string, _cfg: unknown, error: unknown) => errors.push({ agent, error }) })
    );

    let caught: unknown;
    try {
      await runAgent("rumor_detector", []);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ByoKeyError);
    const byoError = caught as ByoKeyError;
    expect(byoError.userMessage).toContain("鉴权失败");
    expect(byoError.userMessage).not.toContain(BYO.apiKey);
    expect(onByoFailure).toHaveBeenCalledTimes(1);
    // 只有最初那一次用户端点调用：没有任何 env 凭证的回退重试
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${BYO.baseUrl}/chat/completions`);
    expect(errors.length).toBe(1);
  });

  it("网络失败 → 同样 fail-closed，用户可读文案不含密钥", async () => {
    installFetchStub(() => {
      throw new Error("ECONNREFUSED");
    });
    const adapter = createOrchestrateAdapter({
      env: { ...ENV_KEYS },
      codexBin: "codex-unused",
      byo: BYO,
    });
    let caught: unknown;
    try {
      await adapter.makeRunAgent(adapterOpts())("rumor_detector", []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ByoKeyError);
    expect((caught as ByoKeyError).userMessage).not.toContain(BYO.apiKey);
  });

  it("整条流收尾：orchestrate-stream 带 BYO 且端点 401 → 流以 error 帧结束、零 env 外呼、名额退还", async () => {
    const { calls } = installFetchStub(() => new Response("Unauthorized", { status: 401 }));
    const handlers = createHandlers({ ...ENV_KEYS });
    const ticket: any = { kind: "guest", guestId: "byo-failclosed-test", ipKey: null, settled: false };
    const req: any = {
      method: "POST",
      body: { claim: "测试说法", byoKey: { ...BYO } },
      checkTicket: ticket,
      on: vi.fn(),
    };
    const writes: string[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      writeHead: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk);
        return true;
      }),
      end: vi.fn(() => {
        res.writableEnded = true;
      }),
      on: vi.fn(),
    };

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    // 流以 error 收尾，公开文案是用户可读的密钥错误，且不含密钥值
    const events = writes
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent).toBeTruthy();
    expect(String(errorEvent!.message)).toContain("密钥");
    expect(String(errorEvent!.message)).toContain("鉴权失败");
    // 全部外呼都在用户端点上：没有任何 env 凭证（MiniMax / OpenAI）的回退调用
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${BYO.baseUrl}/chat/completions`);
    // 名额已退还（服务端侧失败不计费）
    expect(ticket.settled).toBe(true);
    // 公开流零泄漏
    expect(writes.join("")).not.toContain(BYO.apiKey);
  });

  it("BYO 配置畸形 → 400 拒绝且退还名额，不进入调查", async () => {
    const handlers = createHandlers({ ...ENV_KEYS });
    const ticket: any = { kind: "guest", guestId: "byo-invalid-test", ipKey: null, settled: false };
    const req: any = {
      method: "POST",
      body: { claim: "测试说法", byoKey: { baseUrl: "https://byo.test/v1" } },
      checkTicket: ticket,
      on: vi.fn(),
    };
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      writeHead: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn((body?: string) => {
        res.writableEnded = true;
        res.lastBody = body;
      }),
      on: vi.fn(),
    };

    await handlers.orchestrateStreamHandler(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(String(res.lastBody)).toContain("byoKey");
    expect(ticket.settled).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Evaluator 4：不落盘（密钥不出现在任何序列化面）
// ───────────────────────────────────────────────────────────────

describe("不落盘：步骤/报告/console/公开流均不含 apiKey", () => {
  it("BYO 成功跑完一个 agent：步骤序列化 + console 输出 + 公开流事件都不含密钥值", async () => {
    installFetchStub(() => openAiJsonResponse(RUMOR_JSON));
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
    const adapter = createOrchestrateAdapter({
      env: { ...ENV_KEYS },
      codexBin: "codex-unused",
      byo: BYO,
    });
    const steps = [];
    const step = await adapter.makeRunAgent(adapterOpts())("rumor_detector", steps as any);
    const selfProof = await adapter.makeSelfProofCaller("测试说法", undefined)({
      systemPrompt: "s",
      userContent: "u",
      responseSchema: {},
      maxTokens: 600,
    });

    // 案例存档形状：complete 事件里的 steps / finalReport 序列化
    const archiveShape = JSON.stringify({ steps: [...steps, step], finalReport: step.output });
    const consoleShape = JSON.stringify(consoleSpies.map((spy) => spy.mock.calls));
    const publicEvent = toPublicStreamEvent({
      type: "agent_complete",
      agent: step.agent,
      output: step.output,
      model: step.model,
      latencyMs: step.latencyMs,
    });

    expect(archiveShape).not.toContain(BYO.apiKey);
    expect(consoleShape).not.toContain(BYO.apiKey);
    expect(JSON.stringify(publicEvent)).not.toContain(BYO.apiKey);
    expect(selfProof.model).toBe(`byo:${BYO.modelName}`);
  });

  it("BYO 失败路径：ByoKeyError 的 message / userMessage 都不含密钥值", async () => {
    installFetchStub(() => new Response("Unauthorized", { status: 401 }));
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const adapter = createOrchestrateAdapter({
      env: { ...ENV_KEYS },
      codexBin: "codex-unused",
      byo: BYO,
    });
    let caught: unknown;
    try {
      await adapter.makeRunAgent(adapterOpts())("rumor_detector", []);
    } catch (error) {
      caught = error;
    }
    const serialized = JSON.stringify({
      error: caught,
      message: (caught as Error).message,
      console: consoleSpies.map((spy) => spy.mock.calls),
    });
    expect(serialized).not.toContain(BYO.apiKey);
  });
});
