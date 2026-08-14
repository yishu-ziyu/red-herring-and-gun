/** 免费核查：未登录每天 1 条，登录后每天 3 条。按完成的核查计，不按 Token。 */

export const GUEST_DAILY_CHECKS = 1;
export const ACCOUNT_DAILY_CHECKS = 3;

export type CheckQuotaKind = "guest" | "account";

export type CheckQuotaView = {
  remaining: number;
  total: number;
  used: number;
  kind: CheckQuotaKind;
  /** false：开发环境不执行额度，界面也不挡核查 */
  enforced: boolean;
};

export function checksExhaustedMessage(kind: CheckQuotaKind): string {
  return kind === "guest"
    ? "今天的免费核查用完了。登录后每天可查 3 条。"
    : "今天的 3 条免费核查用完了。明天再来。";
}

export function checksRemainingMessage(view: CheckQuotaView): string {
  if (!view.enforced) return "";
  if (view.remaining <= 0) return checksExhaustedMessage(view.kind);
  if (view.kind === "guest") {
    return view.remaining === 1 ? "今天还能免费查 1 条" : `今天还能免费查 ${view.remaining} 条`;
  }
  return `今天还能查 ${view.remaining} 条`;
}

export function quotaIsExhausted(view: CheckQuotaView | null | undefined): boolean {
  return Boolean(view?.enforced && view.remaining <= 0);
}

export function isChecksExhaustedMessage(message: string | undefined): boolean {
  if (!message) return false;
  return message === checksExhaustedMessage("guest") || message === checksExhaustedMessage("account");
}

export function parseCheckQuota(data: unknown): CheckQuotaView | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const kind = row.kind === "account" ? "account" : row.kind === "guest" ? "guest" : null;
  const remaining = asNonNegInt(row.remaining);
  const total = asNonNegInt(row.total);
  const used = asNonNegInt(row.used);
  if (!kind || remaining === null || total === null || used === null) return null;
  return { remaining, total, used, kind, enforced: row.enforced !== false };
}

export function shanghaiDayKey(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function asNonNegInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}
