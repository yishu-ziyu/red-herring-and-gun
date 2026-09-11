# 预览方向两处改动 · 验收标准

- 日期：2026-09-11
- 用户原话：首页示意块「不用呈现出来，不觉得很呆吗」；调查中 fixture「交互设计还要尽量做得稍微有趣且高级一些」。改完方向差不多。
- 生产入口：`mvp/src/App.tsx` ProductApp。

## Change

1. 生产首页不再出现「不只给结论…」和「查完大概长这样」示意卡。进门只留标题、输入、例子、职责头像。
2. 调查中（`?fixture=investigating` 与真实流的 investigating 态）不再像一份全展开审计表。原句在左；当前发现在右；未开始的命题收起；正在工作的职责清楚，其余弱化。新发现用短动效提示状态变化，不摇头像。

## Not this

- 不删核查数据、不把虚构公园案例当真实结果。
- 不把调查中做成四个执行面板或 Agent 控制台。
- 不靠循环晃动头像制造「有趣」。
- 不准为变绿删掉「待核对不能染成支持/反驳」这类正确性测试；首页示意块的旧断言映射为「不再出现」。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | `/` 没有 `[data-gp-result-preview]`，没有「查完大概长这样」「维生素 C」「不只给结论」 | `App.test.tsx` | 命令 |
| E2 | 首页仍有标题、输入、「开始调查」、四职责、示例 | `App.test.tsx` | 命令 |
| E3 | 调查中：pending 命题默认收起；searching 命题证据仍在，待核对中性 | `goldenPath.test.tsx` | 命令 |
| E4 | investigating → complete 同一证据节点仍在（不因改布局丢 identity） | 既有 identity 测试仍绿 | 命令 |
| E5 | reduced-motion 下无强制位移动画 | CSS `@media (prefers-reduced-motion: reduce)` 覆盖调查进入动效 | 命令（读 CSS）+ 人评 |
| E6 | 桌面 1440、手机 390 首页与调查中截图 | Playwright fixture | 命令出图，人评观感 |

旧契约 `docs/evals/2026-09-11-homepage-entry.md` 的 E3（首页必须有示意块）被本文件取代。
