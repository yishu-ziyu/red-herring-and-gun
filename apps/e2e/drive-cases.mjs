// 浏览器驱动：由 e2e.mjs 在开头注入 `const CONFIG = {...}` 后交给 `ego-browser nodejs` 执行。
// 每条说法：打开首页 → 提交 → 等结果页 → 存整页截图与页面、报告数据。
const fs = await import("node:fs/promises");
const { baseUrl, casesFile, outDir, workers, spaceName } = CONFIG;
await fs.mkdir(outDir, { recursive: true });
const cases = JSON.parse(await fs.readFile(casesFile, "utf8"));
const done = new Set((await fs.readdir(outDir)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
const queue = cases.filter((c) => !done.has(c.id));
const task = await taskSpace(spaceName);
console.log(JSON.stringify({ event: "start", space: task.spaceId, todo: queue.length }));
const pages = [task.page("p1")];
for (let i = 1; i < workers; i++) pages.push(await task.newPage());

async function openHomeReady(page, claim) {
  // 服务检查偶尔很慢；按钮一直不可点时每分钟重试一次，最多 12 次。
  for (let attempt = 0; attempt < 13; attempt++) {
    if (attempt > 0) await page.waitForTimeout(60000);
    await page.goto(`${baseUrl}/`);
    await page.waitForFunction(() => document.querySelector("[role=textbox], textarea") && !document.body.innerText.includes("正在确认调查服务"), undefined, { timeout: 180000 });
    await page.fill("loc=role:textbox[name='要调查的说法']", claim);
    const ready = await page.waitForFunction(() => !document.querySelector('button[aria-label="开始调查"]').disabled, undefined, { timeout: 15000 }).then(() => true, () => false);
    if (ready) return attempt;
  }
  throw new Error("提交按钮 12 分钟内一直不可用");
}

async function runOne(page, c) {
  const t0 = Date.now();
  const retries = await openHomeReady(page, c.claim);
  await page.click('loc=css:button[aria-label="开始调查"]', { label: `start ${c.id}` });
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => document.body.innerText.includes("这条说法查过"))) {
    await page.click('text="重新核查"', { label: "recheck" });
  }
  await page.waitForSelector(".gp-canvas", { timeout: 60000 });
  let state = "timeout";
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(5000);
    state = await page.evaluate(() => {
      if (document.querySelector(".gp-hero")) return "complete";
      if (document.querySelector("[data-gp-stopped][data-gp-stop-state=stopped]")) return "stopped";
      return document.querySelector(".gp-canvas")?.dataset.gpPhase === "interrupted" ? "interrupted" : "running";
    });
    if (state !== "running") break;
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${outDir}/${c.id}.png`, fullPage: true });
  const page_ = await page.evaluate((claim) => {
    const raw = JSON.parse(localStorage.getItem("red-herring-knowledge-cases:v2:anonymous") || "[]");
    const list = Array.isArray(raw) ? raw : raw.cases ?? Object.values(raw);
    const stored = list.filter((x) => x.claim === claim).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
    const hero = document.querySelector(".gp-hero");
    return {
      heroText: hero?.innerText ?? null,
      badgeJudgment: hero?.getAttribute("data-gp-conclusion-judgment") ?? null,
      badgeText: hero?.querySelector("[data-gp-judgment]")?.textContent?.trim() ?? null,
      pageText: document.querySelector(".gp-canvas")?.innerText?.slice(0, 20000) ?? null,
      stored,
    };
  }, c.claim);
  const rec = { ...c, state, seconds: Math.round((Date.now() - t0) / 1000), serviceRetries: retries, ranAt: new Date().toISOString(), ...page_ };
  await fs.writeFile(`${outDir}/${c.id}.json`, JSON.stringify(rec, null, 1));
  console.log(JSON.stringify({ event: "case", id: c.id, state, seconds: rec.seconds, verdict: page_.stored?.finalReport?.verdictType ?? null }));
}

let next = 0;
await Promise.all(pages.map(async (page) => {
  while (next < queue.length) {
    const c = queue[next++];
    try { await runOne(page, c); }
    catch (error) {
      console.log(JSON.stringify({ event: "error", id: c.id, message: String(error).slice(0, 300) }));
      await page.screenshot({ path: `${outDir}/${c.id}.error.png` }).catch(() => {});
    }
  }
}));
await task.finish({ keep: [] });
console.log(JSON.stringify({ event: "done" }));
