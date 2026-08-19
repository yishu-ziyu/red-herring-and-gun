# 《Agentic Design Patterns》21 章对照总表

日期：2026-08-19。
书：`vendor/agentic-design-patterns`（xindoo 中译，[源仓](https://github.com/xindoo/agentic-design-patterns)）。
分章原文：`docs/reviews/agentic-patterns/ch-01.md` … `ch-21.md`。
合同：`BRIEF.md`。

「完成」= 这一章要解决的问题，在核查业务里是否被满足。
不是「有没有照书上 LangGraph / 自治规划 / 模型自选工具」。
书里那些手段，多数记在第六节「明确不是」，算故意不做，不算欠债。

均分 **4.2 / 5**。
14 章 `done-in-our-form`。
7 章 `partial`。
0 章 `missing-and-needed`。
0 章必须按书补自治 Agent。

---

## 总表

| 章 | 模式 | 裁决 | 分 | 对能信 / 不能信 | 要不要动手 |
|----|------|------|----|-----------------|------------|
| 1 | 提示词链 | done-in-our-form | 5 | 先拆再核，才不会整句糊成一个判断 | 否 |
| 2 | 路由 | partial | 4 | 该查的才查；标错立场则该查的没查 | 要。类型闸补复核 |
| 3 | 并行化 | done-in-our-form | 5 | 多源同时捞，一路挂了不整句判假 | 否 |
| 4 | 反思 | done-in-our-form | 5 | 第一轮没命中不立刻写成不能信 | 否 |
| 5 | 工具使用 | done-in-our-form | 5 | 结论必须对着可点开的外部材料 | 否。不打开模型自选工具 |
| 6 | 规划 | partial | 4 | 下一步只有继续查 / 换问法 / 停；截图数字引语还没分策 | 要。落地 P2，不恢复 DAG |
| 7 | 多 Agent | done-in-our-form | 5 | 分工传材料；打架只降分不改判词 | 否 |
| 8 | 记忆 | done-in-our-form | 4 | 旧案能召回；不当本案证据 | 可选。结果页确认按钮 |
| 9 | 学习适应 | partial | 3 | 同类谣第二次仍从零搜 | 要。复用上次打中的问法 |
| 10 | MCP | done-in-our-form | 4 | 可被 360/MiXer 调用；内部判真假不靠 MCP | 可选。鉴权 |
| 11 | 目标与监控 | done-in-our-form | 5 | 目标是「证据够不够」，停因四种 | 否 |
| 12 | 异常恢复 | done-in-our-form | 4 | 失败显式；无证据不写成假 | 要盯。核查挂了+像辟谣链接会误收不能信 |
| 13 | 人机协同 | partial | 4 | 人看结论和来源；人不指挥检索 | 可选。记忆候选确认 |
| 14 | RAG | done-in-our-form | 4 | 按原子搜公开页，剥虚构网址 | 要。无网址不得留真/假 |
| 15 | A2A | done-in-our-form | 5 | 同进程传原子和网址，不传演戏 | 否。不上 Google 协议 |
| 16 | 资源 | done-in-our-form | 4 | 笼子限制次数；全挂应收成还查不清 | 可选。冷启动空等 |
| 17 | 推理 | done-in-our-form | 5 | 推理=拆开再逐条核，不是思考链表演 | 否 |
| 18 | Guardrails | partial | 3 | 编网址已挡住；没查却写成能信/不能信没挡死 | 要。无网址改 unverified |
| 19 | 评估监控 | partial | 3 | 门禁抓不住拆反、空检索判假、类型漏查 | 要。先补 eval |
| 20 | 优先级 | partial | 3 | 预算按原句前 6 条切，后半截可能没查 | 要。按负荷选 6 条，没查的仍展示 |
| 21 | 探索 | done-in-our-form | 5 | 换问法找出处；仍没有就还查不清 | 否。不开开放浏览 |

---

## 七条缺口：方案（按存在条件排序）

先做评测，再改闸。否则改完不知道有没有用。

### 1. 评测先能抓住三类错（第 19 章）

Goal: 半真半假拆反、零来源写成不能信、能核对的说法被标立场所以没查，这三件必须让 `eval:gate` 变红。
Hard bar: 各放一条黄金案；对调原子 / 零 URL 写 false / 该搜却没搜，`overallPass === false`。
改：`mvp/server/eval/golden.ts`、`score.ts`、`score.test.ts`、`run.ts`、重写 `baseline.json`。
不做：LLM 评委、不改生产管线、不加类型第二意见（那是下一条）。

### 2. 没有可点开网址，不得停在真/假（第 14、18 章）

Goal: bind 之后一条 URL 都不剩的原子，必须变成 unverified。
Hard bar: 模型写 true 但来源被剥光 → 该条还查不清；整句不得因此写成能信或不能信。
改：`atomSearch.ts` bind、`claimAtom/merge.ts`、`deriveOverallVerdict`、`reportReviewer.ts`，加单测。
不做：内容政策审核模型、仇恨/政治过滤。

### 3. 类型闸补复核（第 2 章，创始人已知不满）

Goal: 「某地要建地铁」「隔夜菜会致癌」即使被标成立场，仍必须进检索。
Hard bar: 主拆题输出 `verifiable: false` 时，读起来像流传说法的那条仍出现在 `atomsSearched`；纯价值句仍是「立场型 / 不适用真/假判断」。
改：`claimAtom/` 纯函数闸，或只对争议条异源再填一张类型工单；接线 `retrieveForAtoms` 与报告组装。
不做：LLM 自选下一条链、另雇更强专职分类器、LangGraph。

### 4. 检索预算按「最能改结论」花（第 20 章）

Goal: 7 条可核查时，带因果或数字的那条不能因为排第 7 就从报告里消失。
Hard bar: 第 7 条是「导致…」时必须被检索；没进预算的条仍展示，且只能是 unverified。
改：`selectAtomsToSearch` 打分；`claimItems` 保留未检索条；补查先 conflict 后 unverified。
不做：无限搜、模型自己重排原子。

### 5. 案件类型分策（第 6 章 = 说明书 P2）

Goal: 截图查原图出处，数字找原始发布，引语找回原语境。
Hard bar: 旧图新配文不能只核配文；统计数字必须指向公报或原始数据页。
改：intake / `atomSearchQuery` 按材料形态换检索策略，不改主链拓扑。
不做：恢复 ADR-001 生产 DAG、开放式规划器。

### 6. 同类谣复用问法，不复用结论（第 9 章）

Goal: 第二次查「电瓶车被偷至非洲」时，先试上次打中的问法；来源必须是本案新搜到的 URL。
Hard bar: 记忆命中后 `buildAtomSearchQueries` 含历史 query；报告引用不得来自旧案快照。
改：记忆候选 → `atomSearchQuery` 种子；eval 不写回拆题。
不做：微调、PPO、改自己的代码。

### 7. 人决定记不记得住（第 13 章，可选）

Goal: 结果页能确认或丢掉一条记忆候选。
Hard bar: `proposed` 不进检索策略；点确认后下一案召回能命中。
改：结果页按钮接已有 `memoryCandidate` API。
不做：人在循环里选 frontier、指挥台。

第 8 章（记忆召回本身）、第 10 章（MCP 鉴权）、第 12 章（核查挂了误收不能信）、第 16 章（冷启动空等）写在分章里，不挡上面 1–4。

---

## 故意整章不按书做的

| 书要的 | 我们 | 依据 |
|--------|------|------|
| LangChain / LangGraph / Crew 当运行时 | 不用 | ADR-002、说明书第六节 |
| 模型自己选工具、自己选下一步 | 不用 | 判决不可复现、引用会编 |
| 开放式规划 / Deep Research | 不用 | 下一步可枚举：查 / 换问法 / 停 |
| 微调、强化学习 | 不做 | 说明书第八节 |
| Google A2A 跨厂协议 | 不做 | 赛题不要求 |
| 用户手选 frontier | 不做 | ADR-004 |
| 思考链当产品脸 | 不做 | 第一眼是能信 / 不能信 |

---

21 个审查员只读仓库、各写一章。
本文件由主会话对照分章汇总，未改产品代码。
