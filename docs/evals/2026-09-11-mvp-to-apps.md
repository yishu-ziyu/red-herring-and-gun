# 生产目录 mvp → apps，发布路径一起改 · 验收

- 日期：2026-09-11
- 用户原话：提前把 mvp 改成 apps，发布路径一起改。

## Change

本地生产树从 `mvp/` 改名为 `apps/`。`ops.sh` 打包、测试、构建、上传都走 `apps/`。远端优先 `/opt/red-herring/apps`；若只有旧的 `/opt/red-herring/mvp`，先停掉那边的 compose 再在 `apps` 起。

## Not this

- 不切到 `packages/web` / `packages/server`（那是 T20 脊柱切换）。
- 不改产品行为、不改判词。
- 不重写历史 eval 收据里的旧命令。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | 仓库根有 `apps/package.json`，没有 `mvp/package.json` | `test` | 命令 |
| E2 | `ops.sh` 含 `ROOT_DIR}/apps`，不含 `ROOT_DIR}/mvp` | `rg` | 命令 |
| E3 | `cd apps && npx vitest run scripts/deploy-pipeline.test.ts` 绿 | 命令 | 命令 |
| E4 | 镜像测试仍绿（core ↔ apps/server investigation） | 命令 | 命令 |
| E5 | `cd apps && npm test` 绿 | 命令 | 命令 |
| E6 | AGENTS.md / README 本地命令是 `cd apps` | 读文件 | 命令 |
