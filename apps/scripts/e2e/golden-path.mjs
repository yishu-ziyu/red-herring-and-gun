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
// Set to check the page of a run that did not finish: stops the run after this many ms.
const stopAfterMs = Number(process.env.E2E_STOP_AFTER_MS || 0);
const out = resolve(`../out/e2e/${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });

// Must match apps/shared/domain/labels.ts.
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
// Records every phase the canvas shows, so a reused earlier answer (no progress at all) is caught.
await context.addInitScript(() => {
  window.__gpPhases = [];
  new MutationObserver(() => {
    for (const node of document.querySelectorAll("[data-gp-phase]")) {
      const phase = node.getAttribute("data-gp-phase");
      if (window.__gpPhases.at(-1) !== phase) window.__gpPhases.push(phase);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-gp-phase"] });
});
const page = await context.newPage();
let investigationPosts = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && new URL(req.url()).pathname === "/api/investigations") investigationPosts += 1;
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: "disabled" });
const conclusion = () => page.locator("[data-gp-direct-answer]").first().innerText().then((t) => t.trim()).catch(() => "");

async function run() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const editor = page.locator("[contenteditable=true], textarea").first();
  if (!record("home shows the input", await editor.isVisible())) return;
  await editor.click();
  await page.keyboard.type(claim);
  await page.locator("[data-gp-start]").first().click();
  if (stopAfterMs) {
    await page.waitForTimeout(stopAfterMs);
    await page.getByRole("button", { name: "停止核查" }).click();
  }

  const finished = page.locator('[data-gp-phase="complete"], [data-gp-phase="interrupted"]').first();
  await finished.waitFor({ timeout: 10 * 60 * 1000 }).catch(() => {});
  const phase = await finished.getAttribute("data-gp-phase").catch(() => null);
  await shot("result");
  if (stopAfterMs) {
    if (record("stopped run ends as not finished", phase === "interrupted", `phase=${phase}`)) await checkInterrupted();
    return;
  }
  if (!record("investigation completes", phase === "complete", `phase=${phase}`)) {
    if (phase === "interrupted") await checkInterruptedPage();
    return;
  }
  record("exactly one investigation request", investigationPosts === 1, `posts=${investigationPosts}`);
  const phases = await page.evaluate(() => window.__gpPhases);
  record(
    "the investigation actually ran (not an earlier answer reused)",
    // "received" alone shows even when an earlier answer is reused; real work passes through a working phase.
    phases.some((p) => !["received", "complete", "interrupted"].includes(p)),
    `${phases.join(" → ")}${phases.every((p) => ["received", "complete", "interrupted"].includes(p)) ? " — this claim was answered before; set E2E_CLAIM to a new one" : ""}`
  );

  const lead = page.locator("[data-gp-direct-answer]").first();
  const label = (await lead.locator("[data-gp-conclusion-label]").first().textContent().catch(() => "")).trim();
  const reason = (await lead.locator("[data-gp-conclusion-reason]").first().textContent().catch(() => "")).trim();
  // Copy the user retired: 「截」 for parts (they are 「点」), agent job titles, read-status jargon, internal review notes.
  const pageText = await page.locator("body").innerText().catch(() => "");
  const retired = pageText.match(/.{0,8}(截(?![图断取屏])|拆题员|检索员|核查员|审核员|成稿员|搜索摘要|已读正文|复核通过|逐一核对|条事件|方向关系|独立核验|命题).{0,8}/);
  record("page shows none of the retired copy", !retired, retired ? retired[0] : "");
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

  // The activity timeline must end on the same label each part shows.
  const timeline = [];
  for (const [, first, from, to] of pageText.matchAll(/这一点有了判断：(.+)|判断改了：(.+) → (.+)/g)) {
    if (first) timeline.push(first.trim());
    else timeline.splice(timeline.indexOf(from.trim()), 1, to.trim());
  }
  const unmatched = parts.map((p) => p.labels[0]).filter((label) => {
    const at = timeline.indexOf(label);
    if (at >= 0) timeline.splice(at, 1);
    return at < 0;
  });
  record("timeline and result show the same label for every part", unmatched.length === 0, unmatched.join(" "));

  // Without a search the page cannot know whether material exists, so it must not say either way.
  const searched = pageText.includes("找到材料：");
  const claimedAbsence = searched ? null : pageText.match(/.{0,8}(还缺：|目前没有|没有找到|未找到|找不到).{0,8}/);
  record("a claim that was never searched says nothing about what exists", !claimedAbsence, claimedAbsence?.[0] ?? (searched ? "searched" : ""));

  const answer = await conclusion();
  await checkShare(answer);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "历史记录" }).click();
  const entry = page.getByRole("dialog").getByText(claim, { exact: false }).first();
  // isVisible() ignores its timeout and the list loads after the dialog opens, so wait for the entry.
  const listed = await entry.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
  if (!record("history lists the investigation", listed)) return;
  await entry.click();
  await page.locator("[data-gp-direct-answer]").first().waitFor({ timeout: 30_000 }).catch(() => {});
  record("reopened investigation shows the same conclusion", (await conclusion()) === answer);
  record("reopening does not start a new investigation", investigationPosts === 1, `posts=${investigationPosts}`);
}

// What a run that did not finish must show on the page.
async function checkInterruptedPage() {
  const notice = page.locator("[data-gp-interrupted]").first();
  const shown = await notice.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  record("not-finished page says there is no conclusion", shown);
  const pageText = await page.locator("body").innerText().catch(() => "");
  const stale = pageText.match(/复核后改写|开始写结论并复核|结论已写好/);
  record("not-finished page does not talk about writing a conclusion", !stale, stale?.[0] ?? "");
  const links = await notice.locator("a[href^='http']").count();
  record("not-finished page lists the material found so far", !pageText.includes("找到材料：") || links > 0, `links=${links}`);
  record("not-finished page offers to check again", await page.locator("[data-gp-retry]").first().isVisible());
}

// The page, reopening it from history, and starting over. The new run is stopped so it costs little.
async function checkInterrupted() {
  await checkInterruptedPage();
  const runUrl = page.url();
  await page.goto(runUrl.replace("/run/", "/result/"), { waitUntil: "networkidle" });
  const reopened = await page.locator("[data-gp-interrupted]").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  record("reopened not-finished run still says there is no conclusion", reopened);
  await page.goto(runUrl, { waitUntil: "networkidle" });
  const retry = page.locator("[data-gp-retry]").first();
  if (!(await retry.waitFor({ timeout: 10_000 }).then(() => true, () => false))) return;
  await retry.click();
  const moved = await page.waitForURL((url) => url.href !== runUrl, { timeout: 15_000 }).then(() => true, () => false);
  record("check again starts a new investigation", moved && investigationPosts === 2, `posts=${investigationPosts}`);
  await page.getByRole("button", { name: "停止核查" }).click({ timeout: 15_000 }).catch(() => {});
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
