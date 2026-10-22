#!/usr/bin/env node
/**
 * Real end-to-end check of the main user path: real browser, real server, real models and search.
 * Needs `npm run dev` with real keys in apps/.env.local. Do not edit server files during a run:
 * the dev server restarts on save and kills the investigation.
 */
import { chromium } from "playwright";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:5173/";
const claim = process.env.E2E_CLAIM || "隔夜菜会致癌，等于吃毒药";
const out = resolve(`../out/e2e/${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });

// Must match apps/server/src/domain/labels.ts.
const LABELS = ["属实", "基本属实", "部分属实", "夸大了", "不属实", "还查不清", "无法核对", "说法不一", "是观点，不分对错"];
const DECISIVE_LABELS = ["属实", "基本属实", "部分属实", "夸大了", "不属实", "说法不一"];

const started = Date.now();
const checks = [];
const record = (name, pass, detail = "") => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
};

const browser = await chromium.launch();
const viewport = { width: 1440, height: 900 };
const context = await browser.newContext({ viewport, recordVideo: { dir: out, size: viewport } });
const page = await context.newPage();
let investigationPosts = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/agent/orchestrate-stream")) investigationPosts += 1;
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: "disabled" });
const conclusion = () => page.locator("[data-gp-direct-answer]").first().innerText().then((t) => t.trim()).catch(() => "");

async function run() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const editor = page.locator("[contenteditable=true], textarea").first();
  if (!record("home shows the input", await editor.isVisible())) return;
  await editor.click();
  await page.keyboard.type(claim);
  await page.getByRole("button", { name: "开始调查" }).click();

  const finished = page.locator('[data-gp-phase="complete"], [data-gp-phase="interrupted"], [data-gp-phase="stopped"]').first();
  await finished.waitFor({ timeout: 10 * 60 * 1000 }).catch(() => {});
  const phase = await finished.getAttribute("data-gp-phase").catch(() => null);
  await shot("result");
  if (!record("investigation completes", phase === "complete", `phase=${phase}`)) return;
  record("exactly one investigation request", investigationPosts === 1, `posts=${investigationPosts}`);

  const lead = page.locator("[data-gp-direct-answer]").first();
  const label = (await lead.locator("[data-gp-conclusion-label]").first().textContent().catch(() => "")).trim();
  const reason = (await lead.locator("[data-gp-conclusion-reason]").first().textContent().catch(() => "")).trim();
  record("conclusion shows one of the 9 labels and a reason", LABELS.includes(label) && reason.length > 0, `${label}｜${reason.slice(0, 80)}`);

  const parts = await page.locator("[data-gp-result] article[data-gp-claim-id]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      labels: [...node.querySelectorAll("[data-gp-claim-label]")].map((el) => el.textContent.trim()),
      reason: node.querySelector("[data-gp-claim-reason]")?.textContent?.trim() ?? "",
      rows: [...node.querySelectorAll("[data-gp-evidence-row]")].map((row) => ({
        role: row.getAttribute("data-gp-role"),
        href: row.querySelector("a[href]")?.getAttribute("href") ?? "",
      })),
    }))
  );
  record(
    "every part shows one of the 9 labels and a reason",
    parts.length > 0 && parts.every((p) => p.labels.length === 1 && LABELS.includes(p.labels[0]) && p.reason),
    parts.map((p) => `${p.labels.join("/") || "NO LABEL"}｜${p.reason.slice(0, 40) || "NO REASON"}`).join(" ‖ ")
  );
  record(
    "every decisive part links to a supporting or contradicting source",
    parts.every((p) => !DECISIVE_LABELS.includes(p.labels[0]) || p.rows.some((r) => ["support", "contradict"].includes(r.role) && /^https?:\/\//.test(r.href))),
    parts.map((p) => `${p.labels[0]}:${p.rows.length}`).join(" ")
  );

  const answer = await conclusion();
  await checkShare(answer);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "历史记录" }).click();
  const entry = page.getByRole("dialog").getByText(claim, { exact: false }).first();
  if (!record("history lists the investigation", await entry.isVisible({ timeout: 10_000 }).catch(() => false))) return;
  await entry.click();
  await page.locator("[data-gp-direct-answer]").first().waitFor({ timeout: 30_000 }).catch(() => {});
  record("reopened investigation shows the same conclusion", (await conclusion()) === answer);
  record("reopening does not start a new investigation", investigationPosts === 1, `posts=${investigationPosts}`);
}

// Share the result and open the link as a stranger (new context, no cookies).
async function checkShare(answer) {
  await page.locator("[data-gp-share-start]").first().click();
  const urlBox = page.locator("[data-gp-share-url]").first();
  await urlBox.waitFor({ timeout: 15_000 }).catch(() => {});
  const shareUrl = (await urlBox.innerText().catch(() => "")).trim();
  if (!record("share creates a link", /\/s\/[\w-]+$/.test(shareUrl), shareUrl)) return;
  const stranger = await browser.newContext({ viewport });
  try {
    const viewer = await stranger.newPage();
    await viewer.goto(shareUrl, { waitUntil: "domcontentloaded" });
    const shared = (await viewer.locator("[data-share-conclusion]").first().innerText().catch(() => "")).trim();
    const normalize = (text) => text.replace(/\s+/g, "");
    record("share link shows the same conclusion to a stranger", shared.length > 0 && normalize(shared) === normalize(answer), shared.slice(0, 80));
  } finally {
    await stranger.close();
  }
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
const seconds = Math.round((Date.now() - started) / 1000);
writeFileSync(`${out}/result.json`, JSON.stringify({ pass, claim, baseUrl, seconds, checks }, null, 2));
console.log(`${pass ? "E2E PASSED" : "E2E FAILED"} in ${seconds}s — evidence: ${out}`);
process.exit(pass ? 0 : 1);
