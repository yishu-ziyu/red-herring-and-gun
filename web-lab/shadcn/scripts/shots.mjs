// 五个部分各截 1440×900 和 390×844 两张整页图，再录一段运行过程回放（从头放到结论出现）。
// 运行：node scripts/shots.mjs [输出目录]；dev server 需已在 5201 运行。不发起任何核查。
import { chromium } from "/Users/mahaoxuan/Desktop/AI-products/红鲱鱼/apps/node_modules/playwright/index.mjs";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const base = process.env.LAB_URL || "http://127.0.0.1:5201";
const out = process.argv[2] || "/private/tmp/claude-501/-Users-mahaoxuan-Desktop-AI-products----/89429887-b3f4-4ed0-8a71-335e6c376a58/scratchpad/lab/shadcn";
mkdirSync(out, { recursive: true });

const parts = [
  ["home", "/?part=home"],
  ["running", "/?part=running&run=sun"],
  ["result", "/?part=result&run=sun"],
  ["history", "/?part=history"],
  ["share", "/?part=share&run=banana"],
];
const extra = [
  ["result-banana", "/?part=result&run=banana"],
  ["result-image", "/?part=result&run=lemon-image"],
  ["running-image", "/?part=running&run=lemon-image"],
];
const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

const browser = await chromium.launch();
const errors = [];
let posts = 0;
for (const [vpName, viewport] of viewports) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: vpName === "mobile" ? 2 : 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${vpName}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${vpName} console: ${m.text()}`));
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/api/investigations") && !r.url().includes("/shares") && (posts += 1));
  for (const [name, path] of [...parts, ...extra]) {
    await page.goto(base + path, { waitUntil: "load" });
    if (name.startsWith("running")) {
      // 回放 32 倍速放完，再截完成后的工作台。
      await page.getByRole("radio", { name: "32×" }).click();
      await page.locator('[data-gp-phase="complete"]').first().waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: join(out, `${name}-${vpName}.png`), fullPage: name !== "history" });
    console.log("shot", name, vpName);
  }
  await context.close();
}

// 录像：桌面尺寸，8 倍速从头放到结论出现。
const rec = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await rec.newPage();
await page.goto(`${base}/?part=running&run=sun`, { waitUntil: "load" });
await page.locator('[data-gp-phase="complete"]').first().waitFor({ timeout: 180_000 });
await page.locator("[data-gp-direct-answer]").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
const video = page.video();
await rec.close();
const videoPath = join(out, "running-replay.webm");
renameSync(await video.path(), videoPath);
console.log("video", videoPath);
await browser.close();
console.log("investigation POSTs:", posts);
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
