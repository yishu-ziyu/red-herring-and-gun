# PR-A 取证

- 日期：2026-09-11
- 分支：`feat/investigation-experience`
- 起点提交：`632746e`
- 生产入口：`mvp/src/App.tsx` → `ProductApp` → `goldenPath/`（`/?legacy=1` 为旧壳）
- 部署入口：未改、未部署。本地预览 `http://127.0.0.1:5210/`

## 截图

| 文件 | viewport | 驱动 | 说明 |
| --- | --- | --- | --- |
| pra-home-desktop.png | 1440×1000 | 生产 `/` | 权限修复后的当前首页，视觉未改 |
| pra-investigating-desktop.png | 1440×1000 | `?fixture=investigating` | 真实组件树，非独立 demo |
| pra-complete-desktop.png | 1440×1000 | `?fixture=complete` | 同上 |
| pra-source-desktop.png | 1440×1000 | complete + 点证据 | 来源抽屉 |
| pra-interrupted-desktop.png | 1440×1000 | `?fixture=interrupted` | 中断 |
| pra-home-mobile.png | 390×844 | 生产 `/` | 手机首页 |
| pra-complete-mobile.png | 390×844 | `?fixture=complete` | 手机完成态 |
| proto-home-desktop.png | 浏览器默认 | 交接包 `prototype.html` | 设计提议，虚构案例，未接生产 |

`pra-*` 不是新视觉验收图。`proto-*` 与 `../screens/` 是设计提议，等用户确认后才作为 PR-B 对照。
