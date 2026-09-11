# 当前状态

2026-09-11 交接包 A15 落地（契约 `docs/evals/2026-09-11-conflict-sides-independent.md`）：争点原来合成一个按钮、固定打开支持侧第一条，完成态一侧都不渲染。改成两侧各自成组、各自列自己的材料行，点哪侧开哪侧；来源查不到显示「材料暂缺」。5 条新测试先红后绿，全量 1189 过 / 1 跳过，`apps` build 绿。截图 `preview/conflict-*.png`。同一批提交里先把 `mvp/` → `apps/` 改名（前一轮已暂存未提交）单独提交成 `d16f34f`。未部署。

2026-09-11 清掉会污染判断的旧上下文（契约 `docs/evals/2026-09-11-purge-stale-context.md`）：删 `apps/docs/`、`apps/DEVELOPMENT_LOG.md`、`apps/DESIGN-GALLERY.md`、`apps/tasks/`、`docs/archive/`、`docs/reviews/agentic-patterns/`。NOTES 只留当前。入口以 PRODUCT_SPEC / ARCHITECTURE / REPO 为准。

2026-09-11 生产壳是 `apps/`。`ops.sh` 打包上传 `apps/`，远端优先 `/opt/red-herring/apps`。不是 T20（T20 仍是切 `packages/`）。

2026-09-11 调查中职责按快照出场：`received` / `decomposed` 只有拆问题；`investigating` 后三人才进。完成态剥 `S1` 来源序号。未部署。
