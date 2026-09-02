/**
 * userFeedback.ts — 用户纠错反馈（通用 + case 反馈两份通道的落盘）。
 *
 * 产品信任闭环：判断可能错 → 用户把异议留下 → 反馈进 golden 反向采集，
 * 让真实错例进入评测集，而不是只靠开发者手工维护 golden。
 * 落盘到 RHG_DATA_DIR 的 JSONL；进程内日志，不接外部 DB。
 */
import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface FeedbackRecord {
  kind: "case" | "general";
  claim: string;
  verdictType?: string;
  score?: number;
  reason: string;
  createdAt: number;
}

export function feedbackLogPath(env: Record<string, string>): string {
  return join(env.RHG_DATA_DIR || tmpdir(), "rhg-feedback.jsonl");
}

/**
 * 追加一条用户纠错反馈。写盘失败不阻断请求（反馈是弱通道，不能因它 500）。
 */
export async function appendUserFeedback(
  env: Record<string, string>,
  record: Omit<FeedbackRecord, "createdAt">
): Promise<void> {
  const dir = feedbackLogPath(env).replace(/[^/]+$/, "");
  try {
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ...record, createdAt: Date.now() }) + "\n";
    await appendFile(feedbackLogPath(env), line, "utf8");
  } catch {
    /* 反馈写盘失败静默：不影响主结论展示 */
  }
}