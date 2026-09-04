import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import {
  createCase,
  listSearchProviders,
  parseUserSearchKeys,
  replay,
  type RunTurnDeps,
} from "@rhg/core";
import { QUOTA_EXCEEDED, TURN_IN_PROGRESS } from "./copy.js";
import { toPublicEvent } from "./publicEvent.js";
import type { Quota } from "./quota.js";
import { attachCaseStream, prepareSseHeaders } from "./sse.js";
import type { CaseStore } from "./store.js";
import { ConflictError, NotFoundError, type TurnMessage, type TurnRunner } from "./turns.js";

export const DEFAULT_PORT = 3100;
const TEXT_MAX = 4000;

export type CreateAppOptions = {
  deps: RunTurnDeps;
  store: CaseStore;
  turns: TurnRunner;
  quota: Quota;
  heartbeatMs?: number;
  operatorEnv?: Record<string, string>;
  withSearchEnv?: (overlay: Record<string, string>) => RunTurnDeps;
};

type ParsedBody =
  | { ok: true; message: TurnMessage }
  | { ok: false; error: string };

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAttachments(raw: unknown): TurnMessage["attachments"] | "bad" {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return "bad";
  const out: NonNullable<TurnMessage["attachments"]> = [];
  for (const item of raw) {
    if (!isRecord(item)) return "bad";
    if (item.kind !== "url" && item.kind !== "image") return "bad";
    if (typeof item.value !== "string" || item.value.length === 0) return "bad";
    out.push({ kind: item.kind, value: item.value });
  }
  return out.length > 0 ? out : undefined;
}

function parseBody(body: unknown): ParsedBody {
  if (!isRecord(body)) return { ok: false, error: "请求体无效" };
  if (typeof body.text !== "string") return { ok: false, error: "请求体无效" };
  const text = body.text;
  if (text.trim().length === 0 || [...text].length > TEXT_MAX) {
    return { ok: false, error: "文本无效" };
  }
  const attachments = parseAttachments(body.attachments);
  if (attachments === "bad") return { ok: false, error: "请求体无效" };
  const pivotId = body.pivotId;
  if (pivotId !== undefined && typeof pivotId !== "string") {
    return { ok: false, error: "请求体无效" };
  }
  return {
    ok: true,
    message: {
      text,
      ...(attachments ? { attachments } : {}),
      ...(typeof pivotId === "string" && pivotId.length > 0 ? { pivotId } : {}),
    },
  };
}

function parseSeq(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function sinceOf(req: Request): number {
  const fromQuery = parseSeq(req.query.since);
  if (fromQuery !== undefined) return fromQuery;
  return parseSeq(req.get("Last-Event-ID")) ?? 0;
}

async function requireCase(store: CaseStore, id: string, res: Response): Promise<boolean> {
  const loaded = await store.load(id);
  if (loaded !== null) return true;
  res.status(404).json({ error: "not found" });
  return false;
}

function searchKeysOf(body: unknown): Record<string, string> {
  if (!isRecord(body)) return {};
  return parseUserSearchKeys(body.searchKeys);
}

function depsForRequest(opts: CreateAppOptions, body: unknown): RunTurnDeps | undefined {
  const overlay = searchKeysOf(body);
  if (Object.keys(overlay).length === 0 || !opts.withSearchEnv) return undefined;
  const merged = { ...(opts.operatorEnv ?? {}), ...overlay };
  return opts.withSearchEnv(merged);
}

export function createApp(opts: CreateAppOptions) {
  const { store, turns, quota } = opts;
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/search-providers", (_req, res) => {
    res.json({ providers: listSearchProviders(opts.operatorEnv ?? {}) });
  });

  app.post("/api/cases", async (req, res) => {
    if (!quota.allow(clientIp(req))) {
      res.status(429).json({ error: QUOTA_EXCEEDED });
      return;
    }
    const parsed = parseBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const caseId = randomUUID();
    const created = createCase({ id: caseId, text: parsed.message.text });
    await store.append(caseId, created.events);
    const { turnId } = await turns.start(caseId, parsed.message, depsForRequest(opts, req.body));
    res.status(202).json({ caseId, turnId });
  });

  app.post("/api/cases/:id/turns", async (req, res) => {
    if (!quota.allow(clientIp(req))) {
      res.status(429).json({ error: QUOTA_EXCEEDED });
      return;
    }
    const { id } = req.params;
    if (!(await requireCase(store, id, res))) return;
    const parsed = parseBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const { turnId } = await turns.start(id, parsed.message, depsForRequest(opts, req.body));
      res.status(202).json({ turnId });
    } catch (error) {
      if (error instanceof ConflictError) {
        res.status(409).json({ error: TURN_IN_PROGRESS });
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: "not found" });
        return;
      }
      throw error;
    }
  });

  app.post("/api/cases/:id/abort", async (req, res) => {
    if (!(await requireCase(store, req.params.id, res))) return;
    turns.abort(req.params.id);
    res.status(204).end();
  });

  app.get("/api/cases/:id/stream", async (req, res) => {
    const { id } = req.params;
    if (!(await requireCase(store, id, res))) return;
    prepareSseHeaders(res);
    await attachCaseStream({
      res,
      caseId: id,
      since: sinceOf(req),
      store,
      turns,
      ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}),
    });
  });

  app.get("/api/cases/:id", async (req, res) => {
    const loaded = await store.load(req.params.id);
    if (loaded === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const events = loaded.map(toPublicEvent);
    res.json({
      case: replay(events),
      events,
      running: turns.isRunning(req.params.id),
    });
  });

  app.get("/api/cases", async (_req, res) => {
    res.json(await store.list());
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    const status = typeof err === "object" && err && "status" in err ? Number(err.status) : 0;
    if (err instanceof SyntaxError || status === 400) {
      res.status(400).json({ error: "请求体无效" });
      return;
    }
    next(err);
  };
  app.use(onError);

  return app;
}
