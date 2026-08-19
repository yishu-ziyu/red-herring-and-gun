# 红鲱鱼与枪 · Agent notes

产品真相：`docs/PRODUCT_SPEC.md`。

这是「信息真相猎人」：用户丢进一句话 / 截图 / 链接，查完告诉他能信还是不能信。有问题就指出问题。不要把产品写成转发顾问、论证课、或 Agent 指挥台。不要发明用户人格。

## Work standard

Verify the function and design after implementation, and keep on iterating and verifying until it's production ready. Work until you genuinely cannot improve further. Aim as high as you can.

## Issue tracker

GitHub Issues on `yishu-ziyu/red-herring-and-gun` via `gh` CLI。见 `docs/agents/issue-tracker.md`。

## Triage labels

`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。见 `docs/agents/triage-labels.md`。

## Domain

`CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

## UI

用户第一眼是判断（能信 / 不能信）和问题点，不是模型 ID、Agent 网格或过程墙。过程可回看。视觉以 `mvp/src/styles.css` 与 `mvp/DESIGN.md` 为准。
