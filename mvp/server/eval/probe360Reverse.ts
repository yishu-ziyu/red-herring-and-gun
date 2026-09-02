/**
 * Probe 360 图搜接口真实响应（开发工具，不进生产）。用法：
 *   cd mvp/server && npx tsx eval/probe360Reverse.ts
 * 若接口可用，输出命中数与首条 JSON；不可用则输出错误结构。
 */
import { readFileSync } from "node:fs";

function loadEnv() {
  for (const p of [".env.local", "../.env.local"]) {
    try {
      const text = readFileSync(p, "utf8");
      for (const line of text.split("\n")) {
        const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
        if (m) process.env[m[1]] = m[2];
      }
    } catch {}
  }
}
loadEnv();

const TEST_IMG =
  process.env.PROBE_IMG_URL ||
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/240px-PNG_transparency_demonstration_1.png";

const apiKey =
  process.env.QIHOO_360_API_KEY || process.env.ZHINAO_API_KEY || process.env.AI360_API_KEY || "";
if (!apiKey) {
  console.log("SKIP: 无 360 key");
  process.exit(0);
}

const url = "https://api.360.cn/saas/vertical?q=&ref_prom=360so-v-ig";
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ img_url: TEST_IMG }),
}).catch((err) => {
  console.log("FETCH_ERR:", String(err));
  process.exit(1);
});
const text = await res.text();
console.log("STATUS:", res.status);
console.log("BODY_HEAD:", text.slice(0, 800));