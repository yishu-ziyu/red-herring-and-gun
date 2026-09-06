# 验收标准：[Infra] 修复 Vercel Output Directory（Issue #58）

日期：2026-09-06。独立于 #66 产品代码。

## Change

Git 集成的 Vercel 项目 `red-herring-and-gun` 部署成功，不再报 `No Output Directory named "public" found after the Build completed.`

判定后的生产部署目标：

- 当前 Reset 生产壳是 `mvp/`（T20 之前）。`@rhg/web` 是脊柱，不是线上 Golden Path。
- Vercel 只托管 `mvp` 的 Vite 静态产物。Express / SSE 仍在阿里云。
- 不能把 Root Directory 设成 `mvp` 后只跑 `mvp` 自己的 `npm run build`：Golden Path 依赖仓库根工作区的 `@rhg/core`。Vercel 在 `mvp/` 子目录里 `npm install` 拿不到这个包，tsc 会报 `Cannot find module '@rhg/core/investigation'`。
- 不把 Vite `outDir` 改成 `public`，不改 Mode 3 应用输出结构。

校准：

| 项 | 值 |
|---|---|
| Root Directory | 仓库根（空） |
| Install Command | `npm install`（装上 `@rhg/core` 工作区） |
| Build Command | `npm run build -w @rhg/core && npm --prefix mvp install && npm --prefix mvp run build` |
| Output Directory | `mvp/dist` |
| Framework | Other / 空 |

失败原因是 Git 项目走 root `npm run build`（`@rhg/web` 的 `packages/web/dist`），再按 Other 预设找 `public/`。

## Not this

- 不把 `public` 机械改成某个 `dist` 却仍在仓库根构建。
- 不把 `@rhg/web` 当生产 Golden Path。
- 不改 `ops.sh`、不删 `mvp/`、不把 SSE 搬进 Vercel。
- 不与 #66 混 PR。

## Evaluator

- [x] V1 项目设置 Root Directory 空，Output Directory=`mvp/dist`（不是把 Root 设成 `mvp` 后只找 `dist`）。
- [x] V2 一次 **main** deployment 不再 `STATIC_BUILD_NO_OUT_DIR`。
- [x] V3 一次 **PR Preview** 同样成功。
- [x] V4 `mvp` Vite 输出仍是 `dist/`，没有为了变绿改 Mode 3 `outDir`。

## 结果

- [x] V1 项目设置：Root Directory 空；Build 先 `@rhg/core` 再 `mvp`；Output=`mvp/dist`。仓库根 `vercel.json` 与此一致。
- [x] V2 main/production deployment Ready：https://red-herring-and-gun.vercel.app （`dpl_F8CukBW9edFaJGffiMi8VWBNdCzo`，title 为生产 Golden Path「红鲱鱼与枪｜查出处，判断原句哪里站得住」）。
- [x] V3 PR Preview Ready：https://red-herring-and-gun-git-feat-f3db42-sheldons-projects-6ef373e4.vercel.app （deployment `Gfd1E1rW4the8Z6pVQptvBULdNGC`，GitHub Vercel check `success` / “Deployment has completed”，Vercel Preview Comments check `success`，2026-09-06T11:16:53Z）。SSO 保护，不要求匿名打开页面。
- [x] V4 `mvp` Vite 仍输出 `dist/`，未改 Mode 3 `outDir`。

第一次误把 Root Directory 设成 `mvp`：tsc 找不到 `@rhg/core/investigation`。已改回仓库根。
