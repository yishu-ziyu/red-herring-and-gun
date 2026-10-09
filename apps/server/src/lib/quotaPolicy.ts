/**
 * 哪些端点计入每日免费核查额度。
 *
 * 只有真正发起核查的端点才算额度；只读端点不得计额度。
 * 判定与中间件都收在这里，作为唯一来源；`index.ts` 不再把闸门散写在各路由参数里。
 */
import { gateFreeCheck } from "./checkQuota.js";

export const QUOTA_GATED_PATHS = [
  "/api/agent/orchestrate-stream",
] as const;

export function isQuotaGatedPath(path: string): boolean {
  return (QUOTA_GATED_PATHS as readonly string[]).includes(path);
}

type Middleware = (req: any, res: any, next: (error?: unknown) => void) => void;

/**
 * 按路径取闸门中间件。未列入 `QUOTA_GATED_PATHS` 的路径返回直通中间件，
 * 语义等同不挂闸——保持各路由原有的中间件位置与顺序不变。
 */
export function quotaGate(path: string): Middleware {
  if (!isQuotaGatedPath(path)) {
    return (_req, _res, next) => next();
  }
  return async (req, res, next) => {
    const ticket = await gateFreeCheck(req, res);
    if (!ticket) return;
    req.checkTicket = ticket;
    next();
  };
}
