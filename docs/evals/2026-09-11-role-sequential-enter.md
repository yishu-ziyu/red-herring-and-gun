# 调查中职责依次出场 · 验收

- 日期：2026-09-11
- 用户原话：四个人不是一次性出现的，而是依次出现。不能提前写出来。拆完问题之后，才开始让他们慢慢往后出现。快照就是状态；思路已定，开始动手。

## 这件事是什么

调查的领域状态是 `InvestigationSnapshotV1`（phase / claims / sources）。管线已经发 `received` → `decomposed` → `investigating`。脸上却一开始就把四人铺开、未开始的变淡，等于把后三步写在纸上。

改的是：脸按快照的 `phase` 决定谁在场。不另建一套 UI 状态机。动效只是状态从「只有拆问题」变成「四人到齐」时的桥，不表演思考。

## Change

- `received` / `decomposed`：调查中只出现「拆问题」。
- `investigating` 及之后（未完成）：四人都在。后三人用现成 `--gp-motion-ui` / `--gp-ease-out` 依次进入，间隔 70ms。
- 首页四人教学示意不动。
- `prefers-reduced-motion` 下后三人直接在，不位移。

## Not this

- 不把四人空位先画好再填。
- 不做成 1/4 2/4 3/4 4/4 向导进度。
- 不摇头像、不从拆问题克隆分裂。
- 不改管线里程碑（received / decomposed 已经在发）。
- 不删 `mvp/`。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | phase=received 的画布只有「拆问题」，没有「找出处 / 核语境 / 作判断」 | `goldenPath.test.tsx` | 命令 |
| E2 | phase=investigating 四人都在；后三人带 `is-enter` | 测试 | 命令 |
| E3 | 首页四人仍在 | `App.test.tsx` 既有 | 命令 |
| E4 | CSS 有 `--gp-motion-ui` 出场和 `prefers-reduced-motion` 关掉位移 | 读 CSS | 命令 |
| E5 | 既有 identity / 待核对中性仍绿 | 门禁 | 命令 |
| E6 | 人看真实调查：拆题阶段只有一人，拆完后三人从右侧进来 | 人评 | 人评 |
