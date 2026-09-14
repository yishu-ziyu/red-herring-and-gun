/**
 * localEnv.ts — probe 脚本共用：读 .env.local 到 process.env（不覆盖已有值）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [".env.local", "server/.env.local", "../.env.local", ".env.local.example"];

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
  const cwd = process.cwd();
  for (const rel of CANDIDATES) {
    const path = join(cwd, rel);
    if (!existsSync(path)) continue;
    applyEnvText(readFileSync(path, "utf8"));
  }
}
