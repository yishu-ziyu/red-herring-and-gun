# Chromium 公开 SSE 出口验收

## Change

- 用真实 Chromium 打开当前生产 `apps/dist`，从输入框提交调查；刷新后由生产 `useRunPointer` 自动 GET 接回，不写入 localStorage 来伪造恢复。
- Chromium fetch 被动克隆响应读取真实 SSE 字节，初始 POST、刷新 GET 接回、相同 body 重复 POST 各自无内部诊断，保留同一个 runId、公开活动和结论；模型管线只运行一次。
- 从生产结论组件看到「现有资料不足以确认这条说法。」且保留 `unverified`，记录结论位置、原始帧统计、浏览器版本与截图。

## Not this

仅模型管线和模型健康探针使用离线夹具；不替换清洗器、handlers、runService/store、前端或 SSE 响应。不改判词规则。不将 Playwright 脚本称为 Ego 或 Claude for Chrome 真人走查。没有真实供应商 API key，eval gate 未通过，PR 保持草稿。

## Evaluator

- `cd apps && npm run build`
- `npm ci --prefix scripts/acceptance/browser-tools --ignore-scripts`
- `node scripts/acceptance/browser-tools/node_modules/playwright/cli.js install --with-deps chromium`
- `npx --no-install vitest run --config scripts/acceptance/vitest.browser.config.ts`
- GitHub Ubuntu 固定 action SHA、只读权限执行同样入口，并保存 `out/public-sse-browser/`。
- 修复前 main 相同测试须抓到三个入口的真实 wire 泄漏；独立 reviewer 审查 evaluator。

## Result

待运行；成功、失败与未运行分开报告。Ego / Claude for Chrome 两层走查与真实供应商 eval 均未运行。
