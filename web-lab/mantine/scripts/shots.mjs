// 5 个部分 × 两种宽度截图；运行回放录一段视频。用法：node scripts/shots.mjs [outDir] [--video]
import { chromium } from "/Users/mahaoxuan/Desktop/AI-products/红鲱鱼/apps/node_modules/playwright/index.mjs";
import { mkdirSync, renameSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5203";
const out = process.argv[2] || "./shots";
const video = process.argv.includes("--video");
mkdirSync(out, { recursive: true });

const parts = [
  ["home", "/?part=home", async () => {}],
  ["running", "/?part=running&run=sun", async (page) => { await page.waitForTimeout(6500); }],
  ["result", "/?part=result&run=sun", async (page) => { await page.waitForSelector("[data-gp-direct-answer]"); }],
  ["history", "/?part=history", async (page) => { await page.waitForSelector("[role=dialog] a"); await page.waitForTimeout(500); }],
  ["share", "/?part=share&run=sun", async (page) => { await page.waitForSelector("[data-share-conclusion]"); }],
  ["result-image", "/?part=result&run=lemon-image", async (page) => { await page.waitForSelector("[data-gp-direct-answer]"); }],
  ["result-false", "/?part=result&run=seafood", async (page) => { await page.waitForSelector("[data-gp-direct-answer]"); }],
];
const sizes = [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]];

const browser = await chromium.launch();
const problems = [];
if (!video) {
  for (const [w, viewport] of sizes) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    for (const [name, path, ready] of parts) {
      const page = await ctx.newPage();
      page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push(`${name}@${w}: ${m.text().split("\n")[0].slice(0, 200)}`));
      page.on("pageerror", (e) => problems.push(`${name}@${w}: ${e.message}`));
      await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
      await ready(page);
      await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: name !== "history" && name !== "running" });
      const text = await page.evaluate(() => document.body.innerText);
      for (const bad of ["截", "检索通道", "minimax", "stepfun", "StepFun", "AnySearch", "Tavily", "Metaso", "秘塔", "阶跃", "anthropic", "deepseek"]) {
        if (text.includes(bad)) problems.push(`${name}@${w}: 页面出现「${bad}」`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${name}@${w}: 横向溢出 ${overflow}px`);
      await page.close();
    }
    await ctx.close();
  }
} else {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/?part=running&run=sun");
  await page.waitForSelector('[data-gp-phase="complete"] [data-gp-direct-answer]', { timeout: 90000 });
  await page.waitForTimeout(2500);
  const phase = await page.getAttribute("[data-gp-phase]", "data-gp-phase");
  console.log("final phase", phase);
  const v = page.video();
  await ctx.close();
  renameSync(await v.path(), `${out}/running-replay.webm`);
}
await browser.close();
console.log(problems.length ? [...new Set(problems)].join("\n") : "no problems");
