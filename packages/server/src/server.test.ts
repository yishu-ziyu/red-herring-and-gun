import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeLlm,
  replay,
  validateEvent,
  type CaseEvent,
  type CallJobResult,
  type LlmJob,
  type RunTurnDeps,
  type SearchHit,
  type SearchProviderFn,
} from "@rhg/core";
import { createApp } from "./app.js";
import { QUOTA_EXCEEDED } from "./copy.js";
import { toPublicEvent } from "./publicEvent.js";
import { createQuota } from "./quota.js";
import { FileCaseStore } from "./store.js";
import { TurnRunner } from "./turns.js";

const TEXT = "某部门发文说津贴打到个人卡";
const SNIPPET = "官方通报此事不实，津贴由单位申领。";
const AT = "2026-09-03T12:00:00.000Z";
const VENDOR_RE = /minimax|stepfun|deepseek|mimo|openai|anthropic|web_search|gpt|claude/i;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const fn of pending) await fn();
});

function readyQualify(source: string) {
  const cut = Math.min(4, Math.max(2, source.length - 2));
  return {
    ready: true as const,
    reason: "ready" as const,
    subjectText: source.slice(0, cut),
    claimText: source,
    gap: "",
    antecedentText: "",
  };
}

function script() {
  return {
    qualify: readyQualify(TEXT),
    qualify_review: { subjectLanded: true },
    decompose: { claims: [{ text: TEXT, type: "fact" as const, checkable: true }] },
    "self-proof": { results: [] },
    assess: {
      stances: [
        {
          evidenceId: "e1",
          stance: "refutes" as const,
          quote: "官方通报此事不实",
          confidence: 0.9,
        },
      ],
    },
    compose: {
      conclusion: "津贴不会直接打到个人卡，仍由单位申领。",
      claimItems: [{ claimId: "c1", line: "津贴直接打到个人卡：与现有依据相反。[1]" }],
    },
    investigate: { action: { kind: "stop" as const, target: "", why: "没有缺口" } },
  };
}

function hits(provider?: string): SearchProviderFn {
  return async function gov(): Promise<SearchHit[]> {
    return [
      {
        url: "https://www.gov.cn/zhengce/allowance",
        title: "通报",
        snippet: SNIPPET,
        ...(provider ? { provider } : {}),
      },
    ];
  };
}

function idleFetch() {
  return async () => {
    throw new Error("fetch should not run");
  };
}

function makeDeps(overrides: {
  llm?: LlmJob;
  provider?: string;
  model?: string;
  now?: () => string;
} = {}): RunTurnDeps {
  const inner = createFakeLlm(script());
  const llm: LlmJob =
    overrides.llm ??
    (async (params) => {
      const result = await inner(params);
      return overrides.model ? { ...result, model: overrides.model } : result;
    });
  return {
    llm,
    searchProviders: [hits(overrides.provider)],
    tools: { search: async () => [], fetch: idleFetch() },
    now: overrides.now ?? (() => AT),
  };
}

type Harness = {
  base: string;
  dir: string;
  turns: TurnRunner;
  close: () => Promise<void>;
};

async function listen(deps: RunTurnDeps, extra?: { quotaLimit?: number; heartbeatMs?: number }): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "rhg-t15-"));
  const store = new FileCaseStore(dir);
  const turns = new TurnRunner(store, deps);
  const quota = createQuota({ limit: extra?.quotaLimit ?? 0 });
  const app = createApp({
    deps,
    store,
    turns,
    quota,
    ...(extra?.heartbeatMs !== undefined ? { heartbeatMs: extra.heartbeatMs } : {}),
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const close = async () => {
    await turns.abortAll();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dir, { recursive: true, force: true });
  };
  cleanups.push(close);
  return { base: `http://127.0.0.1:${port}`, dir, turns, close };
}

async function postCase(base: string, text: string, extra?: object): Promise<Response> {
  return fetch(`${base}/api/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...extra }),
  });
}

async function readJsonl(dir: string, caseId: string): Promise<CaseEvent[]> {
  const text = await readFile(join(dir, `${caseId}.jsonl`), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CaseEvent);
}

async function waitFor(
  fn: () => Promise<boolean>,
  ms = 8_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timeout waiting");
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

function hangingLlm(gate: Promise<void>, onAssess?: (signal?: AbortSignal) => void): LlmJob {
  const inner = createFakeLlm(script());
  return async (params) => {
    if (params.job === "assess") {
      onAssess?.();
      await gate;
    }
    return inner(params);
  };
}

function parseSse(text: string): { comments: string[]; events: CaseEvent[]; ids: number[] } {
  const events: CaseEvent[] = [];
  const comments: string[] = [];
  const ids: number[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    if (block.startsWith(":")) {
      comments.push(block);
      continue;
    }
    let data = "";
    let id = "";
    let name = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7).trim();
      else if (line.startsWith("id: ")) id = line.slice(4).trim();
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (!data) continue;
    expect(name).toBe("case.event");
    const event = JSON.parse(data) as CaseEvent;
    events.push(event);
    if (id) ids.push(Number(id));
  }
  return { comments, events, ids };
}

async function readSseUntil(
  res: Response,
  pred: (buf: string) => boolean,
  ms = 8_000,
): Promise<{ buf: string; cancel: () => Promise<void> }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  const start = Date.now();
  while (Date.now() - start < ms) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (pred(buf)) return { buf, cancel: () => reader.cancel() };
  }
  return { buf, cancel: () => reader.cancel() };
}

function evidenceAdded(overrides: Partial<Extract<CaseEvent, { type: "evidence.added" }>["evidence"]> = {}): CaseEvent {
  return {
    type: "evidence.added",
    seq: 2,
    at: AT,
    evidence: {
      id: "e1",
      url: "https://news.example/a",
      canonicalUrl: "https://news.example/a",
      host: "news.example",
      excerpt: "摘要",
      text: "OpenAI 出现在正文里应保留",
      retrievedAt: AT,
      tier: "C",
      provenance: { kind: "search", query: "津贴", provider: "web_search" },
      ...overrides,
    },
  };
}

describe("server", () => {
  it("GET 折叠状态等于 replay(公开事件)", async () => {
    const { base, turns } = await listen(makeDeps());
    const created = await postCase(base, TEXT);
    expect(created.status).toBe(202);
    const { caseId } = (await created.json()) as { caseId: string };
    await turns.wait(caseId);
    const res = await fetch(`${base}/api/cases/${caseId}`);
    const body = (await res.json()) as { case: unknown; events: CaseEvent[] };
    expect(body.case).toEqual(replay(body.events));
  });

  it("jsonl 逐行 replay 后与 GET 的公开 case 一致", async () => {
    const { base, dir, turns } = await listen(makeDeps());
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    await turns.wait(caseId);
    const raw = await readJsonl(dir, caseId);
    const publicLog = raw.map(toPublicEvent);
    const res = await fetch(`${base}/api/cases/${caseId}`);
    const body = (await res.json()) as { case: unknown };
    expect(body.case).toEqual(replay(publicLog));
  });

  it("assess 挂起时 jsonl 已有 turn.started 与之前阶段", async () => {
    const gate = deferred();
    const { base, dir, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    await waitFor(async () => {
      try {
        const events = await readJsonl(dir, caseId);
        return events.some((event) => event.type === "turn.started");
      } catch {
        return false;
      }
    });
    const events = await readJsonl(dir, caseId);
    expect(events.some((event) => event.type === "turn.started")).toBe(true);
    expect(
      events.some(
        (event) =>
          (event.type === "stage.started" || event.type === "stage.finished") &&
          (event.stage === "intake" || event.stage === "decompose" || event.stage === "retrieve"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "turn.finished")).toBe(false);
    gate.resolve();
    await turns.wait(caseId);
  });

  it("SSE 文本不含厂商与工具名", async () => {
    const { base, turns } = await listen(
      makeDeps({
        model: "minimax-x",
        provider: "web_search",
        llm: async (params) => {
          if (params.job === "assess") throw new Error("stepfun 500");
          const result = await createFakeLlm(script())(params);
          return { ...result, model: "minimax-x" } satisfies CallJobResult;
        },
      }),
    );
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const stream = await fetch(`${base}/api/cases/${caseId}/stream`);
    const { buf, cancel } = await readSseUntil(stream, (text) => text.includes("turn.finished"));
    await cancel();
    await turns.wait(caseId);
    expect(buf).not.toMatch(VENDOR_RE);
  });

  it("toPublicEvent 仍过 validateEvent，证据正文里的 OpenAI 保留", () => {
    const llm: CaseEvent = {
      type: "llm.called",
      seq: 3,
      at: AT,
      job: "assess",
      model: "minimax-x",
      latencyMs: 12,
      ok: false,
      error: "stepfun 500",
      attempts: [{ provider: "minimax", model: "MiniMax-M3", ok: false, latencyMs: 12, error: "stepfun 500" }],
    };
    const cleaned = toPublicEvent(llm);
    expect(() => validateEvent(cleaned)).not.toThrow();
    expect(cleaned).toMatchObject({ type: "llm.called", model: "", job: "assess" });
    expect("error" in cleaned).toBe(false);
    expect("attempts" in cleaned).toBe(false);

    const added = evidenceAdded();
    const publicAdded = toPublicEvent(added);
    expect(() => validateEvent(publicAdded)).not.toThrow();
    expect(publicAdded.type === "evidence.added" ? publicAdded.evidence.text : "").toContain("OpenAI");
    expect(publicAdded.type === "evidence.added" ? publicAdded.evidence.provenance : {}).toEqual({
      kind: "search",
      query: "津贴",
    });
  });

  it("开机修复未收口日志", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rhg-t21-"));
    const store = new FileCaseStore(dir);
    await store.append("case-orphan", [
      validateEvent({ type: "case.created", seq: 1, at: AT, id: "case-orphan", text: TEXT }),
      validateEvent({ type: "turn.started", seq: 2, at: AT, turnId: "t1" }),
      validateEvent({ type: "stage.started", seq: 3, at: AT, stage: "decompose" }),
    ]);
    await store.repairIncomplete();
    const deps = makeDeps();
    const turns = new TurnRunner(store, deps);
    const app = createApp({ deps, store, turns, quota: createQuota({ limit: 0 }) });
    const server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    const close = async () => {
      await turns.abortAll();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    };
    cleanups.push(close);
    const res = await fetch(`http://127.0.0.1:${port}/api/cases/case-orphan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { running: boolean; events: CaseEvent[] };
    expect(body.running).toBe(false);
    const last = body.events[body.events.length - 1];
    const prev = body.events[body.events.length - 2];
    expect(last).toMatchObject({ type: "turn.finished", reason: "error" });
    expect(prev?.type).toBe("error");
    expect(String((prev as { message?: string }).message ?? "")).toContain("重启");
  });

  it("断连不中止轮次，日志以 turn.finished(done) 收口", async () => {
    const gate = deferred();
    const { base, dir, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const ac = new AbortController();
    const stream = await fetch(`${base}/api/cases/${caseId}/stream`, { signal: ac.signal });
    await readSseUntil(stream, (text) => text.includes("turn.started"));
    ac.abort();
    gate.resolve();
    await turns.wait(caseId);
    const events = await readJsonl(dir, caseId);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "done" });
  });

  it("显式 abort 后 signal.aborted，日志为 aborted，再 abort 仍 204", async () => {
    const gate = deferred();
    const seen = { aborted: false };
    const harness = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(harness.base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    await waitFor(async () => {
      try {
        const events = await readJsonl(harness.dir, caseId);
        return events.some((event) => event.type === "stage.started" && event.stage === "assess");
      } catch {
        return false;
      }
    });
    const signal = harness.turns.signal(caseId);
    expect(signal).toBeDefined();
    signal?.addEventListener("abort", () => {
      seen.aborted = true;
    });
    const first = await fetch(`${harness.base}/api/cases/${caseId}/abort`, { method: "POST" });
    expect(first.status).toBe(204);
    expect(signal?.aborted).toBe(true);
    seen.aborted = seen.aborted || signal?.aborted === true;
    gate.resolve();
    await harness.turns.wait(caseId);
    expect(seen.aborted).toBe(true);
    const events = await readJsonl(harness.dir, caseId);
    expect(events.at(-1)).toMatchObject({ type: "turn.finished", reason: "aborted" });
    const second = await fetch(`${harness.base}/api/cases/${caseId}/abort`, { method: "POST" });
    expect(second.status).toBe(204);
  });

  it("重连 since=n 从 n+1 连续补齐到 turn.finished", async () => {
    const gate = deferred();
    const { base, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const first = await fetch(`${base}/api/cases/${caseId}/stream`);
    const { buf, cancel } = await readSseUntil(first, (text) => parseSse(text).events.length >= 3);
    const seen = parseSse(buf).events;
    const since = seen[seen.length - 1]!.seq;
    await cancel();
    const replayed = await fetch(`${base}/api/cases/${caseId}/stream?since=${since}`);
    gate.resolve();
    const { buf: rest, cancel: cancel2 } = await readSseUntil(replayed, (text) =>
      text.includes("turn.finished"),
    );
    await cancel2();
    await turns.wait(caseId);
    const follow = parseSse(rest).events;
    expect(follow[0]?.seq).toBe(since + 1);
    const seqs = follow.map((event) => event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBe((seqs[i - 1] ?? 0) + 1);
    }
    expect(follow.at(-1)).toMatchObject({ type: "turn.finished" });
  });

  it("不带 since 但带 Last-Event-ID 等同 since=n", async () => {
    const gate = deferred();
    const { base, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const first = await fetch(`${base}/api/cases/${caseId}/stream`);
    const { buf, cancel } = await readSseUntil(first, (text) => parseSse(text).events.length >= 3);
    const since = parseSse(buf).events.at(-1)!.seq;
    await cancel();
    const replayed = await fetch(`${base}/api/cases/${caseId}/stream`, {
      headers: { "Last-Event-ID": String(since) },
    });
    gate.resolve();
    const { buf: rest, cancel: cancel2 } = await readSseUntil(replayed, (text) =>
      text.includes("turn.finished"),
    );
    await cancel2();
    await turns.wait(caseId);
    const follow = parseSse(rest).events;
    expect(follow[0]?.seq).toBe(since + 1);
    const seqs = follow.map((event) => event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBe((seqs[i - 1] ?? 0) + 1);
    }
  });

  it("同案第二轮在跑时 409，结束后再 POST 202", async () => {
    const gate = deferred();
    const { base, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const busy = await fetch(`${base}/api/cases/${caseId}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "那依据还在吗" }),
    });
    expect(busy.status).toBe(409);
    gate.resolve();
    await turns.wait(caseId);
    const again = await fetch(`${base}/api/cases/${caseId}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "那依据还在吗" }),
    });
    expect(again.status).toBe(202);
    const { turnId } = (await again.json()) as { turnId: string };
    expect(turnId).toBeTruthy();
    await turns.wait(caseId);
  });

  it("缩短心跳后 SSE 出现 : ping", async () => {
    const gate = deferred();
    const { base, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }), {
      heartbeatMs: 40,
    });
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const stream = await fetch(`${base}/api/cases/${caseId}/stream`);
    const { buf, cancel } = await readSseUntil(stream, (text) => text.includes(": ping"), 3_000);
    await cancel();
    gate.resolve();
    await turns.wait(caseId);
    expect(buf).toContain(": ping");
  });

  it("SSE 帧含 event/id/data，缺省 since 从 case.created 开始", async () => {
    const { base, turns } = await listen(makeDeps());
    const created = await postCase(base, TEXT);
    const { caseId } = (await created.json()) as { caseId: string };
    const stream = await fetch(`${base}/api/cases/${caseId}/stream`);
    const { buf, cancel } = await readSseUntil(stream, (text) => text.includes("turn.finished"));
    await cancel();
    await turns.wait(caseId);
    const parsed = parseSse(buf);
    expect(parsed.events[0]).toMatchObject({ type: "case.created" });
    for (const event of parsed.events) {
      expect(() => validateEvent(event)).not.toThrow();
    }
    expect(parsed.ids[0]).toBe(1);
    expect(parsed.ids).toEqual(parsed.events.map((event) => event.seq));
  });

  it("POST /api/cases 返回 202 且首轮 running 或已有 turn.started", async () => {
    const gate = deferred();
    const { base, turns } = await listen(makeDeps({ llm: hangingLlm(gate.promise) }));
    const created = await postCase(base, TEXT);
    expect(created.status).toBe(202);
    const body = (await created.json()) as { caseId: string; turnId: string };
    expect(body.caseId).toBeTruthy();
    expect(body.turnId).toBe("t1");
    const got = await fetch(`${base}/api/cases/${body.caseId}`);
    const snapshot = (await got.json()) as { running: boolean; events: CaseEvent[] };
    expect(snapshot.running === true || snapshot.events.some((event) => event.type === "turn.started")).toBe(
      true,
    );
    gate.resolve();
    await turns.wait(body.caseId);
  });

  it("未知 id 的 GET / stream / turns / abort 都 404；空 text 与非 JSON 400", async () => {
    const { base } = await listen(makeDeps());
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await fetch(`${base}/api/cases/${missing}`)).status).toBe(404);
    expect((await fetch(`${base}/api/cases/${missing}/stream`)).status).toBe(404);
    expect(
      (
        await fetch(`${base}/api/cases/${missing}/turns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: TEXT }),
        })
      ).status,
    ).toBe(404);
    expect((await fetch(`${base}/api/cases/${missing}/abort`, { method: "POST" })).status).toBe(404);
    expect((await postCase(base, "")).status).toBe(400);
    expect((await postCase(base, "   ")).status).toBe(400);
    const bad = await fetch(`${base}/api/cases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(bad.status).toBe(400);
    const long = "字".repeat(4001);
    expect((await postCase(base, long)).status).toBe(400);
  });

  it("日配额 2 时第 3 次 POST 429，文案不含请勿/谣言；0 不拦", async () => {
    const { base, turns } = await listen(makeDeps(), { quotaLimit: 2 });
    const a = await postCase(base, TEXT);
    const b = await postCase(base, `${TEXT}二`);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const c = await postCase(base, `${TEXT}三`);
    expect(c.status).toBe(429);
    const msg = ((await c.json()) as { error: string }).error;
    expect(msg).toBe(QUOTA_EXCEEDED);
    expect(msg).not.toMatch(/请勿|谣言/);
    const idA = ((await a.json()) as { caseId: string }).caseId;
    const idB = ((await b.json()) as { caseId: string }).caseId;
    await turns.wait(idA);
    await turns.wait(idB);

    const open = await listen(makeDeps(), { quotaLimit: 0 });
    const x = await postCase(open.base, TEXT);
    const y = await postCase(open.base, `${TEXT}二`);
    const z = await postCase(open.base, `${TEXT}三`);
    expect(x.status).toBe(202);
    expect(y.status).toBe(202);
    expect(z.status).toBe(202);
    await open.turns.wait(((await x.json()) as { caseId: string }).caseId);
    await open.turns.wait(((await y.json()) as { caseId: string }).caseId);
    await open.turns.wait(((await z.json()) as { caseId: string }).caseId);
  });

  it("GET /api/cases 按 updatedAt 降序", async () => {
    const { base, turns } = await listen(makeDeps({ now: () => new Date().toISOString() }));
    const first = await postCase(base, TEXT);
    const { caseId: a } = (await first.json()) as { caseId: string };
    await turns.wait(a);
    const second = await postCase(base, `${TEXT}后续`);
    const { caseId: b } = (await second.json()) as { caseId: string };
    await turns.wait(b);
    const list = (await (await fetch(`${base}/api/cases`)).json()) as Array<{ caseId: string }>;
    expect(list[0]?.caseId).toBe(b);
    expect(list.map((item) => item.caseId)).toContain(a);
  });

  it("立案材料不够核时不检索，补充后同一案继续且原文仍在", async () => {
    let searches = 0;
    const search: SearchProviderFn = async () => {
      searches += 1;
      return [{ url: "https://www.gov.cn/zhengce/allowance", title: "通报", snippet: SNIPPET }];
    };
    const llm = createFakeLlm({
      ...script(),
      qualify: [
        { ready: false, reason: "no_claim", gap: "" },
        readyQualify(TEXT),
      ],
    });
    const { base, turns } = await listen({
      llm,
      searchProviders: [search],
      tools: { search: async () => [], fetch: idleFetch() },
      now: () => AT,
    });
    const firstText = "帮我看一下";
    const created = await postCase(base, firstText);
    const { caseId } = (await created.json()) as { caseId: string };
    await turns.wait(caseId);
    expect(searches).toBe(0);
    const first = (await (await fetch(`${base}/api/cases/${caseId}`)).json()) as {
      case: {
        text: string;
        claims: unknown[];
        report?: unknown;
        messages: Array<{ role: string; text: string }>;
      };
      events: CaseEvent[];
    };
    expect(first.case.claims).toEqual([]);
    expect(first.case.report).toBeUndefined();
    expect(first.case.messages.some((message) => message.role === "assistant" && message.text.length > 0)).toBe(
      true,
    );
    expect(first.events.some((event) => event.type === "stage.started" && event.stage === "retrieve")).toBe(
      false,
    );

    const follow = await fetch(`${base}/api/cases/${caseId}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: TEXT }),
    });
    expect(follow.status).toBe(202);
    await turns.wait(caseId);
    expect(searches).toBeGreaterThan(0);
    const second = (await (await fetch(`${base}/api/cases/${caseId}`)).json()) as {
      case: { id: string; text: string; messages: Array<{ role: string; text: string }> };
    };
    expect(second.case.id).toBe(caseId);
    expect(second.case.text).toBe(firstText);
    expect(second.case.messages.filter((message) => message.role === "user").map((message) => message.text)).toEqual(
      [firstText, TEXT],
    );
  });
});
