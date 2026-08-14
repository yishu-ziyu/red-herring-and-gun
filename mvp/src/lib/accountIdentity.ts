/** ChatGPT / Kimi 式账户展示：有称呼用称呼，没有就用邮箱 @ 前面那一段。 */

export const ACCOUNT_NAME_MAX = 24;

export function accountHandle(email: string): string {
  const local = email.split("@")[0]?.trim();
  return local || email;
}

export function accountDisplayName(email: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name || accountHandle(email);
}

export function accountInitial(name: string): string {
  const ch = Array.from(name.trim())[0];
  return ch ? ch.toUpperCase() : "?";
}

export function normalizeAccountName(raw: unknown): { ok: true; value: string } | { ok: false; error: "too_long" } {
  if (typeof raw !== "string") return { ok: true, value: "" };
  const value = raw.replace(/\s+/g, " ").trim();
  if (Array.from(value).length > ACCOUNT_NAME_MAX) return { ok: false, error: "too_long" };
  return { ok: true, value };
}
