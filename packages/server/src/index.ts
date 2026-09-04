import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createApp, DEFAULT_PORT } from "./app.js";
import { buildDeps, definedEnv, overlaySearchDeps } from "./deps.js";
import { createQuota } from "./quota.js";
import { FileCaseStore } from "./store.js";
import { TurnRunner } from "./turns.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(repoRoot, ".env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const env = process.env;
const port = Number(env.PORT) || DEFAULT_PORT;
const casesDir = env.CASES_DIR || resolve(repoRoot, ".data/cases");
const quotaLimit = env.DAILY_CHECKS_PER_IP === undefined ? 20 : Number(env.DAILY_CHECKS_PER_IP);

const operatorEnv = definedEnv(env);
const deps = buildDeps(env);
const store = new FileCaseStore(casesDir);
await store.repairIncomplete();
const turns = new TurnRunner(store, deps);
const quota = createQuota({ limit: Number.isFinite(quotaLimit) ? quotaLimit : 20 });
const app = createApp({
  deps,
  store,
  turns,
  quota,
  operatorEnv,
  withSearchEnv: (merged) => overlaySearchDeps(deps, merged),
});

const server = app.listen(port, () => {
  console.log(`http://127.0.0.1:${port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await turns.abortAll();
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((err) => (err ? rejectClose(err) : resolveClose()));
  });
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
