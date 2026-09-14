# P5 推荐追问胶囊改为「点击填入、确认再发」

契约依据：`docs/reports/2026-09-12-page-audit/findings.md` 的 P5 与「待用户裁决」第 2 条 + 用户裁决（2026-09-12：选方向 B）+ A/B 沙盘 `docs/reports/2026-09-12-p5-followup-chips/chip-ab-lab.html`。

## Change

- `apps/src/goldenPath/FollowUpSection.tsx` 胶囊 `onClick`：只 `setQuery(s)` 并把焦点交给追问输入框（视觉交接），删除同一函数体内立即调用的 `handleSubmit(s)`。
- 三个胶囊补 `aria-label`，格式：`将「{问题文本}」填入追问输入框`，让读屏用户感知这一下的行为。
- 副标题（`FollowUpSection.tsx:107` 附近）改为与新行为自洽的确切文案，中文：「点一个推荐问题，它会填入下方输入框；确认后再发出追查。」英文同步改。
- 更新 `apps/src/goldenPath/followUpSection.test.tsx:71-86`（原断言「点胶囊即触发提交」不再成立）：改为断言点胶囊后输入框值为该问题、未触发 `onFollowUp`；再断言按 Enter 或点「追问」才触发 `onFollowUp`。

## Not this

- 不改 `composeFollowUpClaim` / `beginRun` / 追问发出后的调查流程——追问确认后仍走完整管道并带上一轮上下文。「追问要不要省掉整套管道」是另一个待裁的架构问题，本次不动。
- 不动中断态、分享、案卷、P4 已删的页底入口。
- 不动 `docs/reports/2026-09-12-p5-followup-chips/` 下的沙盘与取证脚本。

## Evaluator

1. `cd apps && npx vitest run src/goldenPath/` 全绿（含上述改写的胶囊行为测试）。【命令】
2. `cd apps && npm test` 全绿、`cd apps && npm run build` 零错误；仓库根 `npm run build` 零错误。【命令】
3. Playwright 走查 `?fixture=complete`（1280px + 375px，拦 `/api/**` 不计费）：点胶囊后输入框出现该问题、焦点在输入框、拦截到的 `/api/` 请求数为 0；按 Enter 后恰好 1 个 `orchestrate-stream` 请求、body 含「同一条核查的追问，不是新案件。」。截图存 `docs/reports/2026-09-12-p5-followup-chips/fixed-*.png`。【命令】
4. 看板 `docs/reports/2026-09-12-page-audit/review-board.html` 的 P5 与存疑 2 状态更新为「已裁决：方向 B，点击填入、确认再发」。副标题与 aria-label 观感由用户人评。【人评】
