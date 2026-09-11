# 当前状态

2026-09-11 清账：验收矩阵从 ✅26/🔶7/⛔4 收到 **✅38 / 🔶0 / ⛔2**。清的过程里补出两个真问题——**A02 320px 品牌名与导航互相压住**（已修，截图重拍）；**A32 SSRF 模块此前一个测试都没有，补测时发现 `http://[::ffff:127.0.0.1]/v1` 不被拦截**（`new URL()` 把它规范化成 `[::ffff:7f00:1]`，旧代码剥前缀后拿到半截主机）——已修。新增 `ssrfGuard.test.ts`(6)、`materialAndAccount.test.tsx`(5)、`resultAndQuota.test.tsx`(3)。剩下 ⛔ 两条是同一件事：公共案例与回放页（`/examples`、`/examples/:slug`）没做。门禁 1295 过 / 1 跳过、build 绿。

2026-09-11 PR-F：不动生产结构。新增 `docs/design/2026-09-11-investigation-experience/RELEASE.md`（改过的生产路径 / 数据库与迁移 / 逐提交回滚 / 没做的 / 已知风险 / 等人裁决的四件事）。只删了一处有消费者证明的死代码（`snapshotUi.conflictSidesLabel`，调用点已在本轮替换，全仓库含测试无引用）。旧壳 `?legacy=1`、`packages/` 脊柱切换都没动。另记一条无法复现的测试红（21:57 一次 1 failed / 1280 passed，未捕获是哪条，随后连跑三次全绿），写进 lessons F14 与 RELEASE 已知风险。

2026-09-11 完成情况回填 + 失败经验归档：交接包 `docs/design/2026-09-11-investigation-experience/` 里的 `ACCEPTANCE.md` 从「检查清单」改成「完成情况」（A01–A40 逐行 ✅/🔶/⛔ + 证据），`ISSUES.md` 加 RHG-00～08 状态，新增 `lessons.md` 记录 13 条**真跑红过**的失败（每条：检查项 / 失败值 / 根因 / 改法 / 复发防线）。同批修掉同类第 2 例：保存状态写着「同步失败，重试」却没有可点的重试。门禁 1281 过 / 1 跳过、build 绿。PR-F（清理旧展示逻辑 + 发布回滚说明）未做，等用户裁决。

2026-09-11 显式分享（PR-E，契约 `docs/evals/2026-09-11-share-tokens.md`）：`GET /api/cases/:caseId/share-preview`（只看不写）、`POST /api/cases/:caseId/shares`（返回明文令牌一次）、`DELETE .../shares/:shareId`、`GET /s/:shareId`（只读投影渲染，不读私有 case）。令牌随机不可猜、库里只存 sha256；投影走白名单 + 递归丢秘密键；撤销幂等、过期不可读、读不到只有一种 404 说法。结果页加「创建分享链接」：先看会公开哪些字段 → 再生成 → 可撤销，并明说已下载的副本收不回。`/r/:caseId` 页那句「分享此报告」拿掉（它是主人自己看的页，分享另有入口）。门禁 1279 过 / 1 跳过、build 绿。未部署。

2026-09-11 RunService 片二（契约同 `docs/evals/2026-09-11-run-service.md`）：`GET /api/investigations/:runId` 与 `/events?after=N` 补发+直播已接；前端加停止按钮三态（停止调查 → 正在停止 → 已停止，只有服务端确认才说已停止）、刷新恢复（本地座标接回原 run，不重开不扣额）、保存状态（已保存在此设备 / 同步中 / 已同步 / 同步失败）。**真实浏览器跑完三态**，截图 `preview/stop-before.png`、`stop-confirmed.png`。片二跑出三个真 bug：取消终态帧到不了客户端（总线不是唯一出口）、`writeFrame` 拿 `disconnect.aborted` 当「别写了」导致 **超时中断帧一直就没发出去过**、说了「重新调查一次」却没按钮。门禁 1260 过 / 1 跳过、build 绿。未部署。

2026-09-11 任务身份与取消（PR-D 片一，契约 `docs/evals/2026-09-11-run-service.md`）：存储换成 `node:sqlite`（Node 22 自带，零新依赖），旧 `cases.json` 首次启动幂等导入并先备份；`runStore` 管 runs / run_activities / shares，`runService` 管身份幂等、状态机、AbortSignal 取消，`POST /api/investigations/:runId/cancel` 已接。流开头新增 `run_started` 事件带 runId。**真实跑通两次取消**。**行为变更**：`caseStore` 不再按 1000 条淘汰（交接包禁止静默丢记录）；**测试隔离**：`src/test/setup.ts` 把 DATA_DIR 指到临时目录（改之前跑测试会清开发库）。四道门禁 1241 过 / 1 跳过、build 绿。未部署。片二还剩：重连/刷新恢复接口 + 前端停止按钮与保存状态。

2026-09-11 公共活动层（PR-C，契约 `docs/evals/2026-09-11-public-activity-layer.md`）：`PublicActivity` 判别联合 + payload 白名单落在 `packages/core/src/investigation/activity.ts` 并镜像到 `apps/server`；`createActivityLog` 从快照差分产出拆题/带回材料/判定材料/形成判断/还缺/分歧/完成，`search_started` 来自 `onAtomSearchStart` 且不带任何引用。传输走新 SSE 事件 `investigation_activity`，由 `createInvestigationEmitter` 保证「快照先落、活动后发」。前端 `applyRunEvent` 按 id 去重、按 seq 归位、终态不被晚到活动倒退；调查中画布新 `ActivityFeed`，有引用的行可点开来源，用户上滚时显示「有 N 条新发现」。**真实一次调查跑通**（隔夜菜亚硝酸盐，27 条活动，原始流与截图在 `preview/activity-live-real.*`）。门禁 1219 过 / 1 跳过、build 绿。未部署。已知未清：原始 `agent_thought` 帧仍在流上（Golden Path 不消费），属 PR-F。

2026-09-11 交接包 A15 落地（契约 `docs/evals/2026-09-11-conflict-sides-independent.md`）：争点原来合成一个按钮、固定打开支持侧第一条，完成态一侧都不渲染。改成两侧各自成组、各自列自己的材料行，点哪侧开哪侧；来源查不到显示「材料暂缺」。5 条新测试先红后绿，全量 1189 过 / 1 跳过，`apps` build 绿。截图 `preview/conflict-*.png`。同一批提交里先把 `mvp/` → `apps/` 改名（前一轮已暂存未提交）单独提交成 `d16f34f`。未部署。

2026-09-11 清掉会污染判断的旧上下文（契约 `docs/evals/2026-09-11-purge-stale-context.md`）：删 `apps/docs/`、`apps/DEVELOPMENT_LOG.md`、`apps/DESIGN-GALLERY.md`、`apps/tasks/`、`docs/archive/`、`docs/reviews/agentic-patterns/`。NOTES 只留当前。入口以 PRODUCT_SPEC / ARCHITECTURE / REPO 为准。

2026-09-11 生产壳是 `apps/`。`ops.sh` 打包上传 `apps/`，远端优先 `/opt/red-herring/apps`。不是 T20（T20 仍是切 `packages/`）。

2026-09-11 调查中职责按快照出场：`received` / `decomposed` 只有拆问题；`investigating` 后三人才进。完成态剥 `S1` 来源序号。未部署。
