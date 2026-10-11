#!/usr/bin/env node
/**
 * Real end-to-end check of the main user path: real browser, real server, real models and search.
 * Needs the app running (`npm run dev`) with real keys in apps/.env.local. One run takes about 7 minutes.
 * The main run also shares the finished round, opens the link in a cookie-less context, revokes it and opens it again.
 * It saves full-page screenshots of the finished result at 1440 and 390 px width (result-1440.png, result-390.png).
 * Do not edit server files during a run: the dev server restarts on save and kills the investigation.
 * E2E_FULL=1 also checks a follow-up question and an image-only investigation (about 20 minutes in total).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync } from "node:fs";
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
// Labels that claim the sources decided the part, so the part must show at least one supporting or contradicting row.
const DECISIVE_LABELS = ["属实", "基本属实", "部分属实", "夸大了", "不属实", "说法不一"];
// Blocks removed from the result page in #141. Their words must not come back.
const DELETED_BLOCKS = ["查看已有依据", "继续补查", "本轮核查范围", "调查案卷", "收集到的来源"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const started = Date.now();
const shown = { conclusionLabel: "", partLabels: [] };
const checks = [];
// 临时开发面板按每个真实检查更新；不写运行日志或模型内容。
function updatePanel(name, pass) {
  const file = process.env.E2E_PANEL_FILE;
  if (!file) return;
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    const now = new Date().toISOString();
    state.updatedAt = now;
    state.e2e = { title: process.env.E2E_REPLAY_FILE ? "真实材料展示回放" : process.env.E2E_SCENARIO ? "取消和截断边界" : "真实端到端主路径", status: "运行中", detail: `${pass ? "通过" : "失败"}：${name}` };
    state.logs.push({ at: now, text: `${pass ? "通过" : "失败"}：${name}` });
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${file}.tmp`, file);
  } catch { /* 面板不可用不改变产品验收结果。 */ }
}
const record = (name, pass, detail) => {
  checks.push({ name, pass, detail, atSeconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  updatePanel(name, pass);
  return pass;
};

// Always headless (no window steals focus); every run is recorded to run.webm in the evidence folder.
const browser = await chromium.launch();
const viewport = { width: 1440, height: 900 };
const context = await browser.newContext({ viewport, recordVideo: { dir: out, size: viewport } });
const page = await context.newPage();
const investigationPosts = [];
let materialRows = [];
let snapshotReady = Promise.resolve(null);
let firstSnapshot = null;
page.on("response", (res) => {
  if (res.request().method() !== "POST" || !res.url().includes("/api/agent/orchestrate-stream")) return;
  snapshotReady = res.text().then((body) => {
    let snapshot = null;
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const event = JSON.parse(line.slice(5));
        if (event.type === "investigation_snapshot") snapshot = event.investigation;
      } catch { /* 非 JSON 帧不作为验收材料。 */ }
    }
    return snapshot;
  }).catch(() => null);
});
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/agent/orchestrate-stream")) investigationPosts.push(req.url());
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, animations: "disabled" });
const finished = () => page.locator('[data-gp-phase="complete"], [data-gp-phase="interrupted"], [data-gp-phase="stopped"]').first();
async function waitForFinish() {
  await finished().waitFor({ timeout: timeoutMs }).catch(() => {});
  return finished().getAttribute("data-gp-phase").catch(() => null);
}

async function run() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const editor = page.locator("[contenteditable=true], textarea").first();
  if (!record("home shows the input", await editor.isVisible())) return;
  // #141 part b: the hand-written case cards (fake sources) are gone from the home page.
  const homeText = await page.locator("body").innerText().catch(() => "");
  record("home shows no hand-written case cards", !homeText.includes("已完成的调查案例"), "");

  await editor.click();
  await page.keyboard.type(claim);
  await page.getByRole("button", { name: "开始调查" }).click();
  await shot("1-submitted");

  // #150: while it runs, the parts appear one by one under a plain status line; no roles or execution log (PRODUCT bottom line 1).
  const partShown = await page.locator("[data-gp-progress-claim]").first().waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
  if (partShown) {
    await shot("1b-in-progress");
    const status = (await page.locator("[data-gp-progress-status]").first().innerText().catch(() => "")).trim();
    const processNodes = await page.locator(".gp-canvas .gp-roles, .gp-canvas .gp-activity, .gp-canvas .gp-thinking-box").count();
    record("while running, parts show under a plain status line and no roles or execution log", status.length > 0 && processNodes === 0, `status=${status} processNodes=${processNodes}`);
  } else {
    record("while running, parts show under a plain status line and no roles or execution log", false, "no part appeared within 90s");
  }

  const phase = await waitForFinish();
  await shot("2-finished");
  if (!record("investigation completes", phase === "complete", `phase=${phase}`)) return;
  firstSnapshot = await snapshotReady;
  record("captured snapshot preserves the original Chinese input", firstSnapshot?.originalClaim === claim, "");
  record("exactly one investigation request", investigationPosts.length === 1, `posts=${investigationPosts.length}`);

  const answer = (await page.locator("[data-gp-direct-answer]").first().innerText().catch(() => "")).trim();
  record("conclusion answers the claim", answer.length > 0, answer.slice(0, 80));
  await checkLabels();
  await checkOriginalSentence();

  await checkResultLayout();
  await checkDatesAndQuoteLinks();
  await checkMaterialDisplay();
  await checkMobileWidth();

  await checkShare(answer);

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
  await checkMaterialDisplay();
  const snapshot = await snapshotReady;
  if (snapshot) {
    writeFileSync(`${out}/investigation.json`, JSON.stringify(snapshot, null, 2));
    firstSnapshot = snapshot;
  } else record("real investigation snapshot is retained for boundary checks", false, "no snapshot");
  return answer;
}

const traceEvents = () => {
  const file = process.env.E2E_SOURCE_TRACE_FILE;
  return file && existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
};

async function submitBoundary() {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("[contenteditable=true], textarea").first().fill(claim);
  await page.getByRole("button", { name: "开始调查" }).click();
  await shot("1-submitted");
}

async function checkStoppedMaterial(sourceId, passage) {
  const rows = page.locator(`[data-gp-evidence-row][data-gp-source-id="${sourceId}"]`);
  const row = rows.first();
  const visible = await row.isVisible().catch(() => false);
  record("停止后已读正文可查看，且仍标为尚未核对", visible && (await row.innerText()).includes("尚未核对") && await row.getAttribute("data-gp-material-kind") === "page-excerpt");
  if (visible) {
    await row.locator("summary").click();
    record("停止后的材料原地展开", await row.locator("[data-gp-material-text]").isVisible());
    record("停止和回看保留同一份材料文字", (await row.locator("[data-gp-material-text]").textContent()).trim() === passage);
    await shot("3-stopped-material");
  }
  record("停止后没有进行中状态或整句最终判定", await page.locator("[data-gp-progress-status], [data-gp-direct-answer], [data-gp-result]").count() === 0 && (await page.locator(".gp-announcer").innerText()).trim() === "" && await page.locator('[data-gp-stop-state="stopped"]').count() === 1);
}

async function runCancellation() {
  const before = traceEvents().length;
  await submitBoundary();
  let read;
  let pendingUrl;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const events = traceEvents().slice(before);
    read = events.find((e) => e.event === "source-read-finished" && e.eligible);
    pendingUrl = events.find((e) => e.event === "source-paced" && e.url !== read?.url && !events.some((done) => done.event === "source-read-finished" && done.url === e.url))?.url;
    if (read && pendingUrl) break;
    if (await finished().count()) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!record("真实正文已读完一份，另一份仍在读取", Boolean(read) && Boolean(pendingUrl))) return;
  const runId = await page.evaluate(() => JSON.parse(localStorage.getItem("rhg:active-run"))?.runId);
  const beforeState = await context.request.get(new URL(`/api/investigations/${runId}`, baseUrl).href).then((response) => response.json());
  writeFileSync(`${out}/before-stop.json`, JSON.stringify(beforeState, null, 2));
  const priorSource = beforeState.snapshot?.sources.find((s) => s.url === read.url);
  const priorPassage = beforeState.snapshot?.claims.flatMap((c) => c.evidence).find((l) => l.sourceId === priorSource?.id)?.passage;
  const cancelRequest = page.waitForRequest((req) => req.method() === "POST" && /\/api\/investigations\/[^/]+\/cancel$/.test(new URL(req.url()).pathname));
  const stopAt = Date.now();
  await page.getByRole("button", { name: "停止调查", exact: true }).click();
  const request = await cancelRequest;
  const runUrl = request.url().replace(/\/cancel$/, "");
  await page.locator('[data-gp-stop-state="stopped"]').waitFor({ timeout: 30000 });
  firstSnapshot = await snapshotReady;
  const state = await context.request.get(runUrl).then((response) => response.json());
  writeFileSync(`${out}/run-state.json`, JSON.stringify(state, null, 2));
  if (firstSnapshot) writeFileSync(`${out}/investigation.json`, JSON.stringify(firstSnapshot, null, 2));
  record("服务端确认取消，快照不是完成态", state.status === "cancelled" && firstSnapshot?.phase === "interrupted");
  const source = firstSnapshot?.sources.find((s) => s.url === read.url);
  record("取消保留此前实际读完的正文", source?.excerptKind === "page-excerpt" && ["fetched", "truncated"].includes(source?.fetchStatus) && priorSource?.excerpt === source.excerpt && Boolean(priorPassage), source?.fetchStatus ?? "missing");
  const events = traceEvents().slice(before);
  record("取消会中止未完成读取，且不启动后续模型", !events.some((e) => e.event === "source-read-finished" && e.url === pendingUrl && e.at < stopAt) && events.some((e) => e.event === "source-abort" && e.url === pendingUrl && e.at >= stopAt) && events.filter((e) => e.event === "model-start").length >= 2 && !events.some((e) => e.event === "model-start" && e.at >= stopAt));
  if (source) await checkStoppedMaterial(source.id, priorPassage);
  await page.locator('[data-gp-save-status="local"]').waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "历史记录" }).click();
  await page.getByRole("dialog").getByText(claim, { exact: false }).first().click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "历史记录" }).click();
  await page.getByRole("dialog").getByText(claim, { exact: false }).first().click();
  if (source) await checkStoppedMaterial(source.id, priorPassage);
  record("刷新和历史回看不重开调查", investigationPosts.length === 1 && !traceEvents().slice(before).some((e) => e.event === "model-start" && e.at >= stopAt));
}

async function runTruncation() {
  const url = process.env.E2E_SOURCE_LIMIT_URL;
  const limit = Number(process.env.E2E_SOURCE_LIMIT_CHARS);
  if (!url || !Number.isInteger(limit)) throw new Error("缺少真实截断网页与读取上限");
  const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  const body = text.split("Markdown Content:").slice(1).join("Markdown Content:").trim();
  const turningPoint = process.env.E2E_SOURCE_TURNING_POINT || "隔夜菜如果保存得当，其实是可以食用的";
  if (!record("真实原文的关键限定确实位于读取上限之外", response.ok && body.indexOf(turningPoint) > limit, `limit=${limit} turningPoint=${body.indexOf(turningPoint)}`)) return;
  await submitBoundary();
  if (!record("截断场景完成真实调查", await waitForFinish() === "complete")) return;
  firstSnapshot = await snapshotReady;
  if (firstSnapshot) writeFileSync(`${out}/investigation.json`, JSON.stringify(firstSnapshot, null, 2));
  const source = firstSnapshot?.sources.find((s) => s.url === url);
  if (!record("指定真实网页实际取得的正文被截断", source?.fetchStatus === "truncated" && source?.excerptKind === "page-excerpt", source?.fetchStatus ?? "not selected")) return;
  const links = firstSnapshot.claims.flatMap((c) => c.evidence.filter((l) => l.sourceId === source.id));
  record("未读取的关键限定没有混入已取得材料", links.length > 0 && links.every((l) => l.passage && !l.passage.includes(turningPoint)));
  record("截断材料不能充当支持或反驳", links.length > 0 && links.every((l) => l.role === "context-only"), links.map((l) => l.role).join("/"));
  // 若其他来源足够，仍可判断；任何明确判断都必须另有非截断方向性依据。
  const hasOtherEvidence = (c) => c.evidence.some((l) => ["support", "contradict"].includes(l.role) && firstSnapshot.sources.find((s) => s.id === l.sourceId)?.fetchStatus !== "truncated");
  const decisive = (c) => ["supported", "refuted", "mixed"].includes(c.judgment);
  record("其他有效依据仍可形成明确判断", firstSnapshot.claims.some((c) => hasOtherEvidence(c) && decisive(c)) && firstSnapshot.claims.every((c) => !decisive(c) || hasOtherEvidence(c)));
  const row = page.locator(`[data-gp-evidence-row][data-gp-source-id="${source.id}"]`).first();
  const related = row.locator("xpath=ancestor::details[@data-gp-related]");
  if (await related.count()) await related.locator("summary").first().click();
  const visible = await row.isVisible().catch(() => false);
  record("截断材料保留读取限制与查看入口", visible && (await row.innerText()).includes("只取得部分正文") && (await row.innerText()).includes("未读"));
  if (visible) {
    await row.locator("summary").click();
    record("截断材料可原地展开检查", await row.locator("[data-gp-material-text]").isVisible());
    await shot("3-truncated-material");
  }
  record("截断场景只启动一轮调查", investigationPosts.length === 1);
}

async function checkMaterialDisplay() {
  const rows = page.locator("[data-gp-evidence-row]");
  const states = await rows.evaluateAll((nodes) => nodes.map((node) => ({
    sourceId: node.getAttribute("data-gp-source-id"),
    role: node.getAttribute("data-gp-role"),
    kind: node.getAttribute("data-gp-material-kind"),
    status: node.querySelector("[data-gp-material-status]")?.textContent?.trim() ?? "",
    quote: node.querySelector("[data-gp-evidence-quote]")?.textContent?.trim() ?? "",
    summary: node.querySelector("[data-gp-evidence-summary]")?.textContent ?? "",
    passage: node.querySelector("[data-gp-material-text]")?.textContent?.trim() ?? "",
    href: node.querySelector("a[href]")?.getAttribute("href") ?? "",
  })));
  materialRows = states;
  record("each evidence row distinguishes its material and read status", states.length > 0 && states.every((s) => ["search-snippet", "page-excerpt", "unknown"].includes(s.kind) && s.status.startsWith("资料状态：")), `rows=${states.length}`);
  record("quotes stay in inspectable material; summaries are labelled", states.every((s) => (!s.quote || s.passage.includes(s.quote)) && (!s.summary || s.summary.includes("我们的概括"))), "");
  record("only body quotes get a text-fragment link", states.every((s) => !s.href.includes(":~:text=") || s.kind === "page-excerpt"), "");
  record("a decisive body quote has inspectable context", states.some((s) => ["support", "contradict"].includes(s.role) && s.kind === "page-excerpt" && s.quote && s.passage.includes(s.quote)), "");
  const statusTerms = { "snippet-only": "尚未读取正文", fetched: "已取得可访问的正文", truncated: "只取得部分正文", restricted: "正文访问受限", failed: "正文读取失败" };
  record("read status matches the actual source metadata", Boolean(firstSnapshot) && states.every((row) => {
    const source = firstSnapshot.sources.find((source) => source.id === row.sourceId);
    const expected = statusTerms[source?.fetchStatus] ?? "正文读取情况未知";
    return row.status.includes(expected) && (!source?.fetchNote || row.status.includes(source.fetchNote));
  }), "");
  await rows.first().locator("summary").click();
  record("material expands in place", await rows.first().locator("[data-gp-material-text]").isVisible().catch(() => false), "");
  await shot("2c-material-expanded");
  await rows.first().locator("summary").click();
}

// 用本轮真实快照只删定位/读取元信息；不重新调用模型，不把改写快照当新的核查结果。
async function checkMissingMetadata(snapshot) {
  const postsBefore = investigationPosts.length;
  const missing = structuredClone(snapshot);
  for (const part of missing.claims) {
    delete part.originalSpan;
    for (const link of part.evidence) delete link.excerptKind;
  }
  for (const source of missing.sources) {
    delete source.fetchStatus;
    delete source.excerptKind;
    delete source.retrievedAt;
  }
  await page.addInitScript((snapshot) => { window.__RHG_REPLAY = { frames: [{ delayMs: 20, investigation: snapshot, complete: true }] }; }, missing);
  await page.goto(new URL("?fixture=replay", baseUrl).href);
  await page.locator("[data-gp-unspanned-parts]").waitFor({ timeout: 10000 });
  const note = await page.locator("[data-gp-unspanned-parts]").innerText();
  record("deleting spans does not say the user omitted the words", note.includes("暂未可靠定位") && !note.includes("原句没有直接写出"), "");
  const status = await page.locator("[data-gp-material-status]").allTextContents();
  record("missing read metadata stays unknown", status.length > 0 && status.every((s) => s.includes("正文读取情况未知")), "");
  await shot("7-metadata-missing");
  record("boundary display does not start another investigation", investigationPosts.length === postsBefore, `posts=${investigationPosts.length}`);
}

// A conclusion reason is one sentence of at most 80 characters, without internal terms,
// and names no judgment other than its own label (2026-10-10: label 不属实 with reason 「整句为部分属实」).
// A part's label right after its quoted text (「…」还查不清) is that part's judgment, not a contradiction.
function reasonProblems(reason, label) {
  const problems = [];
  if (reason.split(/[。！？]/).filter((x) => x.trim()).length !== 1) problems.push("not one sentence");
  if (reason.length > 81) problems.push("too long");
  if (/原子|命题|判定为|判词|整句为|整句是/.test(reason)) problems.push("internal terms");
  if (/部分属实|基本属实|不属实|属实|夸大|还查不清|无法核对|说法不一|是观点/.test(reason.replace(/」(部分属实|基本属实|不属实|属实|夸大了|还查不清|无法核对|说法不一|是观点，不分对错)/g, "」").split(label).join(""))) problems.push("other judgment word");
  return problems;
}

// Every claim part shows one label and a reason; the conclusion starts with a label and a reason; no old label words.
// #141 part b: the original sentence is shown with each part underlined; a part without a span in the
// sentence is listed under it. Every part must appear one way or the other.
async function checkOriginalSentence() {
  const sentence = (await page.locator("[data-gp-original-sentence]").first().innerText().catch(() => "")).replace(/[“”"\s①②③④⑤⑥⑦⑧⑨⑩]/g, "");
  const partCount = await page.locator("article[data-gp-claim-id]").count();
  const spanned = await page.locator("[data-gp-original-sentence] [data-gp-span-part]").evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-gp-span-part")));
  const unspanned = (await page.locator("[data-gp-unspanned-parts]").first().innerText().catch(() => ""));
  const listed = (unspanned.match(/[①②③④⑤⑥⑦⑧⑨⑩]/g) ?? []).length;
  record(
    "original sentence shows every part, underlined or listed",
    sentence.includes(claim.replace(/\s/g, "")) && partCount > 0 && spanned.length + listed >= partCount,
    `parts=${partCount} underlined=${spanned.join(",")} listed=${listed}`
  );
}

async function checkLabels() {
  const parts = await page.locator("article[data-gp-claim-id]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.querySelector("[data-gp-part-text]")?.textContent?.trim() ?? "",
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
  // The default claim is a debunked rumor. On 2026-10-10 a run decomposed 「会致癌」 into the weaker 「会产生致癌物」
  // and the page said 属实. A different E2E_CLAIM skips this check.
  if (!process.env.E2E_CLAIM) {
    record("the debunked default claim is not judged true", !["属实", "基本属实"].includes(conclusionLabel), conclusionLabel);
  }
  record(
    "conclusion starts with one of the 9 labels and a reason",
    LABELS.includes(conclusionLabel) && leadText.startsWith(conclusionLabel) && conclusionReason.length > 0,
    `${conclusionLabel || "NO LABEL"}｜${conclusionReason.slice(0, 100) || "NO REASON"}`
  );
  record(
    "conclusion reason is one short sentence that does not contradict the label",
    reasonProblems(conclusionReason, conclusionLabel).length === 0,
    `${reasonProblems(conclusionReason, conclusionLabel).join(",")}｜${conclusionReason.slice(0, 100)}`
  );
  // An old label renders as its own element (a chip or a heading), so look for elements whose whole text is
  // an old word. Whole-page substring search failed on source quotes that happen to say 「有争议」.
  // textContent, not innerText: elements that are rendered but folded still count.
  const oldHits = await page.evaluate((words) => {
    const norm = (t) => (t ?? "").replace(/[\s·:：|｜,，。]/g, "");
    return [...document.body.querySelectorAll("*")]
      .filter((el) => !["SCRIPT", "STYLE"].includes(el.tagName) && words.includes(norm(el.textContent)))
      .map((el) => `${norm(el.textContent)} <${el.tagName.toLowerCase()} class="${el.className}">`);
  }, OLD_LABELS).catch(() => []);
  record("result page shows none of the 6 old label words", oldHits.length === 0, oldHits.join(" ‖ "));
}

// #141: the result page is conclusion, part cards with their evidence, and three actions. Nothing else.
async function checkResultLayout() {
  const pageText = (await page.locator("body").textContent().catch(() => "")) ?? "";
  const leftovers = DELETED_BLOCKS.filter((word) => pageText.includes(word));
  const oldNodes = await page.locator("[data-gp-source-pill], [data-gp-dossier], [data-gp-scope], [data-gp-key-evidence], [role=dialog]").count();
  record("deleted blocks are absent (查看已有依据, 继续补查, 本轮核查范围, 调查案卷, 收集到的来源)", leftovers.length === 0 && oldNodes === 0, `words=${leftovers.join("/")} nodes=${oldNodes}`);

  const parts = await page.locator("[data-gp-result] article[data-gp-claim-id]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.querySelector("[data-gp-part-text]")?.textContent?.trim() ?? "",
      label: node.querySelector("[data-gp-claim-label]")?.textContent?.trim() ?? "",
      rows: [...node.querySelectorAll("[data-gp-evidence-row]")].map((row) => ({
        role: row.getAttribute("data-gp-role"),
        href: row.querySelector("a[href]")?.getAttribute("href") ?? "",
        date: row.querySelector("[data-gp-published]")?.textContent?.trim() ?? "",
      })),
    }))
  );
  const rows = parts.flatMap((p) => p.rows);
  const badRows = rows.filter((r) => !/^https?:\/\//.test(r.href) || !(DATE.test(r.date) || r.date === "发布日期未取到"));
  const bareParts = parts.filter((p) => DECISIVE_LABELS.includes(p.label) && !p.rows.some((row) => ["support", "contradict"].includes(row.role)));
  record(
    "each part card shows its evidence rows with a link to the page and a date",
    parts.length > 0 && rows.length > 0 && badRows.length === 0 && bareParts.length === 0,
    `rows per part ${parts.map((p) => `${p.label}:${p.rows.length}`).join(" ")}; bad rows ${badRows.length}; decisive parts without a row: ${bareParts.map((p) => p.text.slice(0, 20)).join("/") || "none"}`
  );

  const buttons = await page.locator("[data-gp-result] button").evaluateAll((nodes) =>
    nodes.filter((n) => n.getClientRects().length > 0).map((n) => n.textContent.trim()));
  const fields = await page.locator("[data-gp-result] textarea, [data-gp-result] input").count();
  const ask = await page.locator("[data-gp-result]").getByPlaceholder(/针对这份调查继续问/).count();
  record(
    "result actions are exactly the 追问 input, 分享 and 新调查",
    JSON.stringify(buttons) === JSON.stringify(["追问", "分享", "新调查"]) && fields === 1 && ask === 1,
    `buttons=${buttons.join("/")} fields=${fields}`
  );
  await page.screenshot({ path: `${out}/result-1440.png`, fullPage: true, animations: "disabled" });
}

// #140: every evidence row shows a publish date or says it is missing; some source has a real date;
// the link on a quoted evidence row jumps to a sentence of that quote.
async function checkDatesAndQuoteLinks() {
  const rows = await page.locator("[data-gp-evidence-row]").evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("[data-gp-published]")?.textContent?.trim() ?? "NO DATE"));
  const bad = rows.filter((text) => !DATE.test(text) && text !== "发布日期未取到");
  record("every evidence row shows a publish date or 发布日期未取到", rows.length > 0 && bad.length === 0, `rows=${rows.length} bad=${bad.join("/")}`);
  const days = await page.locator("[data-gp-result] [data-gp-published]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-gp-published") ?? ""));
  const dated = days.filter((day) => DATE.test(day)).length;
  record("at least one source has a real publish date", dated > 0, `dated ${dated}/${days.length}`);

  const quoted = await page.locator("[data-gp-evidence-row]:has([data-gp-evidence-quote])").evaluateAll((nodes) =>
    nodes.map((node) => ({
      quote: node.querySelector("[data-gp-evidence-quote]")?.textContent ?? "",
      href: node.querySelector("a[href]")?.getAttribute("href") ?? "",
    })));
  // #141 part c: a quoted row shows one sentence from the source, not a paragraph.
  const notOneSentence = quoted.filter(({ quote }) => {
    const text = quote.trim();
    return !text || text.length > 100 || /…|\.\.\./.test(text) || /[。！？!?]/.test(text.slice(0, -1));
  });
  record("at least one evidence row shows a quote checked against its material", quoted.length > 0, `quoted ${quoted.length}`);
  record(
    "every quoted evidence row shows one sentence of at most 100 characters",
    notOneSentence.length === 0,
    `quoted ${quoted.length}; bad: ${notOneSentence.map((q) => `${q.quote.length}字 ${q.quote.slice(0, 30)}`).join(" ‖ ") || "none"}`
  );
  const tried = [];
  let hit = null;
  for (const { quote, href } of quoted) {
    const at = href.indexOf("#:~:text=");
    const text = at >= 0 ? decodeURIComponent(href.slice(at + 9)) : "";
    tried.push(text || href.slice(0, 60));
    if (text && quote.includes(text)) { hit = href; break; }
  }
  const bodyRows = await page.locator('[data-gp-material-kind="page-excerpt"]:has([data-gp-evidence-quote])').count();
  record("body quotes use a locator; snippets do not imply a body locator", bodyRows === 0 || Boolean(hit), `body quotes=${bodyRows}`);
}

// #141: the phone layout must not scroll sideways.
async function checkMobileWidth() {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const size = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    view: document.documentElement.clientWidth,
  }));
  await page.screenshot({ path: `${out}/result-390.png`, fullPage: true, animations: "disabled" });
  record("at 390px width the result page has no horizontal scroll", Math.max(size.doc, size.body) <= size.view, JSON.stringify(size));
  await page.setViewportSize(viewport);
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
    const sharedStatus = await viewer.locator("[data-share-material-status]").allTextContents();
    const sharedMaterials = await viewer.locator("[data-share-material-kind]").evaluateAll((nodes) => nodes.map((node) => ({
      sourceId: node.getAttribute("data-share-source-id"), role: node.getAttribute("data-share-role"), kind: node.getAttribute("data-share-material-kind"),
      status: node.querySelector("[data-share-material-status]")?.textContent ?? "",
    })));
    record("share preserves material read limits", materialRows.length > 0 && materialRows.every((row) => sharedMaterials.some((shared) => shared.sourceId === row.sourceId && shared.role === row.role && shared.kind === row.kind && normalize(shared.status) === normalize(row.status))), `rows=${sharedStatus.length}`);
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
  const question = page.getByPlaceholder(/针对这份调查继续问/);
  if (!record("follow-up box is shown", await question.isVisible({ timeout: 10_000 }).catch(() => false))) return;
  await question.fill("隔夜菜在冰箱里放一天，还能吃吗？");
  await page.getByRole("button", { name: "追问", exact: true }).click();
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
    const roundParts = await page.locator("[data-gp-result] article[data-gp-claim-id]").count();
    const roundButtons = await page.locator("[data-gp-result] button").allTextContents();
    record(
      "round 1 uses the same result layout, without the 追问 input",
      roundParts > 0 && JSON.stringify(roundButtons.map((t) => t.trim())) === JSON.stringify(["分享", "新调查"]),
      `parts=${roundParts} buttons=${roundButtons.join("/")}`
    );
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
  if (process.env.E2E_SCENARIO === "cancel") {
    await runCancellation();
  } else if (process.env.E2E_SCENARIO === "truncate") {
    await runTruncation();
  } else if (process.env.E2E_REPLAY_FILE) {
    firstSnapshot = JSON.parse(readFileSync(process.env.E2E_REPLAY_FILE, "utf8"));
    await page.addInitScript((snapshot) => { window.__RHG_REPLAY = { frames: [{ delayMs: 20, investigation: snapshot, complete: true }] }; }, firstSnapshot);
    await page.goto(new URL("?fixture=replay", baseUrl).href);
    if (firstSnapshot.interruptionReason === "cancelled") {
      await page.locator('[data-gp-stop-state="stopped"]').waitFor({ timeout: 10000 });
      const source = firstSnapshot.sources.find((s) => s.excerptKind === "page-excerpt");
      const link = firstSnapshot.claims.flatMap((c) => c.evidence).find((l) => l.sourceId === source?.id);
      if (!source || !link?.passage) throw new Error("停止回放缺少此前实际取得的正文");
      await checkStoppedMaterial(source.id, link.passage);
      record("停止材料展示回放不启动新调查", investigationPosts.length === 0);
    } else {
      await page.locator("[data-gp-evidence-row]").first().waitFor({ timeout: 10000 });
      await checkMaterialDisplay();
    }
  } else {
    const firstAnswer = await run();
    if (process.env.E2E_FULL === "1" && firstAnswer) await runFull(firstAnswer);
    if (firstSnapshot) await checkMissingMetadata(firstSnapshot);
  }
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
const result = { pass, mode: process.env.E2E_REPLAY_FILE ? "real-material-display-replay" : "real-end-to-end", claim, baseUrl, seconds: Math.round((Date.now() - started) / 1000), checks };
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(`${pass ? "E2E PASSED" : "E2E FAILED"} in ${result.seconds}s — evidence: ${out}`);
process.exit(pass ? 0 : 1);
