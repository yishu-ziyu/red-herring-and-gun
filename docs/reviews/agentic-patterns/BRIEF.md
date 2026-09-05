# Agentic Design Patterns 分章审查 — 共用合同

产品：红鲱鱼与枪。用户丢进一句话 / 截图 / 链接，查完告诉他能信、不能信，还是哪一截能信。有问题就指出问题。来源能点开。

**不是**转发顾问、论证课、Agent 指挥台、LangGraph 演示、自治 Agent。

## 你做什么

只审查你被分配的那一章。写一份审查文件。不要改产品代码。不要改说明书。不要审查别的章。

## 必读

1. 你的章节原文（路径在任务里）
2. `docs/PRODUCT_SPEC.md`（尤其第四节、第六节「明确不是」、第八节站位）
3. `CONTEXT.md`
4. `docs/adr/ADR-002-deepagents-evaluation.md`（若存在）
5. `docs/adr/ADR-003-production-case-pipeline.md`
6. `docs/adr/ADR-004-evidence-sufficiency-loop.md`
7. `docs/adr/ADR-005-evidence-pursuit-search-policy.md`
8. `mvp/server/src/lib/casePipeline/runCasePipeline.ts`
9. 任务里点名的代码路径

## 完成 ≠ 照书实现

书里的框架名、自治规划、LLM 自己选下一步、LangGraph/Crew，对本产品常常是**禁止项**，不是欠债。

「完成」的标准是：这一章要解决的问题，在**核查业务**里有没有被满足。

- 用我们的形状满足了 → `done-in-our-form`
- 书要 LLM 自治，我们故意用代码做同样的事 → 也是 `done-in-our-form` 或 `deliberate-skip`（看书的核心是「目的」还是「自治手段」）
- 书的手段会破坏判决纪律（不可复现、引用会编、不敢说查不清）→ `deliberate-skip`，写清 PRODUCT_SPEC / ADR 依据
- 缺口真的会让「能核对的说法没被查」或「没有来源却写成能信/不能信」→ `missing-and-needed`，必须给方案
- 书是写代码 Agent、GUI 操作现实世界等，与核查无关 → `missing-and-not-needed`

## 裁决只能用下面六个之一

`done` | `done-in-our-form` | `deliberate-skip` | `partial` | `missing-and-needed` | `missing-and-not-needed`

分数 0–5：5 = 这一章的**目的**在生产 Case Pipeline 里站得住。

## 输出文件格式（严格）

只写任务指定的那一个 md。中文。表述写全，不要缩到会产生第二种理解。不要用「灰」这种压缩词。立场句的界面原文是「立场型 / 不适用真/假判断」。

```markdown
# 第 N 章 · <书名>

## 裁决
<六个之一>

## 分数
<0-5> / 5

## 书要解决什么
<不超过 3 句>

## 我们有没有
<有 / 有但形状不同 / 故意不做 / 没有>
对应路径：`file.ts` 里的什么。

## 对能信/不能信的意义
<不超过 3 句。不许写框架黑话。>

## 缺口
<没有就写「无」。有就逐条：会怎样伤害用户看见的结论。>

## 方案（仅 partial 或 missing-and-needed）
Goal:
Hard bar:
改哪些文件:
明确不做:
```

证据必须点到仓库路径。不许编造文件。读不到就写「未在仓库找到」。
