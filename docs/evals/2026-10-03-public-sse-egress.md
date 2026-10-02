# 公开调查 SSE 出口安全契约（2026-10-03）

## Change

- 首次 POST、GET 接回、相同 clientRequestId 重复 POST 的所有 SSE 数据帧清除 systemPrompt、userContent、模型诊断、原始工具错误，保留用户结论、runId、seq 和终态。
- 接回补发的活动/快照与接回后的直播均受相同边界约束。
- 超过清洗最大深度的对象/数组返回 null，禁止返回未清洗原始子树。正常浅层内容保留，输入对象不变。

## Not this

不改调查判词、预算、所有权规则或生产部署；不将供应商诊断隐藏等同完整凭据扫描。#127 的全量审计继续开放。不改冻结 packages 或 investigation 字节镜像（本轮未触及镜像文件）。

## Evaluator

- `cd apps && npx vitest run server/src/handlers.publicStream.test.ts server/src/handlers.friendlyError.test.ts`：真实 handler 写出的 SSE 字节，覆盖三个入口、活动/快照/直播、终态关闭及深度与输入不变。
- `npm test && npm run build`，`cd apps && npm test && npm run build`，`cd apps/server && npm run build`，`git diff --check`。
- 行为变更真实供应商生产 eval gate：需要真实 API 凭据和供应商配置；本轮不读取 .env、不调用真实供应商、不虚报通过。记录未运行边界。

## Result

- 旧实现上新增回归 3 failed / 5 passed（HTTP 三入口和对象/数组超深泄露均被抓到）；修复后定向 9/9 通过。
- 根 npm test：832 passed（构建依赖产物后）；根 build、apps build、server build 通过；git diff --check 通过。
- npm 11.9.0 根 npm ci 起初因锁中缺 `@esbuild/linux-ppc64@0.28.2` 失败，锁只补对应条目、不升级版本，实际 npm ci 成功。
- apps 全量最终 1494 passed / 1 failed / 13 skipped。首次浅克隆缺旧 Git ref，补全历史后该项通过。self-proof 两次全丢预期 unverified、实际 false 的失败已在未修复 main 7110c85 的独立 worktree 定向复现，不能算本轮引入，也不删除测试；独立跟踪 #133。依 AGENTS 机器全绿要求，本轮整版未通过，PR 保持 draft，不合并。
- 生产 apps 真实供应商 eval:gate 未运行：runner 会加载本地凭据并真实调用供应商，本轮没有读取 .env 或调用模型。根 eval:gate 只覆盖冻结 packages，不代表生产调查验收。
- 未部署。
