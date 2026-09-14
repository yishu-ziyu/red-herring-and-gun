# 仓库拓扑写清 · 验收

- 日期：2026-09-11
- 用户原话：仓库一直很乱，整理成符合标准软件工程开发过程的文件结构；结构要带全栈思维；开发过程中教我做好全栈。

## 这件事是什么

乱的不是「少了一个叫 `apps/` 的文件夹」。乱的是两代产品叠在一起：线上跑的是 `mvp/`，脊柱在 `packages/`，README 还只画了 `mvp/`。T20 之前不准删 `mvp/`、不准改 `ops.sh`。所以这一批把**地图写对**，不把生产壳搬家。

标准名字：npm workspaces 单体仓库（monorepo）+ 绞杀式迁移（strangler fig）。文件夹按一次请求穿过的层来读：脸 → HTTP → 领域 → 检索/模型 → 发布。

## Change

新人打开仓库能分清：用户看见的在哪、判决在哪、检索在哪、部署在哪、哪些是还没接生产的脊柱、哪些是过程产物。根 README 的「项目结构」与事实一致。

## Not this

- 不把 `mvp/` 改名成 `apps/web`（T20 红线，会断 `ops.sh`）。
- 不删 `packages/`。
- 不重排 `docs/evals/` 九十二份契约（链接会断）。
- 不改产品行为、不改判词、不改检索。
- 不把 `Chinese_Rumor_Dataset/`、`vendor/`、`tmp-apodex-study/` 当本批必删（未跟踪，删不删人裁）。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | `docs/REPO.md` 存在，写明生产入口、脊柱、镜像、T20 红线 | 读文件 | 命令 |
| E2 | 根 `README.md`「项目结构」出现 `mvp/` 与 `packages/`，不再假装只有 mvp | 读文件 | 命令 |
| E3 | `docs/README.md`、`packages/README.md`、`mvp/README.md` 能当入口 | 读文件 | 命令 |
| E4 | `cd mvp && npm test` 与根 `npm test` 仍绿（零产品改动） | 命令 | 命令 |
| E5 | 人读完 REPO.md 能说出：改结果页文案要动哪四层 | 人评 | 人评 |
