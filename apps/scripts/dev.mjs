#!/usr/bin/env node
/**
 * Start Express API then Vite. Local /api is proxied; do not reimplement handlers in Vite.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = resolve(root, "server");
const apiPort = Number(process.env.API_PORT || 3000);
const apiOrigin = (process.env.API_ORIGIN || `http://127.0.0.1:${apiPort}`).replace(/\/$/, "");
const viteArgs = process.argv.slice(2);
const bin = (dir, name) => {
  const unix = resolve(dir, "node_modules", ".bin", name);
  const win = `${unix}.cmd`;
  if (process.platform === "win32" && existsSync(win)) return win;
  return unix;
};

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function apiHealthy() {
  try {
    const res = await fetch(`${apiOrigin}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === "ok";
  } catch {
    return false;
  }
}

async function waitForApi(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await apiHealthy()) return;
    await sleep(150);
  }
  throw new Error(`API did not become ready at ${apiOrigin}/health`);
}

let apiChild = null;

if (await apiHealthy()) {
  console.log(`[dev] reusing API at ${apiOrigin}`);
} else {
  const tsx = bin(serverDir, "tsx");
  if (!existsSync(tsx)) {
    console.error("[dev] server deps missing. Run: cd mvp/server && npm install");
    process.exit(1);
  }
  apiChild = spawn(tsx, ["watch", "src/index.ts"], {
    cwd: serverDir,
    stdio: "inherit",
    env: { ...process.env, PORT: String(apiPort) },
  });
  apiChild.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") return;
    if (code) {
      console.error(`[dev] API exited ${code}`);
      process.exit(code);
    }
  });
  await waitForApi();
  console.log(`[dev] API ready at ${apiOrigin}`);
}

const vite = bin(root, "vite");
if (!existsSync(vite)) {
  console.error("[dev] frontend deps missing. Run: cd mvp && npm install");
  process.exit(1);
}

const web = spawn(vite, ["--host", "127.0.0.1", ...viteArgs], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, API_ORIGIN: apiOrigin },
});

function shutdown() {
  web.kill("SIGTERM");
  if (apiChild) apiChild.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

web.on("exit", (code) => {
  if (apiChild) apiChild.kill("SIGTERM");
  process.exit(code ?? 0);
});
