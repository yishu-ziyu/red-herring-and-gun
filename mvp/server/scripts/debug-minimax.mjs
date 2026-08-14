import { readFileSync } from "node:fs";
import { join } from "node:path";

// 加载 .env.local
const envPath = join(process.cwd(), "..", ".env.local");
const text = readFileSync(envPath, "utf8");
for (const l of text.split("\n")) {
  const line = l.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (process.env[k] === undefined) process.env[k] = v;
}

const apiKey = process.env.MINIMAX_API_KEY;
const baseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");

const url = baseUrl.endsWith("/v1/messages") ? baseUrl : `${baseUrl}/v1/messages`;
console.log("url:", url);
console.log("model:", process.env.MINIMAX_MODEL);
console.log("authHeader:", process.env.MINIMAX_AUTH_HEADER);

const headers = {
  "Content-Type": "application/json",
  "anthropic-version": "2023-06-01",
};
if (process.env.MINIMAX_AUTH_HEADER === "bearer") headers.Authorization = `Bearer ${apiKey}`;
else headers["x-api-key"] = apiKey;

const system = "你是红鲱鱼与枪的 RumorDetector（谣言特征检测专家）。你的工作方式像侦探立案：先观察语言痕迹，拆出可验证命题，只记录证据需求，不凭常识补事实。你的任务是分析用户提供的 claim（声明/信息），先拆出可核查的原子命题（claimAtoms），再识别其中可能存在的谣言特征。原子命题的判定标准：每个原子命题必须是一个独立、可单独核查的判断。必须输出 JSON 对象，字段至少包含 claimAtoms（字符串数组）、claimAtomTypes（含 text/verifiable/type 的对象数组）、stanceClaimType（含 verifiable/type/reason）、severity、analysis。";
const user = "{\"claim\":\"某药宣称能治愈失眠，且声称已获国家药监局批准上市\",\"task\":\"分诊 claim、拆分原子命题、识别谣言类型与后续证据需求\"}";

const body = {
  model: process.env.MINIMAX_MODEL || "MiniMax-M3",
  max_tokens: Number(process.env.MINIMAX_M3_MAX_TOKENS || process.env.MINIMAX_M3_MIN_MAX_TOKENS || 131072),
  system,
  messages: [{ role: "user", content: user }],
  thinking: { type: process.env.MINIMAX_M3_THINKING === "disabled" ? "disabled" : "adaptive" },
};

const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
const raw = await resp.text();
console.log("\n=== STATUS ===", resp.status);
console.log("=== RAW (first 3000) ===");
console.log(raw.slice(0, 3000));