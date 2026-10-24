/**
 * 免费核查额度的 HTTP 入口。每个访客每天 2 条，账本在 quotaLedger.ts。
 * 开始时占位，出判断才扣；我们自己失败则放回；用户中途取消不计。
 */

import crypto from "node:crypto";
import { checksExhaustedMessage, type CheckQuotaView } from "../../../shared/quota.js";
import { headerValue, identifyGuest, writeGuestCookie } from "./guestIdentity.js";
import { guestDailyLimit, quotaUsage, reserveQuota, unmeteredReservation, type Reservation } from "./quotaLedger.js";

/**
 * 只在生产环境限额；本机开发不拦。
 * 运维旁路：开发者/服务器自己验证真实链路时不受免费额度限制。token 只存在服务端 env（OPS_CHECK_BYPASS_TOKEN），
 * 未配置时旁路完全关闭；头名 x-ops-check-token。恒时比较防探测。
 */
function isMetered(req: { headers?: { [key: string]: unknown } }): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const expected = process.env.OPS_CHECK_BYPASS_TOKEN?.trim();
  if (!expected) return true;
  const supplied = headerValue(req.headers?.["x-ops-check-token"]);
  if (!supplied) return true;
  const a = crypto.createHash("sha256").update(expected, "utf8").digest();
  const b = crypto.createHash("sha256").update(supplied, "utf8").digest();
  return !crypto.timingSafeEqual(a, b);
}

function writeJson(res: any, status: number, body: unknown) {
  if (res.headersSent) return;
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(body));
}

/**
 * 只在真正发起核查时调用，只读端点不计额度。额度不够时回 429 并返回 null。
 * 拿到的占位交给 run（RunService.start），由 run 的结局结算。
 */
export function reserveFreeCheck(req: any, res: any): Reservation | null {
  if (!isMetered(req)) return unmeteredReservation();
  const guest = identifyGuest(req);
  const reservation = reserveQuota(guest, "check");
  const usage = quotaUsage(guest, "check");
  writeGuestCookie(res, guest.id, usage.day, usage.used);
  if (!reservation) {
    writeJson(res, 429, { error: "checks_exhausted", message: checksExhaustedMessage() });
    return null;
  }
  return reservation;
}

export async function checksQuotaHandler(req: any, res: any) {
  if (req.method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  let quota: CheckQuotaView;
  if (isMetered(req)) {
    const guest = identifyGuest(req);
    const usage = quotaUsage(guest, "check");
    writeGuestCookie(res, guest.id, usage.day, usage.used);
    quota = { remaining: usage.remaining, total: usage.total, used: usage.used, kind: "guest", enforced: true };
  } else {
    const total = guestDailyLimit("check");
    quota = { remaining: total, total, used: 0, kind: "guest", enforced: false };
  }
  writeJson(res, 200, quota);
}
