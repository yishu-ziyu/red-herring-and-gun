# 红鲱鱼与枪 · 界面

这是核查产品。不要做成多 Agent 运维界面。

现行生产是 `apps/src/goldenPath/`。活 token 在 `apps/src/goldenPath/golden-path.css` 的 `:root`。改样式先改那份 CSS。旧三栏只在 `/?legacy=1`。

**第一屏要回答：** 这句话站不站得住？凭什么？来源在哪？不要用「能信」四字章当第一句。

完成态按论证读：判断 → 解释 → 依据（论点、片段收据、出处）。调查中按快照的 phase 出场，不把还没开始的职责提前铺开。

| 角色 | token | 大约 |
|------|--------|------|
| 纸底 | `--gp-bg` | `#f6f4ef` |
| 墨 | `--gp-ink` | `#292929` |
| 辅文 | `--gp-ink-2` | `#5d5d5d` |
| 弱提示 | `--gp-ink-3` | `#9e9e9e` |
| 强调 | `--gp-accent` | `#a13734` |
| 字号 | `--gp-type-12/13/14/24` | `12 / 13 / 14 / 24px` |
| 字距 | `--gp-tracking` | `-0.15px` |
| 卡片圆角 | `--gp-radius-card` | `16px` |
| 导航圆角 | `--gp-radius-sm` | `8px` |
| 有依据 | `--gp-semantic-support` | `#28705a` |
| 不成立 | `--gp-semantic-contradict` | `#a13734` |
| 尚不确定 | `--gp-semantic-gap` | `#8a651e` |

颜色只辅助，不单独表示判断。衬线给判断句、原句、摘录；sans 给 UI。动效只用 `--gp-motion-*` 与 `--gp-ease-out`，尊重 `prefers-reduced-motion`。

产品规则以 `docs/PRODUCT_SPEC.md` 为准。
