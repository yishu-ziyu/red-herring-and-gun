# 迭代 Spec · 「拆解优于不拆解」对照实验验证方法（decomposition AB validation）

> 日期：2026-08-06
> 状态：方法文档（本轮不出实验代码）
> 所属：周打磨 · 阶段1 核查正确性 · 拆解质量验证
> 依赖：`2026-08-06-claim-atom-selfproof-gate.md`（原句自证闸门已落地）、`2026-08-05-server-subclaim-verdicts.md`（逐命题定罪）、`2026-08-05-exclusion-layer-nonverifiable-claims.md`（排除层）、`goldenDataset.ts` / `evaluationMetrics.ts` / `benchmarkRunner.ts`

## Why

自证闸门落地后，系统能在拆解这一步挡住不忠实的原子。但挡得住噪声，不等于拆解本身值得做。产品花了成本和延迟去拆 claimAtoms，就应该能用数据回答一个更基本的问题：**拆，到底比不拆好多少？**

现有评估体系回答不了这个问题。原因有三，按重要性排：

第一，golden 的 mock 根本没拆。`benchmarkRunner.ts` 里 `rumor_detector` 的 mock 输出是 `claimAtoms: [case_.claim]`——把整条 claim 原封不动当成唯一原子。也就是说，benchmark 测的其实是"不拆"路径，而生产路径走的是"拆了再核"。这两者根本不在同一条赛道上，现有指标自然无法证明拆解的价值。

第二，现有 metrics 只测终点，不测过程。`evaluationMetrics.ts` 的 `scoreCase` 看的是 `finalReport` 的 `verdictType`、`credibilityScore`、agent 顺序、幻觉标记。这些是整条流程的出口结果，跟"拆解步骤的中间质量"无关。一个拆解烂、但 report_composer 恰好把整句判对的系统，在现有指标下照样满分。

第三，没有对照。golden 是一份固定的正样例，没有"同一批 case 分别走有拆/无拆两条路"的设计。没有对照组，任何关于拆解价值的结论都只是推理，不是证据。

这份文档给出一个可落地的对照实验方案，目标是在 golden set 上回答"拆优于不拆"，并且把"过程质量"也纳入观测——这正是 Grove 意义上的过程检验：不只验收终点，也验收中间步骤产出的质量。

## 核心问题与假设

要验证的命题：**把 claim 拆成经过自证闸门过滤的 claimAtoms 再交给 fact_checker，比直接把整句交给 fact_checker，能带来更好的核查产出。**

拆的逻辑是：噪声拆解挡掉原句未声称的信息后，fact_checker 只对着真正该核的原子定罪，逐条可审计；不拆的话，fact_checker 面对整句，只能给一个笼统总判，真伪混杂处说不清。

但这有个前提假设值得先质疑：**拆解本身可能引入新噪声**。拆错、拆出碎片、拆丢限定条件，都会让 fact_checker 对着错误的目标核查。自证闸门把一部分噪声挡在入口，但它不完美（LLM 判断，fail-open）。所以"拆优"不是必然成立的，这正是要做对照实验的原因——如果实验证明拆和不拆在终点指标上无差异，那拆解的成本就不值得付，结论应该反过来。

## 实验设计

### 分组与配对

取同一批 golden case（当前 10 条 RUMOR，覆盖 event/causal 两类），每条 case 跑两个 arm：

- **Arm A（实验组，有拆）**：rumor_detector 真实拆解 → 自证闸门过滤 → 过滤后的 claimAtoms 进 fact_checker → 逐条定罪 → report_composer。
- **Arm B（对照组，无拆）**：整条 claim 直接进 fact_checker → 整句定罪 → report_composer。

同一 case 的 A/B 是"配对样本"——共享同一 claim、同一 golden 结论、同一搜索材料，只有拆解这一步不同。这是最小化环境噪声的关键：**不是拿 A 组全部 case 和 B 组全部 case 比，而是逐 case 配对比**。这样 search 的随机性、模型采样方差都被尽量限制在配对内。

### 关键操作方法

**第一条：不能用 mock 跑 A。** 现有 `benchmarkRunner` 的 mock 把整句当原子，跑 A 等于没跑。A 必须走真实拆解。两条可行的路：

1. 在 server 生产路径上，对每条 golden case 跑一次 A（真实 rumor_detector + 自证闸门 + fact_checker + report_composer），采集 `subclaimVerdicts` 与最终 report；B 则在同一条路径上跳过拆解、把 claim 直接给 fact_checker。
2. 在 benchmark 侧扩展一个 runner，把 A 的 rumor_detector 输出换成真实 LLM 产出的 claimAtoms（先离线采集一次，固化进 fixture），再走 mock 的其余步骤。这条路可复现、可跑快，但 claimAtoms 是采样的，抽样方差要算进去。

两条路各有用。**建议先走 2 做机制验证（快、可回归），再走 1 做端到端确认（真、慢）。** 本轮的难点不在指标计算，而在 A 的"真拆解"数据从哪来——这决定了实验的诚实度。

**第二条：每条 case 的 A 至少跑 N 次（建议 N≥3）。** 拆解是 LLM 采样，单次跑会随机过拆或漏拆。取多次结果的聚合，才能区分"拆的数量级"和"单次采样噪声"。B 同理，保持臂内样本量对称。

### 指标

四组，前两组是现有指标的直接复用，后两组是这次新增的"过程质量"观测。

**1. verdict 准确率**：`scoreCase` 已有的 `verdictCorrect`——系统 `verdictType` 是否命中 golden `expectedVerdictType`。A/B 都算，配对比较。

**2. 幻觉率**：`isHallucination` 的语义——golden 该是 unverified/mixed 时系统给了 true/false 的确定判断。拆解后 fact_checker 面对的粒度变小，理论上更不容易整句误判，这正是要验证的。

**3. credibility 命中率**：`credibilityInRange`。拆解理论上让 credibility 更贴合 golden 区间，因为逐条定罪能暴露"部分属实"的层级差异（如 RUMOR-008 的 mixed_misleading）。

**4. 可审计性（新增，过程质量的核心）**：golden set 里没有直接标注这个，要用派生的代理指标测。建议三个子项：

- 逐条定罪覆盖率：`subclaimVerdicts` 中非 `unverified`（即模型真的给了 true/false/partial/exaggerated）的原子占比。有拆的 A 应该显著高——因为 claimAtoms 是明确可查的原子，fact_checker 知道该给谁定罪；无拆的 B 只有整句一条，往往只能回 unverified。
- 真伪分辨度：report 里 `verdictType` 为 mixed 时，`subclaimVerdicts` 是否能把"真的部分"和"假的部分"分开标注（true 与 false/exaggerated 并存）。这直接对应"报告能否清晰区分信息的真伪部分"。
- 证据绑定度：`subclaimVerdicts` 条目的 `supportingSources` / `contradictingSources` 非空占比。拆得越忠实，证据越能落到具体原子，而不是飘在整句上。

可审计性是这次实验里最不该丢的指标——因为它才是"拆"相对"不拆"在**结构性**上真正不同的地方。verdict 准确率可能因为整句恰好判对而打平，但可审计性是拆解独有的、无法被巧合掩盖的优点。

## 判定标准（怎样算"拆优"成立）

不设单一阈值拍板，用三层证据：

- **主证据（终点）**：A 的 verdict 准确率 ≥ B，且 A 的幻觉率 ≤ B。若 A 反而更差，直接推翻"拆优"。
- **结构证据（过程）**：A 的逐条定罪覆盖率和真伪分辨度显著高于 B。即便终点打平，只要结构证据朝向 A，也可判定"拆"在可审计性维度上有实质收益。
- **成本观察（延迟）**：记录 A 相对 B 的额外延迟（拆解 + 自证闸门）。如果"拆优"只在终点轻微占优、却多花明显延迟，结论要写清楚"拆的收益与成本相当"，而不是笼统说"拆更好"。

三层合起来，结论才诚实：**拆的价值若只在可审计性、不在终点准确率，那也是价值，但要如实标注它的边界。**

## 非目标（本轮不做）

- **不写实验代码**。本轮只出方法文档，明确"怎么验、验什么、怎么判"。实验代码（runner 扩展、fixture 采集、配对聚合）单独立迭代。
- 不在生产路径加实验开关（AB 分流是离线验证，不是线上功能）。
- 不扩 golden set（10 条已够做机制验证；样本不足时结论只能算提示，不能算证明）。

## 落地边界

本条仅为方法文档，无代码改动。它锚定的是现有代码的两个真实结构：

- A 臂的"真拆解"数据要来自 server 生产路径的 `runClaimAtomSelfProof`（已落地，见 `2026-08-06-claim-atom-selfproof-gate.md`），或离线采集其输出作 fixture。
- 指标复用 `evaluationMetrics.ts` 的 `scoreCase` / `aggregateMetrics`，新增"可审计性"为派生指标，不改既有 metric 语义。

## 受影响文件

- 新增：`mvp/docs/superpowers/specs/2026-08-06-decomposition-ab-validation.md`（本文档）。
- 引用（本轮不改）：`evaluation/goldenDataset.ts`、`evaluation/evaluationMetrics.ts`、`evaluation/benchmarkRunner.ts`、server `agentConfigs.ts` / `handlers.ts`。