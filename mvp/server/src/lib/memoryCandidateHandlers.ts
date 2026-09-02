/**
 * memoryCandidateHandlers — Express handlers for /api/agent/memory-candidates
 *
 * Mirrors vite.config.ts memoryCandidatesHandler:
 *   GET  → { candidates }
 *   POST { action:"setStatus", id, status, reason? } → { candidate }
 */

import type { Request, Response } from "express";
import { JsonlMemoryCandidateStore, type MemoryCandidateStore } from "./memoryCandidateStore.js";
import type { MemoryCandidateStatus } from "./memoryCandidateTypes.js";

const VALID_STATUSES: MemoryCandidateStatus[] = ["accepted", "rejected", "proposed"];

/** Default process-wide store (same path as Vite / AgentRuntime). Injectable for tests. */
let defaultStore: MemoryCandidateStore = new JsonlMemoryCandidateStore();

export function setMemoryCandidateStoreForTests(store: MemoryCandidateStore): void {
  defaultStore = store;
}

export function getMemoryCandidateStore(): MemoryCandidateStore {
  return defaultStore;
}

interface SetStatusBody {
  action?: string;
  id?: string;
  status?: string;
  reason?: string;
}

/**
 * POST /api/agent/memory-candidates — currently only action "setStatus".
 */
export async function updateMemoryCandidateHandler(req: Request, res: Response): Promise<void> {
  const payload = (req.body ?? {}) as SetStatusBody;

  if (payload.action !== "setStatus") {
    res.status(400).json({ message: "未知 memory candidate 操作" });
    return;
  }

  if (!payload.id || !VALID_STATUSES.includes(payload.status as MemoryCandidateStatus)) {
    res.status(400).json({ message: "缺少候选 ID 或状态非法" });
    return;
  }

  try {
    const candidate = await defaultStore.setStatus(
      String(payload.id),
      payload.status as MemoryCandidateStatus,
      typeof payload.reason === "string" ? payload.reason : undefined,
    );
    if (!candidate) {
      res.status(404).json({ message: "未找到 memory candidate" });
      return;
    }
    res.status(200).json({ candidate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memory candidate 更新失败";
    res.status(500).json({ message });
  }
}
