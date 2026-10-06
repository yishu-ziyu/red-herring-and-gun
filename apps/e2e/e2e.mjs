#!/usr/bin/env node
// 端到端测试入口：起一套独立的服务和前端（空数据目录），驱动真实浏览器跑说法，产出报告。
//
//   node e2e/e2e.mjs --mode live   [--cases e2e/cases.json] [--workers 3] [--baseline <旧运行目录>]
//   node e2e/e2e.mjs --mode record  同 live，并把外部回复录进 <运行目录>/tape
//   node e2e/e2e.mjs --mode replay --tape <录音目录>   不联网，用录音驱动（几分钟、零额度）
//
// 产物：outputs/e2e/<时间>-<mode>/ 下每条说法的整页截图与报告 JSON、checks.json、report.html。
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = resolve(HERE, "..");
const REPO = resolve(APPS, "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => (token.startsWith("--") ? [...pairs, [token.slice(2), all[i + 1]]] : pairs), [])
);
const mode = args.mode ?? "live";
if (!["live", "record", "replay"].includes(mode)) throw new Error(`未知 mode：${mode}`);
if (mode === "replay" && !args.tape) throw new Error("replay 需要 --tape <录音目录>");
const casesFile = resolve(args.cases ?? join(HERE, "cases.json"));
const workers = Number(args.workers ?? (mode === "replay" ? 4 : 3));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = resolve(args.out ?? join(REPO, "outputs", "e2e", `${stamp}-${mode}`));
const apiPort = Number(args["api-port"] ?? 3100);
const webPort = Number(args["web-port"] ?? 5190);
mkdirSync(join(runDir, "data"), { recursive: true });
copyFileSync(casesFile, join(runDir, "cases.json"));

const env = { ...process.env, PORT: String(apiPort), DATA_DIR: join(runDir, "data"), RHG_DB_FILE: join(runDir, "data", "rhg.sqlite") };
if (mode === "record") env.RHG_NET_RECORD = join(runDir, "tape");
if (mode === "replay") {
  // 回放的录音拷进本次运行目录：命中 / 未命中记录写在副本里，原录音不被改动。
  cpSync(resolve(args.tape), join(runDir, "tape"), { recursive: true });
  env.RHG_NET_REPLAY = join(runDir, "tape");
}

const children = [];
function start(name, cmd, argv, cwd, extraEnv) {
  const child = spawn(cmd, argv, { cwd, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const log = join(runDir, `${name}.log`);
  child.stdout.on("data", (d) => writeFileSync(log, d, { flag: "a" }));
  child.stderr.on("data", (d) => writeFileSync(log, d, { flag: "a" }));
  children.push(child);
  return child;
}
function stopAll() {
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
}
process.on("exit", stopAll);
process.on("SIGINT", () => { stopAll(); process.exit(130); });

async function waitFor(url, label, timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} ${timeoutMs / 1000}s 内没有起来（见 ${runDir}）`);
}

start("api", "npx", ["tsx", "src/index.ts"], join(APPS, "server"));
await waitFor(`http://127.0.0.1:${apiPort}/health`, "API");
start("web", "npx", ["vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], APPS, { API_ORIGIN: `http://127.0.0.1:${apiPort}` });
await waitFor(`http://127.0.0.1:${webPort}/`, "前端");

const config = { baseUrl: `http://127.0.0.1:${webPort}`, casesFile: join(runDir, "cases.json"), outDir: runDir, workers, spaceName: `rhg e2e ${mode} ${stamp}` };
const script = `const CONFIG = ${JSON.stringify(config)};\n${readFileSync(join(HERE, "drive-cases.mjs"), "utf8")}`;
await new Promise((resolveDrive, rejectDrive) => {
  const drive = spawn("ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "inherit"] });
  drive.stdout.on("data", (d) => { process.stdout.write(d); writeFileSync(join(runDir, "drive.log"), d, { flag: "a" }); });
  drive.on("exit", (code) => (code === 0 ? resolveDrive() : rejectDrive(new Error(`浏览器驱动退出码 ${code}`))));
  drive.stdin.end(script);
});
stopAll();

await new Promise((resolveReport) => {
  const argv = [join(HERE, "report.mjs"), runDir, ...(args.baseline ? [resolve(args.baseline)] : [])];
  spawn(process.execPath, argv, { stdio: "inherit" }).on("exit", resolveReport);
});
console.log(`\n报告：${join(runDir, "report.html")}`);
