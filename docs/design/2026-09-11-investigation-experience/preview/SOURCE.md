# PR-B 取证

- 日期：2026-09-11
- 分支：`feat/investigation-experience`
- 生产入口：`mvp/src/App.tsx` ProductApp（真实 `goldenPath` 组件，不是独立 demo）
- 本地预览：`http://127.0.0.1:5210/`
- fixture：`/?fixture=investigating|complete|interrupted`（DEV，驱动真实组件树）

| 文件 | viewport | 驱动 |
| --- | --- | --- |
| prb-home-desktop.png | 1440×1000 | 生产 `/` |
| prb-investigating-desktop.png | 1440×1000 | `?fixture=investigating` |
| prb-complete-desktop.png | 1440×1000 | `?fixture=complete` |
| prb-source-desktop.png | 1440×1000 | complete + 点证据 |
| prb-interrupted-desktop.png | 1440×1000 | `?fixture=interrupted` |
| prb-home-mobile.png | 390×844 | 生产 `/` |
| prb-complete-mobile.png | 390×844 | `?fixture=complete` |

头像用仓库既有 `mvp/public/agents/*.png`，不是交接包概念裁图。
2026-09-11 用户裁定后：首页示意卡已去掉；调查中改为左原句、右发现，未开始的命题收起。
另有 `prb-investigating-mobile.png`（390×844，`?fixture=investigating`）。
视觉是否满意由用户判断。
