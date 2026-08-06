# 迭代 Spec · 原句自证闸门：拆解忠实性校验（claim-atom self-proof gate）

> 日期：2026-08-06
> 状态：已实现
> 所属：周打磨 · 阶段1 核查正确性 · 拆解质量闸门
> 依赖：`2026-08-05-server-subclaim-verdicts.md`（逐命题定罪已落地）、`2026-08-05-exclusion-layer-nonverifiable-claims.md`（排除层：不可核查原子单独处置）

## Why

逐命题定罪链路（`subclaimVerdicts`）与排除层（`splitVerifiableAtoms`）落地后，仍有一个上文游离的缺口：**RumorDetector 用模型拆出的 claimAtoms 本身没有被校验是否忠实于原句。**

现有两层闸门都拿 claimAtoms 当"可信锚"：
- `splitVerifiableAtoms` 判的是原子**类型**（价值/预测 → 不可核查），不判原子是否原句说过。
- `mergeSubclaimVerdicts` 的幻觉拦截只丢"不在 claimAtoms 里的编造原子"，拦不住 rumor_detector 自己在 claimAtoms 里掺的、原句未声称的信息。

于是三类噪声直接进入高成本核查（fact_checker）：
1. **过度碎片化**：一个判断被拆成多个冗余/无独立含义的碎片，逐个核查浪费成本、稀释结论。
2. **上下文丢失**：拆解时丢掉限定条件（"某种情况下 X" 被拆成 "X"），使原子与原句语义不符。
3. **原句未声称信息**：拆解时加入原句没有的信息、补全上下文或注入模型常识，污染可审计性。

产品承诺"可审查、可审计"。原句自证闸门是让"逐命题定罪"只对**原句真正声称过的、且保有独立含义的**原子定罪的第一步——先挡住不忠实的拆解，再谈核查该查的。

**与排除层的分工**：排除层判"这个原子本身能不能核查"（类型，verifiable=false 不订真/假）；原句自证判"这个原子是不是原句说过的"（忠实性，supported=false 直接丢弃）。两者互补，不冲突。

## What Changes

### 1. 确定性预过滤（先做，零成本）

文件：`mvp/server/src/lib/agentConfigs.ts`

新增纯函数 `prefilterClaimAtoms(claim, rawAtoms): { atoms: string[]; dropped: Array<{ text: string; reason: string }> }`：
- 去空、截断（复用 `compactStrings` 的上限 6 条 / 180 字，保持与 `mergeSubclaimVerdicts` 同键）。
- 去重：规范化（去首尾空白、去全角/半角空格）后完全相同的原子只保留一条，重复项记入 `dropped`（reason: `duplicate`）。
- **不做**整句判别 / 语义去重（那是 LLM 自证做的事，避免过度启发式误杀）。

### 2. 独立 LLM 自证调用（批量单次，保证忠实）

新增 `runClaimAtomSelfProof(claim, atoms, callModel)` → `{ kept: string[]; dropped: Array<{ text: string; reason: string }>; model: string }`：

- **批量单次**：一次 LLM 调用校验全部原子，不为每个原子单独调用（压成本）。
- 复用 `callAgentWithFallback`（`server/src/lib/providerRouter.ts`），用自定义 `SELF_PROOF_SYSTEM_PROMPT` + `selfProofSchema`。
- 自证判断标准（DecompScore 式"原句自证"）：每个原子只有当**原句直接支持它** 且 **它作为独立断言仍保有明确含义** 时才 `supported=true`。具体：
  - 原子加入原句未声称的信息 / 补全上下文 / 注入常识 → 不支持（drop）。
  - 原子删除了原句的限定条件、改变了语义 → 不支持（drop）。
  - 原子是截断到失去独立含义的碎片 / 与另一被保留原子冗余 → 不支持（drop）。
  - 原子由原句直接支持且独立可查 → 支持（keep）。
  - **忠实 vs 可核查的边界**：本闸门只判"忠实"（原句是否直接声称），不判"可核查性"。立场/价值/预测型原子若原句直接声称了该立场或断言，即使它本身不可核查，也应判 `supported=true`——是否可核查由排除层（`splitVerifiableAtoms`）另行处置。
- 输出 schema：
  ```json
  { "results": [ { "atom": "原子文本", "supported": true, "reason": "判断依据" } ] }
  ```
- **fail-open**：LLM 调用失败 / 超时 / 输出不可解析 / 某原子在结果中缺失 → 该原子一律保留，绝不在基础设施故障时误杀有效原子。`kept` 顺序保持输入顺序。

### 3. 编排插入点（两个 handler，事件契约不改）

文件：`mvp/server/src/handlers.ts`

在 `orchestrateHandler`（此刻位于 rumorStep 之后、`get360SearchForClaim` 之前，约 L769-L771）与 `orchestrateStreamHandler`（约 L1006-L1014）两处：

- rumor_detector 完成后，把自证闸门与搜索**并行**跑（`Promise.all`），压掉额外延迟：
  ```ts
  const [search360Result, selfProof] = await Promise.all([
    get360SearchForClaim(claim),
    runClaimAtomSelfProof(claim, rumorStep?.output?.claimAtoms ?? [], callModel),
  ]);
  // 忠实过滤：只有 supported 的原子进入下游
  rumorStep.output.claimAtoms = selfProof.kept;
  // 诊断元数据（加字段，不删字段，不破坏事件契约）
  rumorStep.output.claimAtomSelfProof = {
    kept: selfProof.kept,
    dropped: selfProof.dropped,
    model: selfProof.model,
  };
  ```
- 下游（fact_checker input、`mergeSubclaimVerdicts` 锚定、`splitVerifiableAtoms` 排除层）全部读到过滤后的 `claimAtoms`，链条一致。
- **不**新增 streamed agent 事件（`agent_*` / `tool_*` 契约不变）。审计轨迹 = `rumorStep.output.claimAtomSelfProof` 元数据（进 steps 透传前端）+ 一条 `console.log("[agent_self_proof] ...")`（handlers 无 deps.log 通道，仅 console logger，与既有日志一致）。
- 若 `claimAtoms` 为空（无原子可拆），自证直接返回 `{ kept: [], dropped: [] }`，不调 LLM。

### 4. Prompt 硬约束（RumorDetector）

文件：`mvp/server/src/lib/agentConfigs.ts`（`rumor_detector` systemPrompt）

在现有"回溯原句"引导（第 2、4 条）基础上，追加明确硬约束：
- 每个 claimAtom 必须能被原句**直接支持**，原句未声称的信息、补全的上下文、模型常识一律不得写入。
- 拆解不得删除原句的限定条件（"某种情况下 X" 不得拆成 "X"）。
- 不得产出无独立含义的碎片；能合并进同一判断的不要拆成多条。
- 拆分完成后把 claimAtoms 拼接回读，逐条对照原句自证，不能自证的删掉。

### 5. 不改动的部分

- **不改搜索**（仍整句检索，拆分只负责定罪与拆解质量）。
- **不改事件契约**（`planner_update` / `agent_*` / `tool_*` / `consensus_debate_*` / `speculative_update`）。
- **不改** `mergeSubclaimVerdicts` / `splitVerifiableAtoms` 的既有语义（它们继续以过滤后的 claimAtoms 为锚）。
- 前端 DAG 运行时（`src/lib/agentConfigs.ts`）为独立测试/评估实现，**本轮不同步**（非生产路径，按既有约定另行排期）。

## 验收标准

- [x] `prefilterClaimAtoms` 确定性预过滤：去空/截断/去重，重复项记 `dropped(duplicate)`；与 `mergeSubclaimVerdicts` 同键（上限 6 条 / 180 字）；输出规范化文本作 canonical 键（U+3000→普通空格）。
- [x] `runClaimAtomSelfProof` 批量单次调用：supported=true 保留、false 丢弃，`kept` 保持输入顺序。
- [x] fail-open：LLM 失败 / 结果缺失 / 不可解析时全部原子保留，不误杀；空 claimAtoms 不调 LLM。
- [x] 两处 handler 插入闸门，与 search 并行；过滤后 `claimAtoms` 进入下游，`claimAtomSelfProof` 诊断元数据挂到 rumorStep.output。
- [x] `claimAtoms` 为空时不调 LLM，直接空结果。
- [x] rumor_detector prompt 含"原句自证"硬约束（直接支持 / 不删限定 / 不产碎片 / 回读自证）。
- [x] 新增测试：`prefilterClaimAtoms` 去重与规范化、`runClaimAtomSelfProof` 保留/丢弃/fail-open/空输入、prompt 硬约束 + 忠实/可核查边界。
- [x] 全量回归通过（`npx vitest run` 572 用例全绿）+ `tsc --noEmit` 改动文件无新增类型错误。

## 非目标（本迭代不做）

- 把拆解质量作为可见 UI 指标展示（本轮只落数据层 + 审计日志，UI 展示属"界面按需披露"层，另行排期）。
- 前端 DAG 运行时同步。
- 抽取前后端共享模块。
- 用自证闸门做"拆解优于不拆解"的对照实验代码（那是验证方法，见 `2026-08-06-decomposition-ab-validation.md`，本轮仅出方法文档）。

## 落地边界

本功能在代码层已随本轮实现落地（server `agentConfigs.ts` + `handlers.ts` + `agentConfigs.test.ts`）。

- **数据层 + 闸门**：server [agentConfigs.ts](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp/server/src/lib/agentConfigs.ts) 新增 `prefilterClaimAtoms`（去空/截断/去重/规范化 canonical 键）、`SELF_PROOF_SYSTEM_PROMPT`（含忠实/可核查边界）、`selfProofSchema`、`buildSelfProofUserContent`、`parseSelfProofResults`（fail-open）、`applySelfProof`、`runClaimAtomSelfProof`（批量单次 + fail-open）；rumor_detector prompt 追加"原句自证"硬约束。
- **编排**：[handlers.ts](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp/server/src/handlers.ts) 两处（orchestrateHandler / orchestrateStreamHandler）在 rumorStep 后、与 search 并行插入闸门，过滤后 `claimAtoms` 写回 rumorStep.output，诊断元数据 `claimAtomSelfProof` 挂载；下游（fact_checker input / mergeSubclaimVerdicts 锚定 / splitVerifiableAtoms 排除层）一致读到过滤后集合。审计轨迹 = `claimAtomSelfProof` 元数据 + `console.log("[agent_self_proof] ...")`。
- **测试**：`agentConfigs.test.ts` 新增 32 条用例（prefilter 去重/截断/规范化、自证保留/丢弃/fail-open/空输入、prompt 硬约束 + 边界）。
- **验证**：`mvp/` 下 `npx vitest run` 全量通过（572 用例）；`npx tsc --noEmit` 改动文件无类型错误。
- **review 修正**：A（审计日志联通，spec 措辞对齐真实 console logger 机制）、B（自证 prompt 明确"只判忠实不判可核查"，立场型原句声称判 supported，避免与排除层冲突）、C（canonical 文本规范化，保证自证解析与下游 merge 键一致）。
- **未覆盖**：UI 层展示拆解质量指标（另排期）；前端 DAG 运行时不同步。

## 受影响文件

- `mvp/server/src/lib/agentConfigs.ts`：`prefilterClaimAtoms`、`runClaimAtomSelfProof`、`SELF_PROOF_SYSTEM_PROMPT`、`selfProofSchema`、rumor_detector prompt。
- `mvp/server/src/handlers.ts`：`orchestrateHandler` / `orchestrateStreamHandler` 插入闸门。
- 相关测试：`agentConfigs.test.ts`（纯函数 + fail-open + prompt + 边界）。