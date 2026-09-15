# Cloud Agent 开发环境搭建

Date: 2026-09-15

## Change

给本仓库搭一套可复现的 Cloud Agent 开发环境，并证明它端到端能跑。范围是仓库完整开发体验：`packages/` 脊柱与生产壳 `apps/`（前端 Vite + 后端 Express）。

1. **依赖装齐。** 根 workspace（`packages/*`）、`apps/`、`apps/server/` 三处依赖都能非交互装完，且重复执行幂等。
2. **机器项全绿。** 根 `npm test`、根 `npm run build`、`cd apps && npm test` 全绿。
3. **服务能起。** `cd apps && npm run dev` 起得来：Express 在 `:3000`，Vite 在 `:5173`，`/health` 返回 `{"status":"ok"}`，首页 Golden Path 输入页可加载。
4. **environment.json 产出。** 产出经 draft build 验证过的 `install` / `start`（或 `terminals`）配置，供用户 Save。

## Not this

- 不改应用代码来掩盖环境问题（环境配置、引用的 setup 文件、必要的 environment.json 除外）。
- 不把真实密钥写进仓库、Dockerfile、日志或 environment.json。
- 不为跑通而关测试或跳过构建。
- 不新建 `AGENTS.md`（已存在，可加耐久运维指引；本任务不需要）。

## Evaluator

1. 根 `npm install`、`cd apps && npm install`、`cd apps && npm --prefix server install` 三处都退出码 0；第二次跑 `apps` install 仍退出码 0（幂等）。【命令】
2. 根 `npm test` 退出码 0。【命令】
3. 根 `npm run build` 退出码 0，`packages/*/dist` 有产物。【命令】
4. `cd apps && npm test` 退出码 0。【命令】
5. `cd apps && npm run build` 退出码 0（`tsc && vite build`），`apps/dist` 有产物。【命令】
6. `npm run dev` 起后 `curl -s http://127.0.0.1:3000/health` 返回含 `"status":"ok"`。【命令】
7. `curl -s http://127.0.0.1:5173/` 返回 HTML（含挂载点 `#root`），前端页面加载。【命令】
8. computerUse 打开 `http://127.0.0.1:5173/` 截图：Golden Path 首页输入页渲染出来。【人评 + 命令】
9. draft build 跑到 SUCCEEDED，fresh agent 能装齐依赖并起服务。【命令】

## Not-covered（需密钥，不在本次机器项内）

- 完整核查一轮（贴一句话 → 命题 → 证据 → 判断）需要模型 provider 密钥（`MINIMAX_API_KEY` / `STEPFUN_API_KEY` / `DEEPSEEK_API_KEY` 等，见 `apps/.env.local.example`）。无密钥时 `/api/agent/orchestrate-stream` 会失败或落到本地 Codex 兜底（本环境无 Codex）。这一条列为 provider 密钥就绪后的人评项，不计入本次机器验收。

## Evidence

（实施后回填）
