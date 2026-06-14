import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const outFile = process.argv[3] || '/tmp/snap.png';
const action = process.argv[4] || 'none';  // none | click_recommended

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
});

await page.goto(url, { waitUntil: 'networkidle' });

if (action === 'click_recommended') {
  // 等 picker 加载
  const picker = page.getByLabel('4-Agent 模型选择');
  await picker.waitFor({ state: 'visible', timeout: 5000 });
  await picker.getByRole('button', { name: '推荐组合' }).click();
  await page.waitForTimeout(500);
}

await page.screenshot({ path: outFile, fullPage: true });

if (action === 'inspect') {
  const html = await page.locator('section[aria-label="4-Agent 模型选择"]').innerHTML();
  console.log('PICKER_HTML_BEGIN');
  console.log(html);
  console.log('PICKER_HTML_END');
}

if (errors.length > 0) {
  console.log('PAGE_ERRORS:');
  for (const e of errors) console.log(' - ' + e);
} else {
  console.log('NO_PAGE_ERRORS');
}
console.log('SCREENSHOT_SAVED:', outFile);
await browser.close();
