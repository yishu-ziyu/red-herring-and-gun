# 2026-10-08 证据可追溯（第一阶段）

## Change

核查结论可点回证据来源：每条来源保留 URL、标题/发布者、来源发布日期（未知为 null）、抓取时间、片段类型（检索摘要 vs 原文摘录）、获取状态与限制说明，以及支持/反驳/背景关系；证据卡展开可见上述字段，刷新后仍可读。核查引擎内部失败时展示「本次核查未完成」的运行失败态，不误映射为「公开材料还撑不住判断」，不写可信 knowledge。

## Not this

- 不新增公网 URL 抓取能力、供应商、密钥，不提高模型 token 预算，不改默认模型成本。
- 不接 PR#136 原型，不重设计整页。
- 不做判断版本、定期复核、辟谣库接入（列为后续依赖）。
- 不修模型判定逻辑本身；fact_checker 真实链路若仍失败，明确标「整体未验收」，只用明确标记的 fixture 验证展示/存储。
- 不新增/运行单元或集成测试（本轮用户指令）。

## Evaluator

1. `cd apps && npx tsc --noEmit` 与 `npm run build` 通过；`packages/core` 镜像文件与 `apps/server` 对应文件字节一致（`diff` 命令）。
2. 人评（真实浏览器）：本地输入一条说法 → 调查跑完 → 展开证据卡可见 URL、发表时间（或「未知」）、取得时间、片段标注（检索摘要）、获取状态；刷新页面后上述信息仍可读。
3. 人评：fact_checker 内部失败的 run 显示「本次核查没能完成」/中断态而非「公开材料还撑不住判断」；`knowledge_entries` 无该 atom 的新写入（SQLite 查询对照）。
4. 命令：`sqlite3` 查询本地 case 存档中来源字段含 publishedAt（或缺省）、retrievedAt、excerptKind、fetchStatus；旧数据行无新字段时不报错。

## 结果

2026-10-08 独立 review 后修 6 项（同源展示 / 失败隔离 / 终态一致 / 补查元数据 / 用户材料入口 / 登记合并）。

1. `apps` 侧 `npx tsc --noEmit` 0 错；`npm run build`（vite）与 `cd server && npm run build`（tsc）均通过；`investigation/build.ts` 与 `schema.ts` 在 `apps/server` 与 `packages/core` 字节一致（`diff -q` 通过）。`packages/core` 独立 tsc 受本环境缺 @types/node 阻塞（既有，非本次引入）。
2. 真实浏览器（隔离本地实例，非真人试用）：首页 → 示例案例 → 证据卡 → SourceDrawer 打开正常；摘录、命题、发表/取得时间区渲染；旧数据无新字段显示「未知」。截图 `ss_6b06958d.png`。受控数据 UI 验收（localStorage 种子快照经「历史记录」打开，非真实 AI 核查）：intake-only 材料入口可点击开抽屉（相关材料 +「你提交的材料」+ 原文摘录 + 真实 scrapedAt），403 材料显示「原文没能取到」，已有正文再抓 403 保留旧正文并记「再次抓取失败」，scrapedAt 缺失分支发表/取得时间显示「未知」，同 URL 升级证据卡显示正文片段；F5 刷新后历史记录重开材料仍可读。截图 `ss_d967ceac.png` `ss_da0c69ee.png` `ss_c10de4a9.png` `ss_e52e4985.png` `ss_9cc2f2b7.png`。
3. 受控 fixture（`rhg-fixture.mts`，16/16 通过，明确标注非真实 AI）：同 URL 摘要升级正文（B1–B3）、intake-only 用户材料入口（B4–B7）、抓取失败/未知状态区分（B5–B6）、正文升级 scrapedAt 缺失→取得时间清空（B8）、已有正文再抓取 403→正文保留且新失败如实记录（B9）、先失败后成功→升级且旧失败记录不吞（B10）、补查元数据持久化（C1–C2）、报告步骤失败但 fact 有判词时 _source=error-boundary + 广播仅 interrupted 帧 + settle 0 次（A1–A4）。material 入口的 live-view 由 resolveSourceDrawerView 的 `material:` 身份解析支持（source-only，随新快照更新）。
4. 未验证：真实 AI 端到端 run（模型链路受限，未重复探针）；真实 intake AI run（需真实抓取链路产生材料，本次验收为受控 localStorage 数据）；服务端登录存档路径的材料入口（本次验收走本地 localStorage 恢复路径，同一 InvestigationCanvas/Dossier/Drawer 组件）。
5. 后续依赖：判断版本化、定期复核/探活周期化、debunkArchive 接入、知识库原文快照。
