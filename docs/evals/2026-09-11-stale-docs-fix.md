# 陈旧入口文档改掉或删除 · 验收

- 日期：2026-09-11
- 用户原话：都不用加过期，最好直接把它删了，要么直接改掉。

## Change

入口文档与代码一致。不加「历史横幅」。

- `docs/ARCHITECTURE.md`「现在真正的路径 / 三层」改成 Golden Path，不再画 MissionControl / Dashboard。
- `apps/DESIGN.md` 改成现行 golden-path 纸色与路径。
- `docs/design/2026-09-05-interface-index.md` 删除（9 月 5 日总览，会把 `packages/web` 和旧端口当成当前产品）。
- `docs/ROADMAP.md` 删掉仍标「待议」的空节。
- ADR-003 / ADR-007 状态行改成现在的事实。

## Not this

- 不给旧文盖「已过期」横幅充数。
- 不删 `apps/docs/`（已有横幅的工程记录，这次不动）。
- 不改产品代码。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | `ARCHITECTURE.md` 不含 `MissionControlView`、`Dashboard（贴材料）`、`ApodexRunView` 当默认脸 | `rg` | 命令 |
| E2 | `ARCHITECTURE.md` 默认脸是 `goldenPath` | `rg` | 命令 |
| E3 | `apps/DESIGN.md` token 是 `#f6f4ef` / `#a13734`，活 CSS 是 `golden-path.css` | 读文件 | 命令 |
| E4 | `docs/design/2026-09-05-interface-index.md` 不存在 | `test ! -e` | 命令 |
| E5 | `ROADMAP.md` 不含「待议」 | `rg` | 命令 |
| E6 | ADR-007 状态不再写「实施中」当生产已切 | 读文件 | 命令 |
