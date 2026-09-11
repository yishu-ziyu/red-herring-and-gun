/**
 * Client re-export of the investigation contract (SSOT: `packages/core/src/investigation`).
 *
 * 生产侧 `mvp/server/src/lib/investigation` 是它的字节级镜像，两侧 `mirror.test.ts` 双向守卫。
 * 前端走这份本地再导出，不再 import `@rhg/core/investigation`：那条路径靠仓库根的 npm
 * workspace 软链才能解析，新克隆只装 `mvp/` 时 `tsc` 与 `vite build` 都会报
 * `Cannot find module '@rhg/core/investigation'`。
 *
 * 与 `mvp/src/lib/claimAtom/index.ts` 同一做法。契约 `docs/evals/2026-09-11-mvp-phantom-dependency.md`。
 */
export * from "../../../server/src/lib/investigation/index";
