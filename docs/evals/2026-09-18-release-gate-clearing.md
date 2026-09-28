# 2026-09-18 发布门槛清理：过程区旧契约对齐现行 UI

背景：发布前 apps 全量测试 1673 passed / 4 failed / 1 skipped。4 个失败均为 2026-09-17 过程面板降噪与「调整重点先等服务端终态」落地后留下的旧契约测试，不是本次改动引入。现行 UI 已在 2026-09-17/09-18 真实 Chrome 走查中确认（见 `docs/NOTES.md` 头部），因此改测试到现行契约，不改 UI 回旧 behavior。

## Change

1. **ThinkingDisclosure 命题出来后的行为**：现行契约是思考区整个不再渲染（`if (!live || stage === "split") return null`），不再是「默认折叠、标题写已拆出 N 个、点开看归档说明」。理由：用户 2026-09-17 投诉双重命题清单与系统表功废话，降噪后折叠盒已删。取代 `docs/evals/2026-09-13-thinking-honesty.md` 的「命题出现后默认折叠」条款与 `docs/evals/2026-09-13-thinking-wait-status.md` 的「已拆出 N 个待查问题」条款。received/checking 等待区契约（阶段句 + 秒数 + 灰槽 + 无假三步）不变。
2. **调查中阅读顺序「命题出来后」**：思考区不出现；命题只在主列命题列出现一次；活动流不复述拆题。取代 `docs/evals/2026-09-14-investigation-reading-order.md` 中同一场景的「思考折叠」断言，其余断言不动。
3. **调整核查重点入口**：现行契约是入口只在 complete / interrupted（终态）出现，提交后按 `handleFollowUp` 开新轮并保留本轮结果；「调查中停止本轮再替换」不再是可测路径。理由：`InvestigationCanvas` 只在终态渲染核查范围区，对应「调整重点先等服务端终态，再开新轮」。
4. **组件死分支清理**：`ThinkingDisclosure` 删除只服务旧折叠盒的不可达代码（`wasSplitRef` / `finalTimeRef` / `COPY_ARCHIVE` / splitOut 渲染分支），hooks 顺序与等待区行为不变；头注释改为现行行为。

## Not this

- 不改 received / checking 等待区行为与文案。
- 不改 `App.tsx` `adjustFocus` 里 UI 不可达的 `pendingFocus` 停止替换分支（另行清理，不在本契约）。
- 不改任何服务端行为、发布脚本或 `ops.sh`。
- 不在本契约内验收完整 live E2E（发布门槛的另一项，单独跑）。

## Evaluator

- `cd apps && npm test`：期望约 1677 passed / 0 failed / 1 skipped（原 4 个失败转为绿，不新增失败）。
- 根工作区 `npm test` 全绿；根 `npm run build` 与 `cd apps && npm run build` 绿。
- `git diff --check` 干净。
- 本契约只改测试与不可达代码，属行为无变更，不把 `eval:gate` 当门槛。
- 人评：无。契约对齐的现行 UI 已由 2026-09-17/09-18 实机走查确认。

## 发布门槛剩余项（不属本契约）

- 完整真实 E2E：本地完整 live pipeline 跑通一例真实说法（上一轮 420s 终止于多供应商坏 JSON/不可用）。
- 发布执行：`./ops.sh deploy --yes` + `./ops.sh public` 复验，需用户确认后执行。
