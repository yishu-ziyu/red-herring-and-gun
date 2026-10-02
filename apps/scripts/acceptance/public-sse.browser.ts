import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const express = createRequire(resolve("server/package.json"))("express");
import { describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rhg-browser-"));
  process.env.RHG_DB_FILE = path.join(process.env.DATA_DIR, "rhg.sqlite");
  process.env.AIPING_SESSION_SECRET = "synthetic-browser-acceptance-secret";
  return { service: null as any, gate: null as any, calls: 0 };
});
vi.mock("../../server/src/lib/runService.js", async (original) => {
  const mod = await original<typeof import("../../server/src/lib/runService.js")>();
  return { ...mod, createRunService: (options: any) => (fixture.service = mod.createRunService(options)) };
});
vi.mock("../../server/src/lib/casePipeline/index.js", () => ({ runCasePipeline: vi.fn(() => {
  fixture.calls++; return new Promise(resolve => { fixture.gate = { resolve }; });
}) }));
vi.mock("../../server/src/lib/modelServiceHealth.js", async (original) => ({
  ...await original<typeof import("../../server/src/lib/modelServiceHealth.js")>(),
  probeModelServiceHealth: async () => ({ status: "available", message: "synthetic provider health" }),
}));
import { createHandlers } from "../../server/src/handlers.js";
import { openRunStore } from "../../server/src/lib/runStore.js";
import { buildInvestigationSnapshot } from "../../server/src/lib/investigation/index.js";
import { quotaGate } from "../../server/src/lib/quotaPolicy.js";
import { checksQuotaHandler } from "../../server/src/lib/checkQuota.js";
import { emailMeHandler } from "../../server/src/lib/emailAuthHandlers.js";
import { listCasesHandler, postCaseHandler } from "../../server/src/lib/caseHandlers.js";
const claim = "这条测试说法尚缺可靠材料。", conclusion = "现有资料不足以确认这条说法。";
const frames = (wire: string) => wire.split("\n").slice(0, -1).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));

describe("Chromium production UI public SSE", () => {
  it("submits from UI, refreshes to resume, repeats POST without leaking or rerunning", async () => {
    const out = resolve(process.env.RHG_BROWSER_OUT || "../out/public-sse-browser/current"); mkdirSync(out, { recursive: true });
    const modulePath = process.env.RHG_PLAYWRIGHT_MODULE || resolve("scripts/acceptance/browser-tools/node_modules/playwright/index.mjs");
    const { chromium } = await import(pathToFileURL(modulePath).href);
    const handlers = createHandlers({ MINIMAX_API_KEY: "synthetic-browser-key", ORCHESTRATE_TOTAL_TIMEOUT_MS: "45000" });
    const app = express(); app.use(express.json());
    const bodies: any[] = []; let resumes = 0;
    app.get("/api/auth/email/me", (q, s, n) => emailMeHandler(q, s).catch(n));
    app.get("/api/cases", (q, s) => listCasesHandler(q, s));
    app.post("/api/case", (q, s, n) => postCaseHandler(q, s).catch(n));
    app.get("/api/checks/quota", (q, s, n) => checksQuotaHandler(q, s).catch(n));
    app.get("/api/models/list", (q, s, n) => handlers.modelsListHandler(q, s, n));
    app.get("/api/models/health", (q, s, n) => handlers.modelsHealthHandler(q, s, n));
    app.post("/api/agent/orchestrate-stream", quotaGate("/api/agent/orchestrate-stream"), (q, s, n) => {
      bodies.push(structuredClone(q.body)); void handlers.orchestrateStreamHandler(q, s, n);
    });
    app.get("/api/investigations/:runId/events", (q, s, n) => { resumes++; void handlers.investigationEventsHandler(q, s, n); });
    app.use(express.static(resolve("dist")));
    const server = createServer(app), records = new Map<string, any>();
    let browser: any, page: any, failure: unknown;
    try {
      await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
      const address = server.address(); if (!address || typeof address === "string") throw new Error("missing TCP address");
      browser = await chromium.launch({ headless: true, ...(process.env.RHG_CHROME ? { executablePath: process.env.RHG_CHROME } : {}) });
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.exposeFunction("__captureSse", (event: any) => {
        if (event.start) records.set(event.id, { ...event, wire: "", eof: false });
        const record = records.get(event.id);
        if (record) { record.wire += event.chunk || ""; record.eof ||= Boolean(event.eof); record.aborted ||= Boolean(event.aborted); }
      });
      // Passive clone: leave original fetch response and production SSE parser untouched.
      await page.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const response = await original(...args);
          if (response.headers.get("content-type")?.includes("text/event-stream")) {
            const id = crypto.randomUUID(), clone = response.clone();
            const report = (event: any) => (window as any).__captureSse({ id, ...event });
            void (async () => {
              await report({ start: true, method: args[1]?.method || "GET", url: String(args[0]), status: response.status, contentType: response.headers.get("content-type") });
              try {
                const reader = clone.body!.getReader(), decoder = new TextDecoder();
                for (;;) { const part = await reader.read(); if (part.done) break; await report({ chunk: decoder.decode(part.value, { stream: true }) }); }
                await report({ chunk: decoder.decode(), eof: true });
              } catch { await report({ aborted: true }); }
            })();
          }
          return response;
        };
      });
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByRole("textbox", { name: "要调查的说法" }).fill(claim);
      await page.getByRole("button", { name: "开始调查", exact: true }).click();
      await vi.waitFor(() => expect(fixture.gate).not.toBeNull(), { timeout: 10000 });
      await page.waitForFunction(() => Boolean(localStorage.getItem("rhg:active-run")));
      const pointer = await page.evaluate(() => JSON.parse(localStorage.getItem("rhg:active-run")!)), runId = pointer.runId;
      const internal = { systemPrompt: "INTERNAL_BROWSER_PROMPT", userContent: "INTERNAL_BROWSER_INPUT", model: "minimax:browser", latencyMs: 20 };
      const build = (phase: "judging" | "complete") => buildInvestigationSnapshot({ originalClaim: claim, phase, claimAtoms: [claim], claimAtomTypes: [{ text: claim, verifiable: true, type: "fact" }], ...(phase === "complete" ? { report: { conclusion, verdictType: "unverified" } } : {}) }, { claimAtomKeyFn: text => text.trim() });
      const snapshot = build("judging");
      openRunStore()!.appendActivities(runId, [{ id: "browser-activity", seq: 1, kind: "search_started", createdAt: 1, text: "公开浏览器活动", timestamp: 1, ...internal }] as any);
      openRunStore()!.saveSnapshot(runId, { ...snapshot, ...internal } as any);
      fixture.service.publish(runId, { type: "investigation_snapshot", investigation: { ...snapshot, ...internal }, timestamp: Date.now() });
      const publish = () => {
        fixture.service.publish(runId, { type: "agent_complete", output: { conclusion, ...internal }, ...internal });
        fixture.service.publish(runId, { type: "tool_error", error: "RAW_BROWSER_ERROR", detail: "RAW_BROWSER_DETAIL", result: { _source: "tool-error", traceText: "RAW_BROWSER_TRACE" } });
        let deep: any = internal; for (let i = 0; i < 12; i++) deep = { nested: [deep] };
        fixture.service.publish(runId, { type: "tool_result", result: deep });
      };
      publish();
      await vi.waitFor(() => expect([...records.values()].find(r => r.method === "POST")?.wire).toContain("tool_result"));
      await page.screenshot({ path: resolve(out, "initial.png"), fullPage: true });
      await page.reload();
      await vi.waitFor(() => expect(resumes).toBe(1), { timeout: 10000 });
      await vi.waitFor(() => expect([...records.values()].find(r => r.method === "GET")?.wire).toContain("公开浏览器活动"));
      // Chromium network retry using the exact body sent by the real UI.
      await page.evaluate((body: any) => { (window as any).__duplicate = fetch("/api/agent/orchestrate-stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.text()); }, bodies[0]);
      await vi.waitFor(() => expect(bodies).toHaveLength(2));
      await vi.waitFor(() => expect([...records.values()].filter(r => r.method === "POST")).toHaveLength(2));
      publish();
      fixture.gate.resolve({ steps: [], finalReport: { claim, verdictType: "unverified", conclusion, investigation: build("complete") }, atomSearchBundle: { atomsSearched: [], byAtomKey: {}, aggregate: { sources: [] } }, search360Result: {}, memoryCandidates: [] });
      await page.evaluate(() => (window as any).__duplicate);
      await vi.waitFor(() => expect([...records.values()].filter(r => r.eof)).toHaveLength(2), { timeout: 10000 });
      expect(fixture.calls).toBe(1); expect(bodies[1]).toEqual(bodies[0]);
      const streams = [...records.values()]; expect(streams).toHaveLength(3);
      for (const [index, stream] of streams.entries()) {
        expect.soft(stream.status).toBe(200); expect.soft(stream.contentType).toContain("text/event-stream");
        expect.soft(stream.wire, `stream ${index} ${stream.method}`).not.toMatch(/INTERNAL_BROWSER_|RAW_BROWSER_|systemPrompt|userContent|latencyMs|minimax:browser/);
        expect.soft(frames(stream.wire).find(f => f.type === "run_started")?.runId).toBe(runId);
        expect.soft(frames(stream.wire).some(f => f.type === "tool_result")).toBe(true);
        expect.soft(frames(stream.wire).find(f => f.type === "tool_error")?.error).toBe("这一步没能完成，核查会按现有材料继续");
        if (index > 0) {
          expect.soft(stream.wire).toContain("公开浏览器活动"); expect.soft(stream.eof).toBe(true);
          expect.soft(frames(stream.wire).find(f => f.type === "investigation_activity")?.activity.seq).toBe(1);
          expect.soft(frames(stream.wire).find(f => f.type === "complete")?.finalReport.verdictType).toBe("unverified");
          expect.soft(stream.wire).toContain(conclusion);
        }
      }
      // Soft assertions collect all three old-path failures; never write PASS evidence after a wire violation.
      const violations = streams.flatMap((stream, index) => {
        const events = frames(stream.wire);
        const errors: string[] = [];
        if (/INTERNAL_BROWSER_|RAW_BROWSER_|systemPrompt|userContent|latencyMs|minimax:browser/.test(stream.wire)) errors.push(`stream ${index} leaked`);
        if (stream.status !== 200 || !stream.contentType.includes("text/event-stream")) errors.push(`stream ${index} HTTP contract`);
        if (events.find(f => f.type === "run_started")?.runId !== runId) errors.push(`stream ${index} run identity`);
        if (!events.some(f => f.type === "tool_result") || events.find(f => f.type === "tool_error")?.error !== "这一步没能完成，核查会按现有材料继续") errors.push(`stream ${index} diagnostics`);
        if (index > 0 && (!stream.eof || events.find(f => f.type === "complete")?.finalReport.verdictType !== "unverified" || events.find(f => f.type === "investigation_activity")?.activity.seq !== 1 || !stream.wire.includes(conclusion))) errors.push(`stream ${index} public terminal`);
        return errors;
      });
      if (violations.length) throw new Error(violations.join("; "));
      await page.getByText(conclusion, { exact: true }).first().waitFor();
      const box = await page.getByText(conclusion, { exact: true }).first().boundingBox();
      expect(box?.height).toBeGreaterThan(0); expect(box?.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(900);
      await page.screenshot({ path: resolve(out, "complete.png"), fullPage: true });
      writeFileSync(resolve(out, "result.json"), JSON.stringify({ status: "PASS", commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(), browserVersion: browser.version(), pipelineCalls: fixture.calls, resumes, verdict: "unverified", conclusionBox: box, streams: streams.map(s => ({ ...s, frameCount: frames(s.wire).length })) }, null, 2));
    } catch (error) {
      failure = error;
      if (page) await page.screenshot({ path: resolve(out, "failure.png"), fullPage: true }).catch(() => {});
      writeFileSync(resolve(out, "failure.json"), JSON.stringify({ status: "FAIL", error: String(error), pipelineCalls: fixture.calls, streams: [...records.values()] }, null, 2));
    } finally {
      fixture.gate?.resolve({ steps: [], finalReport: null }); if (browser) await browser.close();
      server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
    }
    if (failure) throw failure;
  });
});
