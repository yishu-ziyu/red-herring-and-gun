/** Run the exact browser evaluator against old production handlers; require actual three-path leakage. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const base = process.env.RHG_BASE_SHA;
if (!/^[a-f0-9]{40}$/.test(base || '')) throw new Error('RHG_BASE_SHA must be an exact commit SHA');
const paths = ['server/src/handlers.ts', 'server/src/http/publicStream.ts'];
const current = paths.map(path => readFileSync(path));
const out = resolve('../out/public-sse-browser/baseline');
let result;
try {
  paths.forEach(path => writeFileSync(path, execFileSync('git', ['show', `${base}:apps/${path}`])));
  result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/acceptance/vitest.browser.config.ts'], {
    stdio: 'inherit', env: { ...process.env, RHG_BROWSER_OUT: out }, timeout: 90000,
  });
} finally { paths.forEach((path, index) => writeFileSync(path, current[index])); }
if (result.error || result.status !== 1) throw new Error('Old evaluator did not fail normally');
const evidence = JSON.parse(readFileSync(resolve(out, 'failure.json'), 'utf8'));
if (evidence.pipelineCalls !== 1 || evidence.streams.length !== 3 || !evidence.streams.every(stream => stream.status === 200 && /INTERNAL_BROWSER_|RAW_BROWSER_/.test(stream.wire))) {
  throw new Error('Old failure was not independently demonstrated across all three real Chromium SSE streams');
}
writeFileSync(resolve(out, 'expected-failure.json'), JSON.stringify({ status: 'EXPECTED_SECURITY_FAILURE', baseCommit: base, exitCode: result.status, threeStreamsLeaked: true, pipelineCalls: evidence.pipelineCalls }, null, 2));
console.log('Old real Chromium SSE evaluator: all three streams independently leaked; expected failure verified.');
