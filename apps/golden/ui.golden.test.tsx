/**
 * 界面 golden：把服务端 golden 录下的 SSE 帧按原顺序一帧一帧喂给真实的 <App/>，每收到一帧客户端会消费的帧
 * 就把整个 DOM 序列化一次；结束后再记下 localStorage 与客户端发出的请求。
 *
 * 默认跳过。显式开启：
 *   GOLDEN_UI=record GOLDEN_FRAMES=<服务端回放标签> GOLDEN_UI_LABEL=<界面标签> npx vitest run golden/ui.golden.test.tsx
 *   GOLDEN_UI=compare GOLDEN_FRAMES=<同上> GOLDEN_UI_LABEL=<新标签> GOLDEN_UI_BASE=<基线标签> npx vitest run golden/ui.golden.test.tsx
 * 输入帧来自 outputs/golden/runs/<GOLDEN_FRAMES>/<场景>/raw.json；结果写 outputs/golden/ui/<GOLDEN_UI_LABEL>/<场景>.json。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionGlobalConfig } from "framer-motion";
import App from "../src/App";

// 动效一律直接落到终值：逐帧 DOM 记录的是每一拍稳定后的界面，不是动画进行到一半的内联样式。
MotionGlobalConfig.skipAnimations = true;

type Frame = Record<string, unknown>;
type Step = { label: string; request: { method: string; path: string; body?: unknown }; status?: number; body?: unknown; frames?: Frame[] };

const MODE = process.env.GOLDEN_UI ?? "";
const FRAMES_LABEL = process.env.GOLDEN_FRAMES ?? "";
const UI_LABEL = process.env.GOLDEN_UI_LABEL ?? "";
const BASE_LABEL = process.env.GOLDEN_UI_BASE ?? "";
const OUT = resolve(process.cwd(), "..", "outputs", "golden");
const CONSUMED = new Set(["run_started", "run_state", "investigation_snapshot", "investigation_activity", "timeout_pending", "complete", "error"]);

/** 纯文字首轮场景：界面上只需要在输入框里键入说法再点开始。 */
const UI_SCENARIOS = ["g01-mixed", "g02-debunk", "g03-causal", "g04-stance", "g05-unverified", "g06-link-failed", "g13-all-down", "g15-search-down"];

function loadSteps(scenario: string): Step[] | null {
  const file = join(OUT, "runs", FRAMES_LABEL, scenario, "raw.json");
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, "utf8")) as { steps: Step[] }).steps;
}

const VOLATILE_ATTRS = /^(id|for|aria-labelledby|aria-describedby|aria-controls|aria-owns)$/;

/** DOM → 稳定文本：标签、属性（React useId 生成的值换占位）、文字；空白折叠。 */
function serialize(node: Node, depth = 0, out: string[] = []): string[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(`${"  ".repeat(depth)}"${normalizeText(text)}"`);
    return out;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return out;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style") return out;
  const attrs = [...el.attributes]
    .map((attr) => {
      const value = VOLATILE_ATTRS.test(attr.name) ? attr.value.replace(/[«:][^»:\s]*[»:]/g, "<rid>") : normalizeText(attr.value);
      return `${attr.name}="${value}"`;
    })
    .sort()
    .join(" ");
  out.push(`${"  ".repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ""}>`);
  for (const child of el.childNodes) serialize(child, depth + 1, out);
  return out;
}

function todayForms(): string[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return [`${y}-${pad(m)}-${pad(d)}`, `${y}/${m}/${d}`, `${y}/${pad(m)}/${pad(d)}`, `${y}年${m}月${d}日`];
}
const TODAY = todayForms();

function normalizeText(text: string): string {
  let out = text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<iso>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/(?<!\d)1[6-9]\d{11}(?!\d)/g, "<epoch>")
    // 本机案件 id：`case-${Date.now()}-${随机 6 位}`（App.beginRun）。
    .replace(/case-<epoch>-[a-z0-9]+/g, "case-<local>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "<clock>")
    .replace(/已等\s*\d+\s*秒/g, "已等<n>秒")
    .replace(/\d+\s*秒/g, "<n>秒");
  for (const form of TODAY) out = out.split(form).join("<today>");
  return out;
}

function normalizeJson(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = normalizeJson((value as Record<string, unknown>)[k], k);
    return out;
  }
  if (["timestamp", "createdAt", "at", "updatedAt", "scrapedAt", "checkedAt", "occurredAt", "retrievedAt"].includes(key) && value !== undefined && value !== null && value !== "") return "<time>";
  if (typeof value === "string") return normalizeText(value);
  return value;
}

function localStorageSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)!;
    const raw = window.localStorage.getItem(key) ?? "";
    try {
      out[key] = normalizeJson(JSON.parse(raw));
    } catch {
      out[key] = normalizeText(raw);
    }
  }
  return normalizeJson(out) as Record<string, unknown>;
}

/**
 * 假时钟：界面里有按时间走的东西（等待秒数、入场标记、对勾出现），用真实时间逐帧截 DOM，
 * 同一串帧两次截出来会差一拍。整个场景从渲染前就用假时钟，每喂一帧固定推进 STEP_MS，
 * 定时器、动画帧、Date 都按这个节拍走，结果只取决于帧序列。
 */
const FIXED_NOW = new Date("2026-09-29T02:00:00.000Z");
const STEP_MS = 40;

async function flush() {
  await vi.advanceTimersByTimeAsync(STEP_MS);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function runUiScenario(scenario: string, steps: Step[]) {
  const runStep = steps.find((step) => step.label === "run");
  if (!runStep?.frames) throw new Error(`${scenario} 没有 run 帧`);
  const probe = (label: string) => steps.find((step) => step.label === label);
  const frames = runStep.frames;
  const requests: unknown[] = [];

  let grant: (() => void) | null = null;
  let permit = new Promise<void>((r) => (grant = r));
  const allowNext = () => {
    const current = grant;
    permit = new Promise<void>((r) => (grant = r));
    current?.();
  };
  let sent = 0;
  const encoder = new TextEncoder();

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push(normalizeJson({ method, url, body }));
    if (url.includes("/api/models/health")) return jsonResponse(probe("probe:health")?.body ?? { status: "available" });
    // 场景没跑首页探针时给一份非空模型列表：列表为空会让输入页直接拦下提交，后面的帧就喂了个寂寞。
    if (url.includes("/api/models/list")) return jsonResponse(probe("probe:models")?.body ?? { models: [{ provider: "minimax", model: "MiniMax-M2.7-highspeed", label: "MiniMax", tier: "fast" }] });
    if (url.includes("/api/checks/quota")) return jsonResponse(probe("probe:quota")?.body ?? { enforced: false, kind: "guest", remaining: 2, total: 2, used: 0 });
    if (url.includes("/api/auth/email/me")) return jsonResponse({ error: "Not authenticated" }, 401);
    if (url.endsWith("/api/cases")) return jsonResponse({ cases: [] });
    if (url.includes("r.jina.ai")) return new Response("forbidden", { status: 403 });
    if (url.includes("/api/agent/orchestrate-stream")) {
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await permit;
          if (sent >= frames.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frames[sent])}\n\n`));
          sent += 1;
        },
      });
      return new Response(stream, { status: runStep.status ?? 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("not-found", { status: 404 });
  });

  render(<App />);
  let editor: HTMLElement | null = null;
  for (let wait = 0; wait < 200 && !editor; wait += 1) {
    await act(async () => {
      await flush();
    });
    editor = screen.queryByRole("textbox", { name: "要调查的说法" });
  }
  if (!editor) throw new Error(`${scenario}：输入框没有出现`);
  const request = runStep.request.body as { intake?: { text?: string } };
  editor.textContent = request.intake?.text ?? "";
  fireEvent.input(editor);
  await act(async () => {
    await flush();
  });
  const states: Array<{ frame: number; type: string; dom: string }> = [];
  const home = serialize(document.body).join("\n");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /开始调查/ }));
    await flush();
  });
  // 链接场景：浏览器端抓取完才会发调查请求。
  for (let wait = 0; wait < 50 && !requests.some((r) => JSON.stringify(r).includes("orchestrate-stream")); wait += 1) {
    await act(async () => {
      await flush();
    });
  }
  if (!requests.some((r) => JSON.stringify(r).includes("orchestrate-stream"))) {
    throw new Error(`${scenario}：界面没有发出调查请求（提交被拦下了），逐帧记录没有意义`);
  }
  let previous = "";
  for (let i = 0; i <= frames.length; i += 1) {
    await act(async () => {
      allowNext();
      await flush();
    });
    const frame = frames[i];
    if (frame && !CONSUMED.has(String(frame.type))) continue;
    const dom = serialize(document.body).join("\n");
    states.push({ frame: i, type: frame ? String(frame.type) : "<end>", dom: dom === previous ? "<same>" : dom });
    previous = dom;
  }
  return { home, states, localStorage: localStorageSnapshot(), requests };
}

const describeGolden = MODE ? describe : describe.skip;

describeGolden("界面 golden（按录下的 SSE 帧重放真实 App）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
    vi.useFakeTimers({
      now: FIXED_NOW,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const scenario of UI_SCENARIOS) {
    it(scenario, async () => {
      const steps = loadSteps(scenario);
      if (!steps) {
        console.warn(`跳过 ${scenario}：没有 ${FRAMES_LABEL} 的服务端回放`);
        return;
      }
      const result = await runUiScenario(scenario, steps);
      const dir = join(OUT, "ui", UI_LABEL || "unlabeled");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${scenario}.json`), JSON.stringify(result, null, 2));
      if (MODE === "compare") {
        const baseFile = join(OUT, "ui", BASE_LABEL, `${scenario}.json`);
        expect(existsSync(baseFile), `缺少基线 ${baseFile}`).toBe(true);
        const base = JSON.parse(readFileSync(baseFile, "utf8"));
        expect(result.home).toBe(base.home);
        expect(result.states.length).toBe(base.states.length);
        // 「<same>」只是存储上的省略：比对前还原成完整 DOM，避免只因省略位置不同而误报。
        const resolve = (states: Array<{ dom: string }>, i: number) => {
          for (let k = i; k >= 0; k -= 1) if (states[k]!.dom !== "<same>") return states[k]!.dom;
          return "";
        };
        for (let i = 0; i < base.states.length; i += 1) {
          expect(`${result.states[i]!.frame}:${result.states[i]!.type}`).toBe(`${base.states[i].frame}:${base.states[i].type}`);
          expect(resolve(result.states, i), `${scenario} 第 ${i} 个状态（帧 ${base.states[i].frame} ${base.states[i].type}）`).toBe(resolve(base.states, i));
        }
        expect(result.localStorage).toEqual(base.localStorage);
        expect(result.requests).toEqual(base.requests);
      }
    }, 120_000);
  }
});
