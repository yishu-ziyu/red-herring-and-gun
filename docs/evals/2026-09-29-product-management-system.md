# 2026-09-29 产品管理系统：三件事各一个归宿

## 目的（用户确认）

随时能看清三件事：产品现在是什么、正在做什么、做完的事带来了什么。文档只是载体。

## 现状（2026-09-29 实测）

- `docs/` 1327 个文件；design 530、qa 291、reports 224 多为截图与运行产物。
- 「正在做什么」有 7 处回答：NOTES 头部（16 段、1.5 万字）、PRODUCT_SPEC 第八节（停在 9-06）、ROADMAP（停在 9-15）、9 个开着的 Issue、`docs/tasks/`、`docs/rewrite-issues.md`、`docs/board/`。
- 164 份验收标准只有 22 份写了结果。
- PRODUCT_SPEC 现行规则与历史混写。

## Change

1. **产品定义**：`docs/PRODUCT_SPEC.md` 只留现行规则；历史记录与被取代的说法移入 `docs/devlog/`，原位置只留一行指向。
2. **工作清单**：GitHub Project「红鲱鱼与枪」，每件事一个 Issue。字段：状态（待做 / 进行中 / 完成 / 不做）、验收标准（链接到 `docs/evals/…`）、结果（一句话 + 数字）。现有工作全部入库：看板待办、开着的 Issue、`rewrite-issues.md` 未修项、`docs/tasks/` 未完成项。
3. **完成的定义**：Issue 只有写了结果（数字或人评结论）才能关。验收标准文档末尾补「结果」一节并链接 Issue。
4. **数字**：回答基准每次运行自动追加一行到 `docs/metrics/answer-bench.jsonl`（只存汇总数字，不存第三方内容），生成 `docs/metrics/index.html` 曲线。看板的数字部分改读这里。
5. **单一入口**：NOTES 头部只写三行：当前在做的 Issue 链接、看板链接、最近一次数字；其余「当前状态」段落移入 `docs/devlog/` 归档。ROADMAP、PRODUCT_SPEC 第八节、`docs/tasks/`、`rewrite-issues.md` 改为指向 Project 的一行。
6. `AGENTS.md` 默认规则补一条：新工作先开 Issue；关 Issue 必须写结果。（用户已裁决采用本系统。）

## Not this

- 不删任何历史文档内容：移动或归档，git 可追溯。
- 本轮不搬 `docs/design|qa|reports` 下的截图与产物（上千文件、链接多），另开 Issue，用户确认后再做。
- 不往公开 Issue 里写密钥、内部配置、用户私人内容。
- 不改产品代码。

## Evaluator

| 检查 | 判法 | 类型 |
|---|---|---|
| 一问一处 | 「正在做什么」只在 Project 有实质内容；其余 6 处只剩指向链接（grep 核对） | 机器 |
| 工作入库 | 看板待办、开着的 Issue、rewrite-issues 未修项、tasks 未完成项，全部能在 Project 里找到对应条目 | 机器 + 抽查 |
| 完成有结果 | Project 里「完成」的条目 100% 有结果字段 | 机器 |
| 规则干净 | PRODUCT_SPEC 不含「历史」「已废止」「已取代」段落；行数下降 | 机器 |
| 数字自动化 | 跑一次基准后 `answer-bench.jsonl` 多一行、曲线页更新 | 机器 |
| 读得懂 | 用户打开 Project 看板与 NOTES 头部，30 秒内说出当前在做什么、最近数字是多少 | 人评 |

## 结果

- Project：https://github.com/users/yishu-ziyu/projects/1（字段：状态、验收标准、结果；「看板」视图按状态分列）。共 45 条：进行中 2、暂停 3、待做 35、完成 5；完成的 5 条都有结果字段并已关闭。新开 Issue #91–#126（36 条），既有 9 条未关、未改正文。
- 一问一处：NOTES 头部 16 段迁入 `docs/devlog/2026-09-status-archive.md`，头部只剩三行；PRODUCT_SPEC 221 → 171 行，第七、八节与被取代的说法移入 `docs/devlog/2026-09-29-product-spec-history.md`；ROADMAP、tasks、rewrite-issues、README 各留指向 Project 的一行。
- 数字：`apps/server/eval/answerBenchMetrics.ts` 已跑 current-v1，`docs/metrics/answer-bench.jsonl` 1 行，`docs/metrics/index.html` 已生成（headless Chrome 截图核对）。
- 人评项「30 秒内说出当前在做什么、最近数字」：待用户裁。
