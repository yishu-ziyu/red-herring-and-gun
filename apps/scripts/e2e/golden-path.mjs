#!/usr/bin/env node
/**
 * Real end-to-end check of the main user path: real browser, real server, real models and search.
 * Needs the app running (`npm run dev`) with real keys in apps/.env.local. One run takes about 7 minutes.
 * The main run also shares the finished round, opens the link in a cookie-less context, revokes it and opens it again.
 * Do not edit server files during a run: the dev server restarts on save and kills the investigation.
 * E2E_FULL=1 also checks a follow-up question and an image-only investigation (about 20 minutes in total).
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

// The nine labels (#140, docs/PRODUCT.md). The text must match apps/server/src/domain/labels.ts exactly.
const LABELS = ["属实", "基本属实", "部分属实", "夸大了", "不属实", "还查不清", "无法核对", "说法不一", "是观点，不分对错"];
// The six labels used before #140. None of them may appear on the result page any more.
const OLD_LABELS = ["证据支持", "证据反驳", "有对有错", "有争议", "证据不足", "立场表达"];

const started = Date.now();
const shown = { conclusionLabel: "", partLabels: [] };
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
const finished = () => page.locator('[data-gp-phase="complete"], [data-gp-phase="interrupted"], [data-gp-phase="stopped"]').first();
async function waitForFinish() {
  await finished().waitFor({ timeout: timeoutMs }).catch(() => {});
  return finished().getAttribute("data-gp-phase").catch(() => null);
}

async function run() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const editor = page.locator("[contenteditable=true], textarea").first();
  if (!record("home shows the input", await editor.isVisible())) return;

  await editor.click();
  await page.keyboard.type(claim);
  await page.getByRole("button", { name: "开始调查" }).click();
  await shot("1-submitted");

  const phase = await waitForFinish();
  await shot("2-finished");
  if (!record("investigation completes", phase === "complete", `phase=${phase}`)) return;
  record("exactly one investigation request", investigationPosts.length === 1, `posts=${investigationPosts.length}`);

  const answer = (await page.locator("[data-gp-direct-answer]").first().innerText().catch(() => "")).trim();
  record("conclusion answers the claim", answer.length > 0, answer.slice(0, 80));
  await checkLabels();

  await checkShare(answer);

  // "Key evidence" is empty by design when evidence is insufficient, so open a source from the source list.
  await page.getByRole("button", { name: /收集到的来源/ }).first().click().catch(() => {});
  await checkDatesAndQuoteLinks();
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
  return answer;
}

// Every claim part shows one label and a reason; the conclusion starts with a label and a reason; no old label words.
async function checkLabels() {
  const parts = await page.locator("article[data-gp-claim-id]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.querySelector(".gp-claim-text")?.textContent?.trim() ?? "",
      labels: [...node.querySelectorAll("[data-gp-claim-label]")].map((el) => el.textContent.trim()),
      reason: node.querySelector("[data-gp-claim-reason]")?.textContent?.trim() ?? "",
    }))
  );
  shown.partLabels = parts.map((p) => p.labels[0] ?? "");
  const badParts = parts.filter((p) => p.labels.length !== 1 || !LABELS.includes(p.labels[0]) || !p.reason);
  record(
    "every claim part shows one of the 9 labels and a reason",
    parts.length > 0 && badParts.length === 0,
    parts.map((p) => `${p.labels.join("/") || "NO LABEL"}｜${p.text.slice(0, 20)}｜${p.reason.slice(0, 60) || "NO REASON"}`).join(" ‖ ")
  );
  const lead = page.locator("[data-gp-direct-answer]").first();
  const conclusionLabel = (await lead.locator("[data-gp-conclusion-label]").first().textContent().catch(() => "")).trim();
  const conclusionReason = (await lead.locator("[data-gp-conclusion-reason]").first().textContent().catch(() => "")).trim();
  const leadText = (await lead.innerText().catch(() => "")).trim();
  shown.conclusionLabel = conclusionLabel;
  record(
    "conclusion starts with one of the 9 labels and a reason",
    LABELS.includes(conclusionLabel) && leadText.startsWith(conclusionLabel) && conclusionReason.length > 0,
    `${conclusionLabel || "NO LABEL"}｜${conclusionReason.slice(0, 100) || "NO REASON"}`
  );
  const sentences = conclusionReason.split(/[。！？]/).filter((x) => x.trim()).length;
  record(
    "conclusion reason is one sentence without internal terms",
    sentences === 1 && !/原子|命题|判定为|判词/.test(conclusionReason),
    conclusionReason.slice(0, 100)
  );
  // textContent, not innerText: text that is rendered but scrolled away or folded still counts.
  const pageText = await page.evaluate(() => {
    const body = document.body.cloneNode(true);
    body.querySelectorAll("script, style").forEach((el) => el.remove());
    return body.textContent ?? "";
  }).catch(() => "");
  const oldHits = OLD_LABELS.filter((word) => pageText.includes(word)).map((word) => {
    const at = pageText.indexOf(word);
    return `${word}: …${pageText.slice(Math.max(0, at - 20), at + 20).replace(/\s+/g, " ")}…`;
  });
  record("result page shows none of the 6 old label words", oldHits.length === 0, oldHits.join(" ‖ "));
}

// #140: every evidence row shows a publish date or says it is missing; some source has a real date;
// the original-page link opened from an evidence row jumps to a sentence of that row's quote.
async function checkDatesAndQuoteLinks() {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const rows = await page.locator("[data-gp-evidence-row]").evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("[data-gp-published]")?.textContent?.trim() ?? "NO DATE"));
  const bad = rows.filter((text) => !DATE.test(text) && text !== "发布日期未取到");
  record("every evidence row shows a publish date or 发布日期未取到", rows.length > 0 && bad.length === 0, `rows=${rows.length} bad=${bad.join("/")}`);
  const bySource = await page.locator("[data-gp-source-pill]").evaluateAll((nodes) =>
    Object.fromEntries(nodes.map((node) => [node.getAttribute("data-gp-source-pill"), node.querySelector("[data-gp-published]")?.getAttribute("data-gp-published") ?? ""])));
  const dated = Object.values(bySource).filter((day) => DATE.test(day)).length;
  record("at least one source has a real publish date", dated > 0, `dated ${dated}/${Object.keys(bySource).length}`);

  const quoted = page.locator("[data-gp-evidence-key]:has([data-gp-evidence-excerpt])");
  const tried = [];
  let hit = null;
  for (let i = 0; i < Math.min(await quoted.count(), 8) && !hit; i += 1) {
    const row = quoted.nth(i);
    const quote = (await row.locator("[data-gp-evidence-excerpt]").first().textContent().catch(() => "")) ?? "";
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click().catch(() => {});
    const href = (await page.getByRole("dialog").locator("[data-gp-source-open]").first().getAttribute("href", { timeout: 5_000 }).catch(() => null)) ?? "";
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
    const at = href.indexOf("#:~:text=") >= 0 ? href.indexOf("#:~:text=") + 9 : href.indexOf(":~:text=") >= 0 ? href.indexOf(":~:text=") + 8 : -1;
    const text = at >= 0 ? decodeURIComponent(href.slice(at)) : "";
    tried.push(text || href.slice(0, 60));
    if (href.includes("#:~:text=") && text && quote.includes(text)) hit = href;
  }
  record("an evidence link jumps to a sentence of its quote", Boolean(hit), hit || `tried: ${tried.join(" ‖ ")}`);
}

// Share this round, open the link as a stranger (new context, no cookies), revoke it, open it again.
async function checkShare(answer) {
  const normalize = (text) => text.replace(/\s+/g, "").trim();
  await page.locator("[data-gp-share-start]").first().click();
  const urlBox = page.locator("[data-gp-share-url]").first();
  await urlBox.waitFor({ timeout: 15_000 }).catch(() => {});
  const shareUrl = (await urlBox.innerText().catch(() => "")).trim();
  await shot("2b-share-created");
  if (!record("share creates a link", /\/s\/[\w-]+$/.test(shareUrl), shareUrl)) return;

  const stranger = await browser.newContext({ viewport });
  const viewer = await stranger.newPage();
  try {
    await viewer.goto(shareUrl, { waitUntil: "domcontentloaded" });
    const shared = (await viewer.locator("[data-share-conclusion]").first().innerText().catch(() => "")).trim();
    record("share link shows the same conclusion to a stranger", shared.length > 0 && normalize(shared) === normalize(answer), shared.slice(0, 80));
    const sharedDates = await viewer.locator("[data-share-published]").allTextContents();
    record(
      "share page shows a publish date or 发布日期未取到 for each source",
      sharedDates.length > 0 && sharedDates.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.trim()) || t.trim() === "发布日期未取到"),
      `dates=${sharedDates.filter((t) => /\d/.test(t)).length}/${sharedDates.length}`
    );
    const source = await viewer.content();
    record("share page does not contain the internal image prompt", !source.includes("请核查用户上传"));
    const sharedLabel = (await viewer.locator("[data-share-label]").first().textContent().catch(() => "")).trim();
    const sharedParts = await viewer.locator("[data-share-claim]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.querySelector("[data-share-claim-label]")?.textContent?.trim() ?? "",
        reason: node.querySelector("[data-share-claim-reason]")?.textContent?.trim() ?? "",
      }))
    );
    record(
      "share page shows the same labels, each part with a reason",
      sharedLabel === shown.conclusionLabel &&
        JSON.stringify(sharedParts.map((p) => p.label)) === JSON.stringify(shown.partLabels) &&
        sharedParts.every((p) => p.reason),
      `${sharedLabel} | ${sharedParts.map((p) => p.label).join("/")}`
    );

    await page.locator("[data-gp-share-revoke]").first().click();
    await page.locator("[data-gp-share-revoked]").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await viewer.reload({ waitUntil: "domcontentloaded" });
    const revoked = await viewer.locator("[data-share-revoked]").count();
    const stillShows = await viewer.locator("[data-share-conclusion]").count();
    await viewer.screenshot({ path: `${out}/2c-share-revoked.png` });
    record("revoked link shows the revoked page, not the content", revoked === 1 && stillShows === 0, `revoked=${revoked} content=${stillShows}`);
  } finally {
    await stranger.close();
  }
}

// Follow-up on the reopened investigation, then an image-only investigation.
async function runFull(firstAnswer) {
  const question = page.getByPlaceholder(/针对此结论追问/);
  if (!record("follow-up box is shown", await question.isVisible({ timeout: 10_000 }).catch(() => false))) return;
  await question.fill("隔夜菜在冰箱里放一天，还能吃吗？");
  await page.getByRole("button", { name: "发送追问" }).click();
  await page.locator('[data-gp-phase="complete"]').first().waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});
  const followPhase = await waitForFinish();
  await shot("5-follow-up");
  if (!record("follow-up completes", followPhase === "complete", `phase=${followPhase}`)) return;
  record("follow-up starts exactly one more investigation", investigationPosts.length === 2, `posts=${investigationPosts.length}`);
  const rounds = page.getByRole("navigation", { name: "调查轮次" });
  const hasRounds = (await rounds.getByRole("button", { name: /首次核查/ }).count()) === 1
    && (await rounds.getByRole("button", { name: /第 2 轮/ }).count()) === 1;
  record("follow-up stays in the same investigation as round 2", hasRounds);
  if (hasRounds) {
    await rounds.getByRole("button", { name: /首次核查/ }).click();
    const earlier = (await page.locator("[data-gp-direct-answer]").first().innerText().catch(() => "")).trim();
    record("round 1 keeps its original conclusion", earlier === firstAnswer, earlier.slice(0, 80));
  }

  // The image is rendered at run time, so no binary fixture lives in the repo.
  const imagePath = `${out}/rumor-image.png`;
  const renderer = await browser.newPage({ viewport: { width: 900, height: 360 } });
  await renderer.setContent('<body style="margin:0;display:grid;place-items:center;height:100vh;background:#fff;font:600 44px sans-serif">网传：喝柠檬水能治愈癌症</body>');
  await renderer.screenshot({ path: imagePath });
  await renderer.close();

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').first().setInputFiles(imagePath);
  await page.getByRole("button", { name: "开始调查" }).click();
  const imagePhase = await waitForFinish();
  await shot("6-image");
  if (!record("image-only investigation completes", imagePhase === "complete", `phase=${imagePhase}`)) return;
  record("image investigation is one new request", investigationPosts.length === 3, `posts=${investigationPosts.length}`);
  const claimsText = (await page.locator("[data-gp-claim-id]").allInnerTexts().catch(() => [])).join(" ");
  record("claims come from the text in the image", claimsText.includes("柠檬"), claimsText.slice(0, 80));
}

try {
  const firstAnswer = await run();
  if (process.env.E2E_FULL === "1" && firstAnswer) await runFull(firstAnswer);
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
