# 仓库文件管理（真搬家）· 验收

- 日期：2026-09-11
- 用户原话：原本不是说要改仓库的文件形式，也就是文件管理吗？

## 这件事是什么

上一批写成了地图。这次搬文件。标准结构是 `apps/`（可发布产品）+ `packages/`（领域）+ `docs/` + `scripts/`。`mvp/` 改名为 `apps/web` 必须改 `ops.sh`，T20 才做。本批搬的是不绑发布的杂物。

## Change

1. 退役部署脚本离开仓库根：`deploy-to-aliyun.sh` → `scripts/retired/`。
2. 过期文档离开 `docs/` 根：`AGENTIFICATION.md`、`DEMO_FACTDESK_3CASES.md`、`DEPLOYMENT_INCIDENT_REVIEW_2026-06-15.md` → `docs/archive/`。
3. 根上误跟踪的原型：`.context/` 里已入库的文件 → `docs/archive/context-scratch/`。

`mvp/`、`ops.sh`、`scripts/configure-aliyun-*.sh`（被 ops.sh 引用）不动。

## Not this

- 不把 `mvp/` 改名为 `apps/web`。
- 不改 `ops.sh`。
- 不改产品行为。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | 仓库根没有 `deploy-to-aliyun.sh`；`scripts/retired/deploy-to-aliyun.sh` 存在 | `test` | 命令 |
| E2 | `docs/` 根没有上述三份过期文档；`docs/archive/` 里有 | `test` | 命令 |
| E3 | `git ls-files .context` 为空 | 命令 | 命令 |
| E4 | `ops.sh` 未改；`mvp/` 仍在 | `git diff --name-only` 不含 ops.sh；`test -d mvp` | 命令 |
| E5 | mvp 测试仍绿 | `cd mvp && npm test` 相关即可；本批零产品代码 | 命令（抽测 README 引用） |
