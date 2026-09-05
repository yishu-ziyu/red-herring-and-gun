# 施工规范合同（独立审查员）

你不是上一轮写 `ch-NN.md` 的人。
你要挑刺：事实是否站得住、有没有漏、反例能不能打穿、方案会不会违反产品说明书。

读完后只写**一份**规范文件。不要改产品代码。不要改 `ch-NN.md`。不要改说明书。

## 必读

1. `docs/reviews/agentic-patterns/INDEX.md`
2. `docs/reviews/agentic-patterns/BRIEF.md`
3. 你负责的 `docs/reviews/agentic-patterns/ch-NN.md`
4. `docs/PRODUCT_SPEC.md` 第一、四、六节
5. INDEX 里点名的代码路径（打开核对，不许用印象）

再抽读至少两份其他章的 `ch-*.md`（优先 INDEX 写了和你重叠的章），避免两章改同一函数。

## 裁决怎么变成施工

INDEX 已有「要不要动手」。你可以推翻，但必须引用**仓库路径 + 用户会看见的失败场景**。
不能因为「书里还有 LangGraph 示例」就开工。

`status` 只能是：

- `implement` — 本轮要改代码或测试
- `verify-only` — 不改产品；执行员只跑已有测试、写验收记录

5 分且 INDEX 写「否」的，默认 `verify-only`。
只有发现真实漏查 / 没来源却写成能信或不能信，才改成 `implement`。

## 明确禁止写进规范

- LangGraph / Crew / DeepAgents / 模型自选工具 / 模型自选下一步
- 另雇更强分类模型当路由
- 开放浏览、用户手选 frontier、思考链当产品脸
- 微调 / PPO
- Google A2A 协议
- 仇恨/政治内容审核智能体
- 大重构、重命名、顺手清理无关代码

## 文件独占（写 implement 时必须遵守）

| 章 | 你只许点名这些路径 |
|----|-------------------|
| 2 | `mvp/server/src/lib/claimAtom/**`（可新建纯函数闸）+ 其测试。接线最多改 `runCasePipeline.ts` 一处调用。禁止改 eval、禁止改 `atomSearch.ts` 选条逻辑（那是第 20 章） |
| 6 | `mvp/server/src/lib/atomSearchQuery.ts` 的案件类型问法 + 对应测试。禁止改记忆模块 |
| 9 | `mvp/server/src/lib/memoryCandidateGenerator.ts` / store 读取侧种子 query。可新建 `mvp/server/src/lib/queryReuse.ts`。禁止改 `buildAtomSearchQueries` 的主配方（第 6/20 章） |
| 12 | 只许 `runCasePipeline.ts` 的 `fallbackAgentStep` 及 `runCasePipeline.test.ts` |
| 13 | 只许前端结果页 + 已有 memory candidate API 客户端。禁止新指挥台 |
| 14 | 只许 `mvp/server/src/lib/atomSearch.ts` 的 bind 与其测试：剥光 URL 后 true/false → unverified |
| 18 | 只许 `claimAtom/merge.ts` 的 merge 规则、`reportAssembly/assembleFinalReport.ts` 的 `deriveOverallVerdict`、`reportReviewer.ts` 及其测试。不要重复实现第 14 章的 bind |
| 19 | 只许 `mvp/server/eval/**`。禁止改生产管线 |
| 20 | 只许 `atomSearch.ts` 的 `selectAtomsToSearch`、`assembleFinalReport.ts` 的未检索条展示、`evidenceLoop.ts` 的 `findLoopTargets` 排序、及其测试 |
| 8 | 默认 verify-only（确认按钮归第 13 章） |
| 10 | 若 implement：只许 `mixerMcp.ts` 最小鉴权，可关默认 |
| 16 | 若 implement：只许 provider 超时/跳过已死家，不要改检索策略 |
| 其他章 | 默认 verify-only |

## 输出路径与格式

只写：`docs/reviews/agentic-patterns/specs/ch-NN.md`

```markdown
# 第 N 章施工规范 · <模式名>

## status
implement | verify-only

## 独立审查意见
<最多 5 句。指出原报告哪里对、哪里过满、哪里漏。>

## Goal
<执行完必须存在什么>

## Hard bar
<when I do X, I see Y。可自动测的优先。>

## 改哪些文件
<implement 才填。路径 + 做什么。verify-only 写「无」。>

## 测试
<具体命令或要新增的测试名>

## 明确不做
```

中文。表述写全，不要缩到会产生第二种理解。不要用「灰」。立场句写「立场型 / 不适用真/假判断」。
