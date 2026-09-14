# P4 完成态「重新调查」单入口化

契约依据：`docs/reports/2026-09-12-page-audit/findings.md` 的 P4 + 用户裁决（2026-09-12：留 A 删 B）+ 证据 `docs/reports/2026-09-12-p4-reverify-entries/`。

## Change

- 删除完成态页面最底部的「重新调查」文字链（`apps/src/goldenPath/InvestigationCanvas.tsx:401-407` 的 `.gp-result-again` 块，入口 B）。
- 删除随之失效的 `.gp-result-again` CSS（`apps/src/goldenPath/golden-path.css:1984` 起整段）。
- 追问卡 actions 栏的「重新调查」按钮（`apps/src/goldenPath/FollowUpSection.tsx:167`，入口 A）原样保留，含刷新图标与 secondary 样式。
- `copy.reviewAgain` 文案键保留（中断态按钮仍在用，见 `InvestigationCanvas.tsx:310`）。

## Not this

- 不动中断态（`stop === "stopped"`）警示大卡里的「重新调查」主按钮（`InvestigationCanvas.tsx:309`），那是另一个场景的另一个入口。
- 不动追问卡其余部分（推荐追问胶囊、自由输入框、复制结论简报）。
- 不改 `onReverify` 行为与重新调查流程本身。
- P5（追问胶囊即点即发）不在本契约，另行裁决。

## Evaluator

1. `grep -rn "gp-result-again" apps/src` 无结果。【命令】
2. `cd apps && npx vitest run src/goldenPath/` 全绿。【命令】
3. `cd apps && npm test` 全绿、`cd apps && npm run build` 零错误；仓库根 `npm run build` 零错误。【命令】
4. Playwright 走查 `?fixture=complete`（1280px + 375px）：完成态全文「重新调查」按钮恰为 1 个，且位于追问卡 actions 栏；页底无该文字链。截图存 `docs/reports/2026-09-12-p4-reverify-entries/after-*.png`。【命令 + 人评】
