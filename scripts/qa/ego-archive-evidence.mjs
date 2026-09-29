// Run: ego-browser nodejs < scripts/qa/ego-archive-evidence.mjs
// Set these two values to the existing Ego TaskSpace and completed case Page.
const spaceId = 1;
const pageLabel = 'p3';
// Uses the ego-browser runtime; does not start an investigation or call a model.
const task = await taskSpace(spaceId);
const page = task.page(pageLabel);
const { default: assert } = await import('node:assert/strict');
console.log(await page.snapshot());
await page.evaluate(() => window.scrollTo(0, 0));
const result = await page.evaluate(() => ({
  phase: document.querySelector('[data-gp-phase]')?.getAttribute('data-gp-phase'),
  answer: document.querySelector('[data-gp-direct-answer]')?.textContent,
  answerTop: document.querySelector('[data-gp-direct-answer]')?.getBoundingClientRect().top,
  viewportHeight: window.innerHeight,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  internalWords: /wholeClaimAudit|missingJustifications/.test(document.querySelector('[aria-label="调查结论"]')?.textContent ?? ''),
}));
assert.equal(result.phase, 'complete');
assert.ok(result.answer?.trim());
assert.ok(result.answerTop >= 0 && result.answerTop < result.viewportHeight);
assert.ok(result.overflow <= 1);
assert.equal(result.internalWords, false);
await page.click('loc=css:[data-gp-key-evidence-item] >> nth=0');
await page.waitForSelector('[data-gp-source-section="excerpt"]', { state: 'visible' });
const source = await page.evaluate(() => ({
  label: document.querySelector('[data-gp-source-section="excerpt"] .gp-source-label')?.textContent,
  quote: document.querySelector('.gp-source-excerpt-text')?.textContent,
  href: document.querySelector('a.gp-source-open')?.getAttribute('href'),
}));
assert.equal(source.label, '原文摘录');
assert.ok(source.quote?.trim());
assert.equal(decodeURIComponent(source.href.split(':~:text=')[1]), source.quote.trim());
console.log({ result, source });
console.log(await page.snapshot());
