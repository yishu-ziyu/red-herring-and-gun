/**
 * localEnv.ts — probe 脚本共用：读 .env.local 到 process.env（不覆盖已有值）。
 */
import { readFileSync } from "node:fs";

export function loadLocalEnv(): void {
  for (const p of [".env.local", "../.env.local"]) {
    try {
      const text = readFileSync(p, "utf8");
      for (const line of text.split("\n")) {
        const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
      }
    } catch {
      /* 文件不存在则跳过 */
    }
  }
}