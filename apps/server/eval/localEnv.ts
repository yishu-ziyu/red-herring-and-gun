/**
 * localEnv.ts — probe 脚本共用：读 .env.local 到 process.env（不覆盖已有值）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CANDIDATES = [".env.local", "server/.env.local"];

function parseEnvLine(rawLine: string): { key: string; value: string } | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;
  const eq = line.indexOf("=");
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!key) return null;
  return { key, value };
}

function applyEnvText(text: string): void {
  for (const rawLine of text.split("\n")) {
    const parsed = parseEnvLine(rawLine);
    if (!parsed || process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

export function loadLocalEnv(): void {
  for (const rel of CANDIDATES) {
    const path = join(APPS_DIR, rel);
    if (!existsSync(path)) continue;
    applyEnvText(readFileSync(path, "utf8"));
  }
}
