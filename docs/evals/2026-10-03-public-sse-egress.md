# 公开调查 SSE 出口安全契约（2026-10-03）

## Change

- 首次 POST、GET 接回、相同 clientRequestId 重复 POST 的所有 SSE 数据帧清除 systemPrompt、userContent、模型诊断、原始工具错误，保留用户结论、runId、seq 和终态。
- 接回补发的活动/快照与接回后的直播均受相同边界约束。
- 超过清洗最大深度的对象/数组返回 null，禁止返回未清洗原始子树。正常浅层内容保留，输入对象不变。

## Not this

不改调查判词、预算、所有权规则或生产部署；不将供应商诊断隐藏等同完整凭据扫描。#127 的全量审计继续开放。不改冻结 packages 或 investigation 字节镜像（本轮未触及镜像文件）。

## Evaluator

- `cd apps && npx vitest run server/src/handlers.publicStream.test.ts server/src/handlers.friendlyError.test.ts`：原回归使用真实 handler、模拟 req/res，覆盖三个入口、活动/快照/直播、终态关闭及深度与输入不变。新增 `real loopback HTTP SSE boundary` 使用真实 Node HTTP server/request/response 与 fetch 三连接，覆盖同样出口，且校验响应头、补发数据、终态帧及流关闭；仅模型管线用离线夹具。
- `npm test && npm run build`，`cd apps && npm test && npm run build`，`cd apps/server && npm run build`，`git diff --check`。
- 行为变更真实供应商生产 eval gate：需要真实 API 凭据和供应商配置；本轮不读取 .env、不调用真实供应商、不虚报通过。记录未运行边界。

## Result

- 旧实现上新增回归 3 failed / 5 passed（HTTP 三入口和对象/数组超深泄露均被抓到）；修复后定向 9/9 通过。
- 根 npm test：832 passed（构建依赖产物后）；根 build、apps build、server build 通过；git diff --check 通过。
- npm 11.9.0 根 npm ci 起初因锁中缺 `@esbuild/linux-ppc64@0.28.2` 失败，锁只补对应条目、不升级版本，实际 npm ci 成功。
- apps 全量最终 1494 passed / 1 failed / 13 skipped。首次浅克隆缺旧 Git ref，补全历史后该项通过。self-proof 两次全丢预期 unverified、实际 false 的失败已在未修复 main 7110c85 的独立 worktree 定向复现，不能算本轮引入，也不删除测试；独立跟踪 #133。依 AGENTS 机器全绿要求，本轮整版未通过，PR 保持 draft，不合并。
- 生产 apps 真实供应商 eval:gate 未运行：runner 会加载本地凭据并真实调用供应商，本轮没有读取 .env 或调用模型。根 eval:gate 只覆盖冻结 packages，不代表生产调查验收。
- 未部署。


## 02:50 截止前续查（2026-10-03）

- 原 handler 回归不经过 TCP；本轮新增真实 localhost TCP/HTTP 回归，使用生产 handler、run service、run store 和 SSE 格式，不替换清洗器。首次 POST、GET 接回、相同 requestId 重复 POST 均由真实 fetch 接收；仅供应商管线用离线夹具。
- 在修复前 `7110c85` 独立 worktree 运行同一新增测试，实际退出 1：三个入口均抓到内部标记泄漏，接回和重复 POST 同时抓到原始工具错误。当前修复树定向两文件 10 tests 通过；没有放宽断言或修改生产实现。
- 冻结 packages 同入口 `cd packages/eval && node --import tsx src/run.ts --gate ./baseline.json` 绕过 tsx CLI 的 IPC 限制，实际退出 1：缺 API key。
- 生产 apps 同入口 `cd apps/server && node --import tsx eval/run.ts --gate eval/baseline.json` 实际退出 1：缺 STEPFUN/DEEPSEEK/MINIMAX/MIMO API key。两条命令保留原 runner 和基线参数，未使用 `--fake`，未进行真实供应商调用。供应商门禁仍未通过。
- 此 localhost 回归不等同浏览器验收；Ego / Claude for Chrome 两层走查仍未运行。PR 继续草稿，不合并、不部署。

- 新测试后的 apps 全量：155 files passed / 2 skipped，1497 tests passed / 13 skipped / 0 failed（89.47s）；server TypeScript build 与 git diff --check 通过。根 832 tests 及其他构建沿用前轮同产品实现的通过记录，本轮没有产品代码改动。


## 03:30 截止前续查：JSON 恢复出口

- `GET /api/investigations/:runId` 也返回同一内部存储快照与活动；在前一修复头真实 localhost HTTP 重现：响应包含 synthetic systemPrompt/userContent/model/latencyMs，负向断言实际失败。
- 最小修复只对整个 JSON 响应套现有公开清洗器，不改权限、runId、状态、内部存储；避免直接清洗单个 activity 误删公开 detail。
- 同一真实 HTTP 回归断言 JSON 无内部标记，同时 runId、snapshot 原句、activity.text 与合法 activity.detail 保留。修复后两个文件 10/10 通过，server build 通过；全量门禁本轮重新运行中。
- 新增 Chromium 生产前端与三个真实 SSE 入口验收，契约 `2026-10-03-public-sse-browser.md`；本地脚本真实启动后因 Chromium 不存在失败，正通过 GitHub Ubuntu CI 验证，尚未声称通过。真实供应商和 Ego/Claude 两层走查仍未运行。
