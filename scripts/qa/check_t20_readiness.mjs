/** Check whether the packages server can serve the unchanged production client.
 * Run after `npm run build`: node scripts/qa/check_t20_readiness.mjs
 * No model/search calls or production data. Exit 1 means cutover is blocked.
 */
import { createApp } from "../../packages/server/dist/app.js";

const noWork = () => { throw new Error("This read-only compatibility probe must not start work"); };
const app = createApp({
  deps: {},
  store: { list: async () => [], load: async () => null, append: noWork },
  turns: { start: noWork, abort: noWork, isRunning: () => false },
  quota: { allow: () => false },
  operatorEnv: {},
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${server.address().port}`;
const requirements = [
  { name: "health contract", path: "/health", status: 200, accepts: (body) => body?.status === "ok" },
  { name: "model list", path: "/api/models/list", status: 200, accepts: (body) => Array.isArray(body?.models) },
  { name: "model availability", path: "/api/models/health", status: 200, accepts: (body) => ["available", "unavailable", "unknown"].includes(body?.status) },
  { name: "visitor quota", path: "/api/checks/quota", status: 200, accepts: (body) => typeof body?.remaining === "number" },
  { name: "anonymous account response", path: "/api/auth/email/me", status: 401, accepts: (body) => body !== null },
  { name: "history response shape", path: "/api/cases", status: 200, accepts: (body) => Array.isArray(body?.cases) },
];
try {
  const checks = [];
  for (const requirement of requirements) {
    const response = await fetch(`${base}${requirement.path}`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json().catch(() => null);
    checks.push({
      name: requirement.name, path: requirement.path,
      passed: response.status === requirement.status && requirement.accepts(body),
      expectedStatus: requirement.status, actualStatus: response.status,
      jsonKeys: body && typeof body === "object" ? Object.keys(body) : null,
    });
  }
  const ready = checks.every((check) => check.passed);
  console.log(JSON.stringify({
    ready, checks,
    scope: "Minimum HTTP compatibility only; passing does not replace ownership, data migration, judgment parity or browser tests",
  }, null, 2));
  process.exitCode = ready ? 0 : 1;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
