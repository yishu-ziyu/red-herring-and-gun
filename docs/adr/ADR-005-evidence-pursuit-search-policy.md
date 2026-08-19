# ADR-005: Evidence Pursuit — Search Policy 接到证据充分性循环

## 日期

2026-08-18

## 状态

已实施（第一增量）。循环本体仍是 ADR-004；本 ADR 只补 Claim Atom → Evidence 之间的检索政策。

## 背景

ADR-004 已经把「一轮检索定生死」改成带笼子的补查循环。缺口在 **query 怎么来、什么叫搜够了**：

- 初始检索是原句 + 辟谣后缀，不是按目的分的查询组合
- 补查靠轮次模板（官方词 / 原文语境 / 当事方），不问「还缺哪一类证据」
- 融合是 URL 去重 + 辟谣启发排序，没有把多 query 结果当成多路召回
- 判停看「有没有新 URL」——同站转载也会停

产品升级要把

`Rumor → Claim Atom → Search → Evidence → Source → Verdict`

收成

`Rumor → Claim Atom → Search Planner（Evidence Gap）→ Query Portfolio → 检索/融合 → Evidence Extract → Evidence Gain → 不够则下一跳 / 足够则 Verdict`

产品层名称是 **Evidence Pursuit / 证据追索**，不是「Search Agent 又调了一次搜索」。

## 对照（六层 → 已有 / 本增量 / 以后）

| 层 | 含义 | 落点 | 本增量 |
|----|------|------|--------|
| 1 Query Extraction | `Score(q)=0.30 Rarity + 0.25 Entity + 0.20 Specificity + 0.15 Relation + 0.10 LengthQuality` | `evidencePursuit.scoreQueryDiscriminability` | **补一层**。不做从长文抽 20 句的抽取器；对已有 claim atom 的 portfolio 打分 |
| 2 Query Portfolio | Exact / Entity / Primary / Temporal / Refutation / Alternative | `buildQueryPortfolio` → `atomSearchQuery.buildAtomSearchQueries` 选 2–3 条实搜 | **补一层**。实搜预算仍封顶 3，避免 6 路 × 多源爆炸 |
| 3 多路召回 + RRF | `RRF(d)=Σ 1/(k+rank_i(d))` | `fuseByRrf` → `mergeParallelSearchPayloads` | **补一层**：同一检索引擎、不同 query 的列表融合。不假装 Google+semantic+news+academic。融合后再走原有辟谣/官方启发排序 |
| 4 Multi-hop | 搜 → 证据 → 还缺什么 → 下一跳 | 已有 `evidenceLoop` + `runCasePipeline` Phase 2a | **增强已有**。禁止第二套 pipeline / Search Agent |
| 5 Evidence Gap | `S_t=(C, E+, E-, G, Q_history)`，`q_{t+1}=π(S_t)` | `assessEvidenceGap` / `queriesForGap` | **补一层**。槽位 Actor/Action/Object/Time/Location/Primary/Support/Refute/Independent。LLM 不决定下一步 |
| 6 Marginal Information Gain | `(NewEvidence + UncertaintyReduction + SourceDiversity) / SearchCost` | `computeInformationGain` 接入循环判停 | **增强已有判停**。同站/近标题转载增益≈0，不立刻停。不做 Search-R1 / RL |

## 决策

1. 新域模块 `mvp/server/src/lib/evidencePursuit/`：纯函数，可单测。`atomSearchQuery` 负责首轮实搜；`evidenceLoop` 负责 hops。Case Pipeline 只编排。
2. 循环笼子不变：每原子最多 2 轮策略 × 每轮 2 条 query，目标原子上限 3；翻案续期 pass 仍按 ADR-004。round 2 / round 3+ 仍映射到「原文语境 / 当事方」，避免把已上线的翻案续期打穿。
3. 前端过程层展示 hops：为何搜、搜了什么、结果性质（原始来源 / 二手转载 / 反证）、还缺什么。第一眼仍是判断；过程折叠可回看。SSE 工具名用「证据追索」，不用英文 Evidence Loop。
4. hops 写入 `CasePipelineResult.evidenceLoop.pursuitHops` 与 `finalReport.evidencePursuit.hops`，供任务过程与结果页足迹消费。

## 不做

- Search-R1 / 强化学习搜策
- 虚构多搜索引擎做 RRF
- 新的平行 pipeline 或 Search Agent 人格
- 书页找书评测台（算法锁在单元测试）
- LLM 自治决定下一跳（与 PRODUCT_SPEC 第六节冲突）

## 后果

- 干净命题零开销：不触发 evidenceLoop 则不生成 hops
- 补查可能比「见到新 URL 就停」多问 1 次（转载过滤）；预算笼子仍在
- 首轮实搜在有日期/数字时最多 3 路 query（原先也可到 3）

## 实现记录（2026-08-18）

- 域模块 `evidencePursuit`：打分、portfolio、gap、RRF、gain、hops 文案
- `atomSearchQuery`：portfolio 选 query；多 query 结果 RRF 后再启发排序
- `evidenceLoop`：缺口驱动 query、增益判停、`pursuitHops`
- `runCasePipeline`：hops 合入报告；SSE adapter 透出「证据追索」
- 前端：`MissionPursuitFold` + 结果页足迹；streamAdapter 不把 hops 收成检索条数
