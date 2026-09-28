# 2026-09-28 删除 `/?legacy=1` 旧三栏壳

背景：2026-09-06 Golden Path 上线时（`docs/evals/2026-09-06-golden-path.md`）刻意保留旧三栏壳做过渡对照。三周后该壳自 2026-09-11 目录改名起无人修改；它随生产包发布、任何人加 `?legacy=1` 即可进入，且仍含已收回的产品说法（`docs/evals/2026-09-11-doc-contradictions.md` 留人裁未处理）；前端生产代码约 42%（约 9.8k 行）只因它可达。用户 2026-09-28 同意删除。删除前打 tag `legacy-desk-final` 保留可找回的版本。

## Change

1. 删除从 `apps/src/main.tsx` 出发、排除 `legacy/LegacyDesk.tsx` 后不可达的前端生产文件，以及只测这些文件的测试与只被它们引用的 CSS module。
2. `App.tsx` 不再识别 `legacy` 参数：`/?legacy=1` 渲染与 `/` 相同的默认产品首页。
3. 混合测试只去掉旧壳分支：`goldenPath/inputMedia.test.tsx` 只测默认输入；`goldenPath/goldenPath.test.tsx` 不再读取 `LegacyDesk.tsx`。
4. 现行文档（`apps/README.md`、`apps/DESIGN.md`、`docs/ARCHITECTURE.md`、`docs/REPO.md`、`docs/NOTES.md`）去掉「旧三栏在 `/?legacy=1`」的现状描述。历史 evals / devlog 不改。

## Not this

- 不改 Golden Path 的任何行为、文案或样式。
- 不删仍被默认路径引用的 `components/v3/auth`、`settings`、`promptInput` 等。
- 不顺带清理 `styles.css` 里可能只服务旧壳的全局类（另行处理）。
- 保留 `lib/claimAtom/index.ts`（小型 re-export，现行测试引用）。
- 不改服务端、发布脚本或 `ops.sh`；不发布。

## Evaluator

- 命令：删除后 `git grep -nE "LegacyDesk|legacy=1|missionShell|components/v3/(AppShell|Dashboard|phases)" -- apps/src` 无命中。
- 命令：`cd apps && npm test` 失败数不多于删除前基线，且无新增失败；`cd apps && npm run build` 绿；`git diff --check` 干净。
- 命令：可达性脚本从 `main.tsx` 出发，`apps/src` 下无不可达生产文件（`lib/claimAtom/index.ts` 除外）。
- 浏览器：本地 `cd apps && npm run dev`，打开 `/` 与 `/?legacy=1`，两者都显示默认首页输入；控制台无报错。
- 人评：无。行为对默认路径无变更。
