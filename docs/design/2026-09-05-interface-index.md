# 现有设计与界面索引

2026-09-05 用户已确认两份设计，并要求删除其他旧界面稿。总览：<http://127.0.0.1:51911/>。

## 已认可的设计基准

- `packages/web/output/show-me-parts/index.html`：零件展示「要 / 不要」，参考引用、过程折起和检索仪器的呈现。认可设计不等于逐项选择了所有候选。
- `packages/web/output/show-me-walk/index.html`：用户路径走查，参考整体界面、桌面与手机路径。原稿中的旧开发状态不是当前事实。

两个目录及跨目录依赖共 57 个文件保持原样；其中 50 张配图在总览可单独查看。后续结果原型沿用这两个基准，新增质询 A/B 位置仍待用户评价。

## 仍在使用的界面

- 当前产品 `mvp/`：<http://127.0.0.1:5174/>。首页、历史、登录/账号、调查过程、报告正文与卷宗、引用、模型设置；部分由状态进入，没有独立 URL。
- 新版开发 `packages/web/`：<http://127.0.0.1:51910/>。五种固定案件 `/cases/fx-decomposing`、`/cases/fx-retrieving`、`/cases/fx-contested`、`/cases/fx-done`、`/cases/fx-followup`；不是新调查结果或已上线证据。
- 结果页修正版：`.context/compound-engineering/ce-prototype/2026-09-05-investigation-result/01-result/screens/index.html`，同目录 `mobile.html` 是窄屏入口。被否定的首版已删除。
- 现行规则：`mvp/DESIGN.md`、`mvp/DESIGN-GALLERY.md`。

## 清理后的总览

| 分类 | 项数 |
|---|---:|
| 认可的设计 | 2 |
| 当前产品 | 3 |
| 新版开发 | 7 |
| 本轮待评原型 | 2 |
| 品牌与图标 | 10 |
| 设计说明与存档 | 7 |
| 界面源码 | 61 |
| 认可稿配图 | 50 |

共 142 项。551 个旧界面 HTML、截图和参考视频材料已删除，释放约 69.4 MiB；没有另建备份目录。路演、技术决策和第三方研究代码不属于此次界面清理，保留但不混入总览。验收见 `docs/evals/2026-09-05-design-cleanup.md`。

## 重启

总览工具位于 `.context/design-overview/`，在项目根目录运行：

```sh
python3 .context/design-overview/build.py
python3 .context/design-overview/serve.py
```

总览绑定 `127.0.0.1:51911`。新版前端另启：

```sh
npm run dev -w @rhg/web -- --host 127.0.0.1 --port 51910 --strictPort
```

当前产品 5174 使用已有开发服务。`manifest.json` 是现存文件清单，`allowlist.json` 限定可读取原件；删除审计仅保留路径与哈希，没有材料副本。
