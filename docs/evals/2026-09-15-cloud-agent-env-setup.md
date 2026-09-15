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

- 依赖：`npm install`（根，229 包）、`npm --prefix apps install`、`npm --prefix apps/server install` 均退出码 0；`apps` install 第二次跑仍退出码 0（幂等）。合并 install 命令 `npm install && npm run build && npm --prefix apps install && npm --prefix apps/server install` 退出码 0。
- 构建：根 `npm run build` 绿（@rhg/core→server→web→eval，`packages/*/dist` 有产物）；`cd apps && npm run build` 绿（`tsc && vite build`，`apps/dist` 有产物）。
- 测试：根 `npm test` 里 @rhg/core 未直接跑用例、@rhg/server 21 绿、@rhg/web 83 绿；@rhg/eval 1 红——`packages/eval/baseline.json` 未提交（`origin/main` 上也不存在），属预存缺件，不在本次搭建范围，未伪造。`cd apps && npm test` 1573 绿 / 10 红 / 1 skip；10 红是 `casePipeline`/`App` 文案断言漂移，在 `main` 上即红，非环境问题。
- 运行：`cd apps && npm run dev` 起 Express `:3000` + Vite `:5173`。`curl :3000/health` → `{"status":"ok",...}`；`curl :5173/` 返回含 `#root` 的 HTML，标题「红鲱鱼与枪…」。截图 `home_page_golden_path.webp`、`claim_typed_in_input.webp`、`api_health_ok.webp`。
- 加 `MINIMAX_API_KEY` 后 `:3000/api/models/health` → `{"status":"available"}`，`models/list` 列 MiniMax M3 / M2.7-highspeed。
- 端到端：`POST :3000/api/agent/orchestrate-stream {"claim":"北京是中国的首都"}`（SSE）走完 `received → decomposed → investigating → judging`，产出 `directAnswer=「北京是中国的首都」站得住`、`judgment=supported`、5 条真实来源；服务端四个 MiniMax agent 调用全部 complete。末尾 `interrupted` 是 `docs/NOTES.md` 记的既有收束问题，非环境故障。日志 `e2e_investigation_run.log`。
- computerUse / videoReview 因 Claude/Gemini 额度上限起不来；改用 Playwright 驱动系统 Chrome（不耗模型额度）录下完整流程：首页 → 输入「北京是中国的首都」→ 开始调查 → 调查中（拆问题 + 活动流）→ 终态「北京是中华人民共和国的首都」站得住。录像 `dev_env_live_investigation_walkthrough.mp4`（73s），截图 `ui_home_service_available.png`、`ui_investigating_live.png`、`ui_result_verdict.png`。
- Draft build `bld-20260915-92f14bba-fbd9-4c08-8b1e-b5a1cf9ff9bf` SUCCEEDED：fresh `main` checkout 上 install 依次 `npm install`(229 包) → `npm run build`(core/server/web/eval) → `apps` install(331 包) → `apps/server` install(220 包)，Exit 0，快照就绪。
- Fresh Cloud Agent（从该 build 启动）验证 PASS：node v22.14.0 / npm 10.9.7；`node_modules` 与 `packages/core/dist` 齐备；`npm run build` Exit 0（幂等）；`/health` 返回 `ok`；前端标题正确；`models/list` 显示 MiniMax 已配置（密钥注入生效）。冷启 `node scripts/dev.mjs` 2 秒答 `/health`。
- 环境形状：`install = npm install / npm run build / npm --prefix apps install / npm --prefix apps/server install`；`start = cd apps && npm run dev`（Vite `:5173` + Express `:3000`）。已 `propose` 供用户 Save。

