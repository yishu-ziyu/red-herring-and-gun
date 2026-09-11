/**
 * 哪些端点计入每日免费核查额度。
 *
 * 只有真正发起核查的端点才算额度。服务可用性探针（`/api/models/health`）
 * 与只读列表（`/api/models/list`）不是核查，不得计额度：前端每次加载输入页都会调探针，
 * 把探针计进去会让访客打开一次首页就用光当天配额。
 *
 * 判定与中间件都收在这里，作为唯一来源；`index.ts` 不再把闸门散写在各路由参数里。
 * 契约见 `docs/evals/2026-09-11-health-probe-quota.md`。
 */
import { gateFreeCheck } from "./checkQuota.js";

export const QUOTA_GATED_PATHS = [
  "/mcp",
  "/api/agent/orchestrate-stream",
  "/api/agent/batch",
  "/api/agent/test-llm",
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
