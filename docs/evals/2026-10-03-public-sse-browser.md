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

- 真实 Chromium 145.0.7632.6 在 GitHub Ubuntu 验收通过；CI 37051816745 SUCCESS：https://github.com/yishu-ziyu/red-herring-and-gun/actions/runs/37051816745 。
- 已验证代码 head `c948d9d3dcc2d58e97b1b3934dda34d7398e09b9`，tree `e469c16525c71626ee5e179a5de3f78dfdbfc9c6`；PR merge checkout `41ca05c19a31d30f0b1cf2533f2b63e0de3142c2` tree 精确相同。
- 原 UI 首次 POST 5 帧，刷新后自然断开；生产 useRunPointer GET 接回与相同 body 重复 POST 各 9 帧、终态 EOF。三个真实 wire 无内部标记，同一 runId、activity.seq=1、友好 tool_error、unverified 判词与公开结论保留；模型管线仅运行一次，resume 请求一次。
- 结论实测 x=253 / y=224.04 / width=333.91 / height=35px，在 1280×900 首屏完整可见；截图和全部 raw frames 已由独立 reviewer 复算。
- 固定历史 `7110c850059b876b5345aab13d618e4d60165e3b` 同一 evaluator 真实退出 1，三流各自捕获内部标记，pipelineCalls=1；脚本明确验证实际漏洞失败，不能把启动错误当安全负向通过。
- artifact `11246986275`，SHA256 `3c9e18dc0844590d1c65dddf3a96f0a3e6281d935314d97fd5c9a03aeaab8a0c`；含 current/result.json、initial/complete.png、baseline/failure.json 和三流旧漏洞证明。
- 初次本地尝试缺 Chromium 失败；首轮云 CI 因测试脚本未从 server 声明依赖解析 Express 失败；已改为 createRequire(server/package.json)，第二轮上述 fresh npm ci / 浏览器运行通过。未新增产品依赖来掩盖问题。
- 根并发初跑一个未修改 packages 的 3 秒 deadline 测试时序失败；原断言保留，独立文件 10/10、完整根重跑 832 通过。apps 本轮 1497 passed / 13 skipped / 0 failed，根/apps/server build 通过。
- Ego / Claude for Chrome 两层走查与真实供应商 eval 均未运行。供应商 gate 真实启动后因缺 API key 退出 1，未用 fake 替代评分；PR 草稿、未合并、未部署。
- 本结果文档与 NOTES 的最终同步仅改文档；上面 c948 记录对应已实际验证的产品与浏览器脚本。最终文档提交的同一 CI 结果记录在 PR，不为自指提交号重复改文档。
