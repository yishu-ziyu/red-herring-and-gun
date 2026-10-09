#!/usr/bin/env node
/**
 * Real end-to-end check of the main user path: real browser, real server, real models and search.
 * Needs the app running (`npm run dev`) with real keys in apps/.env.local. One run takes about 7 minutes.
 * Do not edit server files during a run: the dev server restarts on save and kills the investigation.
 */
import { chromium } from "playwright";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:5173/";
const claim = process.env.E2E_CLAIM || "隔夜菜会致癌，等于吃毒药";
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 10 * 60 * 1000);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(process.env.E2E_OUT || `../out/e2e/${stamp}`);
mkdirSync(out, { recursive: true });

const started = Date.now();
const checks = [];
const record = (name, pass, detail) => {
  checks.push({ name, pass, detail, atSeconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
};

// Always headless (no window steals focus); every run is recorded to run.webm in the evidence folder.
const browser = await chromium.launch();
const viewport = { width: 1440, height: 900 };
const context = await browser.newContext({ viewport, recordVideo: { dir: out, size: viewport } });
const page = await context.newPage();
const investigationPosts = [];
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/agent/orchestrate-stream")) investigationPosts.push(req.url());
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

async function run() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const editor = page.locator("[contenteditable=true], textarea").first();
  if (!record("home shows the input", await editor.isVisible())) return;

  await editor.click();
  await page.keyboard.type(claim);
  await page.getByRole("button", { name: "开始调查" }).click();
  await shot("1-submitted");

  const end = page.locator('[data-gp-phase="complete"], [data-gp-phase="interrupted"], [data-gp-phase="stopped"]').first();
  await end.waitFor({ timeout: timeoutMs }).catch(() => {});
  const phase = await end.getAttribute("data-gp-phase").catch(() => null);
  await shot("2-finished");
  if (!record("investigation completes", phase === "complete", `phase=${phase}`)) return;
  record("exactly one investigation request", investigationPosts.length === 1, `posts=${investigationPosts.length}`);

  const answer = (await page.locator("[data-gp-direct-answer]").first().innerText().catch(() => "")).trim();
  record("conclusion answers the claim", answer.length > 0, answer.slice(0, 80));
  const judged = await page.locator("[data-gp-judgment]").count();
  record("claims have judgments", judged > 0, `judgments=${judged}`);

  // "Key evidence" is empty by design when evidence is insufficient, so open a source from the source list.
  await page.getByRole("button", { name: /收集到的来源/ }).first().click().catch(() => {});
  const sourcePill = page.locator("[data-gp-source-pill] button").first();
  if (record("source list opens", await sourcePill.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await sourcePill.click();
    const drawer = page.getByRole("dialog");
    const link = drawer.getByRole("link", { name: /打开原文/ }).first();
    const href = await link.getAttribute("href", { timeout: 10_000 }).catch(() => null);
    await shot("3-source-drawer");
    record("source drawer links to the original page", /^https?:\/\//.test(href || ""), href || "no link");
    await page.keyboard.press("Escape");
  }

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "历史记录" }).click();
  const entry = page.getByRole("dialog").getByText(claim, { exact: false }).first();
  if (!record("history lists the investigation", await entry.isVisible({ timeout: 10_000 }).catch(() => false))) return;
  await entry.click();
  const reopened = page.locator("[data-gp-direct-answer]").first();
  await reopened.waitFor({ timeout: 30_000 }).catch(() => {});
  const reopenedAnswer = (await reopened.innerText().catch(() => "")).trim();
  await shot("4-reopened");
  record("reopened investigation shows the same conclusion", reopenedAnswer === answer, reopenedAnswer.slice(0, 80));
  record("reopening does not start a new investigation", investigationPosts.length === 1, `posts=${investigationPosts.length}`);
}

try {
  await run();
} catch (error) {
  record("script ran without crashing", false, String(error?.message || error).slice(0, 300));
  await shot("crash").catch(() => {});
} finally {
  const video = page.video();
  await context.close(); // flushes the video file
  await browser.close();
  if (video) renameSync(await video.path(), `${out}/run.webm`);
}

const pass = checks.length > 0 && checks.every((c) => c.pass);
const result = { pass, claim, baseUrl, seconds: Math.round((Date.now() - started) / 1000), checks };
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(`${pass ? "E2E PASSED" : "E2E FAILED"} in ${result.seconds}s — evidence: ${out}`);
process.exit(pass ? 0 : 1);
