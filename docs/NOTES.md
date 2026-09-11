# 当前状态

2026-09-11 任务身份与取消（PR-D 片一，契约 `docs/evals/2026-09-11-run-service.md`）：存储换成 `node:sqlite`（Node 22 自带，零新依赖），旧 `cases.json` 首次启动幂等导入并先备份；`runStore` 管 runs / run_activities / shares，`runService` 管身份幂等、状态机、AbortSignal 取消，`POST /api/investigations/:runId/cancel` 已接。流开头新增 `run_started` 事件带 runId。**真实跑通两次取消**。**行为变更**：`caseStore` 不再按 1000 条淘汰（交接包禁止静默丢记录）；**测试隔离**：`src/test/setup.ts` 把 DATA_DIR 指到临时目录（改之前跑测试会清开发库）。四道门禁 1241 过 / 1 跳过、build 绿。未部署。片二还剩：重连/刷新恢复接口 + 前端停止按钮与保存状态。

2026-09-11 公共活动层（PR-C，契约 `docs/evals/2026-09-11-public-activity-layer.md`）：`PublicActivity` 判别联合 + payload 白名单落在 `packages/core/src/investigation/activity.ts` 并镜像到 `apps/server`；`createActivityLog` 从快照差分产出拆题/带回材料/判定材料/形成判断/还缺/分歧/完成，`search_started` 来自 `onAtomSearchStart` 且不带任何引用。传输走新 SSE 事件 `investigation_activity`，由 `createInvestigationEmitter` 保证「快照先落、活动后发」。前端 `applyRunEvent` 按 id 去重、按 seq 归位、终态不被晚到活动倒退；调查中画布新 `ActivityFeed`，有引用的行可点开来源，用户上滚时显示「有 N 条新发现」。**真实一次调查跑通**（隔夜菜亚硝酸盐，27 条活动，原始流与截图在 `preview/activity-live-real.*`）。门禁 1219 过 / 1 跳过、build 绿。未部署。已知未清：原始 `agent_thought` 帧仍在流上（Golden Path 不消费），属 PR-F。

2026-09-11 交接包 A15 落地（契约 `docs/evals/2026-09-11-conflict-sides-independent.md`）：争点原来合成一个按钮、固定打开支持侧第一条，完成态一侧都不渲染。改成两侧各自成组、各自列自己的材料行，点哪侧开哪侧；来源查不到显示「材料暂缺」。5 条新测试先红后绿，全量 1189 过 / 1 跳过，`apps` build 绿。截图 `preview/conflict-*.png`。同一批提交里先把 `mvp/` → `apps/` 改名（前一轮已暂存未提交）单独提交成 `d16f34f`。未部署。

2026-09-11 清掉会污染判断的旧上下文（契约 `docs/evals/2026-09-11-purge-stale-context.md`）：删 `apps/docs/`、`apps/DEVELOPMENT_LOG.md`、`apps/DESIGN-GALLERY.md`、`apps/tasks/`、`docs/archive/`、`docs/reviews/agentic-patterns/`。NOTES 只留当前。入口以 PRODUCT_SPEC / ARCHITECTURE / REPO 为准。

2026-09-11 生产壳是 `apps/`。`ops.sh` 打包上传 `apps/`，远端优先 `/opt/red-herring/apps`。不是 T20（T20 仍是切 `packages/`）。

2026-09-11 调查中职责按快照出场：`received` / `decomposed` 只有拆问题；`investigating` 后三人才进。完成态剥 `S1` 来源序号。未部署。
