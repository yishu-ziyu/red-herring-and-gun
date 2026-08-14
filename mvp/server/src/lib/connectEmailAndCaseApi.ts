/**
 * 把邮箱登录和 case 路由挂到 Vite connect 中间件上。
 * 本地 `npm run dev` 不走 Express :3000，否则 /api/auth/email 会 404。
 */

import {
  accountDeleteHandler,
  accountExportHandler,
  emailLogoutHandler,
  emailMeHandler,
  emailProfileHandler,
  emailRequestHandler,
  emailVerifyHandler,
} from "./emailAuthHandlers.js";
import { checksQuotaHandler } from "./checkQuota.js";
import { getCaseHandler, listCasesHandler, postCaseHandler } from "./caseHandlers.js";

function requestPath(req: { originalUrl?: string; url?: string }): string {
  const raw = String(req.originalUrl || req.url || "");
  return raw.split("?")[0] || "";
}

async function readJsonBody(req: any): Promise<unknown> {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function connectEmailAndCaseApi() {
  return async (req: any, res: any, next: (error?: unknown) => void) => {
    const path = requestPath(req);
    const isAuth =
      path.startsWith("/api/auth/email/") ||
      path === "/api/account" ||
      path === "/api/account/export" ||
      path === "/api/checks/quota" ||
      path === "/api/cases" ||
      path === "/api/case" ||
      path.startsWith("/api/case/");
    if (!isAuth) {
      next();
      return;
    }

    try {
      if (req.method === "POST" || req.method === "DELETE" || req.method === "PATCH") {
        try {
          req.body = await readJsonBody(req);
        } catch {
          req.body = {};
        }
      }

      if (path === "/api/auth/email/request") return void (await emailRequestHandler(req, res));
      if (path === "/api/auth/email/verify") return void (await emailVerifyHandler(req, res));
      if (path === "/api/auth/email/me") return void (await emailMeHandler(req, res));
      if (path === "/api/auth/email/profile") return void (await emailProfileHandler(req, res));
      if (path === "/api/auth/email/logout") return void (await emailLogoutHandler(req, res));
      if (path === "/api/checks/quota") return void (await checksQuotaHandler(req, res));
      if (path === "/api/account/export") return void (await accountExportHandler(req, res));
      if (path === "/api/account") return void (await accountDeleteHandler(req, res));
      if (path === "/api/cases") return void (await listCasesHandler(req, res));
      if (path === "/api/case" && req.method === "POST") return void (await postCaseHandler(req, res));

      const caseMatch = path.match(/^\/api\/case\/([^/]+)$/);
      if (caseMatch && req.method === "GET") {
        req.params = { ...(req.params ?? {}), caseId: decodeURIComponent(caseMatch[1]) };
        return void (await getCaseHandler(req, res));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
