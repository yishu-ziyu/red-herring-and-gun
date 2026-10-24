// 在真实页面上检查：禁用字词、e2e 属性、悬停来源卡、依据展开、历史点开不发起核查。
// 运行：node scripts/verify.mjs（dev server 需在 5201）。
import { chromium } from "/Users/mahaoxuan/Desktop/AI-products/红鲱鱼/apps/node_modules/playwright/index.mjs";

const base = process.env.LAB_URL || "http://127.0.0.1:5201";
const FORBIDDEN = /截|检索通道|AnySearch|Metaso|秘塔|Tavily|MiniMax|minimax|StepFun|阶跃|DeepSeek|Kimi|OpenAI|Anthropic|Claude|GPT|Gemini|360 ?Search|Token Plan/;
const LABELS = ["属实", "基本属实", "部分属实", "夸大了", "不属实", "还查不清", "无法核对", "说法不一", "是观点，不分对错"];
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let posts = 0;
page.on("request", (r) => r.method() === "POST" && r.url().includes("/api/investigations") && !r.url().includes("/shares") && (posts += 1));

async function allText() {
  // 展开所有折叠后再取文字，连收起的内容一起查。
  return page.evaluate(() => document.body.innerText + "\n" + [...document.querySelectorAll("[data-state=closed]")].map((n) => n.textContent).join("\n"));
}

for (const path of ["/?part=home", "/?part=result&run=sun", "/?part=result&run=banana", "/?part=result&run=lemon-image", "/?part=share&run=banana", "/?part=history"]) {
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const text = await allText();
  const hit = text.match(FORBIDDEN);
  check(`no forbidden words on ${path}`, !hit, hit ? `found「${hit[0]}」 near: ${text.slice(Math.max(0, hit.index - 30), hit.index + 30).replace(/\n/g, " ")}` : "");
}

for (const run of ["sun", "lemon-image"]) {
  await page.goto(`${base}/?part=running&run=${run}`, { waitUntil: "load" });
  await page.getByRole("radio", { name: "32×" }).click();
  await page.locator('[data-gp-phase="complete"]').first().waitFor({ timeout: 120_000 });
  // 逐个点开步骤，右侧产出都查一遍。
  const steps = page.locator('[data-sidebar] button, [data-slot="sidebar"] button');
  const n = await steps.count();
  let bad = "";
  for (let i = 0; i < n; i += 1) {
    await steps.nth(i).click();
    await page.waitForTimeout(150);
    const text = await allText();
    const hit = text.match(FORBIDDEN);
    if (hit) bad = `step ${i}: 「${hit[0]}」 near ${text.slice(Math.max(0, hit.index - 30), hit.index + 30).replace(/\n/g, " ")}`;
  }
  check(`running ${run}: replay reaches complete, ${n} steps, no forbidden words`, !bad && n > 0, bad);
}

await page.goto(`${base}/?part=result&run=sun`, { waitUntil: "load" });
const answer = page.locator("[data-gp-direct-answer]").first();
const label = (await answer.locator("[data-gp-conclusion-label]").textContent()).trim();
const reason = (await answer.locator("[data-gp-conclusion-reason]").textContent()).trim();
check("conclusion label + reason", LABELS.includes(label) && reason.length > 0, `${label}｜${reason.slice(0, 40)}`);
const parts = await page.locator("[data-gp-result] article[data-gp-claim-id]").evaluateAll((nodes) =>
  nodes.map((node) => ({
    labels: [...node.querySelectorAll("[data-gp-claim-label]")].map((el) => el.textContent.trim()),
    reason: node.querySelector("[data-gp-claim-reason]")?.textContent?.trim() ?? "",
    rows: [...node.querySelectorAll("[data-gp-evidence-row]")].map((row) => ({ role: row.getAttribute("data-gp-role"), href: row.querySelector("a[href]")?.getAttribute("href") ?? "" })),
  }))
);
check(
  "every part: one label, a reason, a support/contradict row with a link",
  parts.length > 0 && parts.every((p) => p.labels.length === 1 && LABELS.includes(p.labels[0]) && p.reason && p.rows.some((r) => ["support", "contradict"].includes(r.role) && /^https?:\/\//.test(r.href))),
  parts.map((p) => `${p.labels.join("/")}:${p.rows.length}`).join(" ")
);
await page.locator("button[data-cite]").first().hover();
const card = page.locator('[data-slot="hover-card-content"]').first();
await card.waitFor({ timeout: 5000 }).catch(() => {});
check("hovering [1] shows a source card", await card.isVisible().catch(() => false), (await card.textContent().catch(() => ""))?.slice(0, 60));
await page.mouse.move(0, 0);
const why = page.getByRole("button", { name: "为什么算支持" }).first();
await why.click();
const whyText = await why.locator("xpath=../..").innerText();
check("「为什么算支持」 expands with a reason", whyText.length > 20, whyText.replace(/\n/g, " ").slice(0, 80));
check("derivation sentence present", (await page.getByText("怎么推出来的").count()) === 1);

const sharePreview = await (async () => {
  await page.goto(`${base}/?part=share&run=sun`, { waitUntil: "load" });
  return (await page.locator("[data-share-conclusion]").first().innerText()).replace(/\s+/g, "");
})();
check("share page conclusion equals result conclusion", sharePreview === (label + reason).replace(/\s+/g, ""), sharePreview.slice(0, 40));

await page.goto(`${base}/?part=home`, { waitUntil: "load" });
await page.getByRole("button", { name: "历史记录" }).click();
const dialog = page.getByRole("dialog");
await dialog.getByText("香蕉和红薯", { exact: false }).first().click();
await page.locator("[data-gp-direct-answer]").first().waitFor({ timeout: 10_000 });
check("history entry opens the result", page.url().includes("part=result&run=banana"), page.url());
check("no investigation POST in the whole check", posts === 0, `posts=${posts}`);

await page.setViewportSize({ width: 390, height: 844 });
for (const path of ["/?part=home", "/?part=running&run=sun", "/?part=result&run=sun", "/?part=share&run=banana"]) {
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`390px: no horizontal overflow on ${path}`, overflow <= 0, `overflow=${overflow}px`);
}

await browser.close();
console.log(results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
