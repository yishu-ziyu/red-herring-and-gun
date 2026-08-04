# 迭代 Spec · 第一阶段：server 端逐命题定罪数据层

> 日期：2026-08-05
> 状态：待实现
> 所属：周打磨 · 阶段1 核查正确性 · 生产路径落地
> 依赖：`2026-08-04-subclaim-verdicts.md`（前端 DAG 数据层已实现并验证）

## Why

上一迭代（A1）证明前端 DAG 运行时已能产出 `subclaimVerdicts`，但生产路径（`/api/agent/orchestrate(-stream)`，前端实际消费）走的是 server 端精简版 `agentConfigs.ts`，该文件：
- fact_checker 无 `subclaimVerdicts`、rumor_detector 无 `claimAtoms`；
- 前端 `ReportModal.tsx` 渲染的是旧字段 `subclaimStatuses`，用户看不到逐命题清单。

逐命题定罪是产品"可审查、可审计"承诺的核心。本迭代把数据契约接入生产路径，让 server 端真实产出 `claimAtoms` + `subclaimVerdicts`。

**边界（分两步走）**：本迭代只做**第一步（server 端数据层）**，UI 渲染（第二步）排到下一迭代。goal 是让 server 端真实产出并透传逐命题定罪，先用测试锁定，再做 UI。

## What Changes

### 1. server 端 agentConfigs.ts — schema 补齐

文件：`mvp/server/src/lib/agentConfigs.ts`

**1a. `RumorDetectorOutput` 类型 + `rumorDetectorSchema` 加 `claimAtoms`**
- 类型新增 `claimAtoms: string[]`。
- schema `properties` 加 `claimAtoms: { type: "array", items: { type: "string" } }`，`required` 追加 `claimAtoms`。

**1b. `FactCheckerOutput` 类型 + `factCheckerSchema` 加 `subclaimVerdicts`**
- 类型新增 `subclaimVerdicts: Array<{ claimAtom: string; verdict: "true"|"false"|"partial"|"unverified"|"exaggerated"; evidence: string; boundary: string; }>`。
- schema `properties` 加 `subclaimVerdicts`（结构同前端 `src/lib/agentConfigs.ts:388-401`：item 含 `claimAtom/verdict/evidence/boundary`，`additionalProperties: false`，required 四项）。
- `required` 追加 `subclaimVerdicts`。

**1c. `ReportComposerOutput` 类型 + `reportComposerSchema` 加 `subclaimVerdicts`**
- 类型新增 `subclaimVerdicts`（同 1b 结构）。
- schema `properties` 加 `subclaimVerdicts`，`required` 追加。

### 2. server 端 agentConfigs.ts — 复刻 `mergeSubclaimVerdicts` 兜底逻辑

文件：`mvp/server/src/lib/agentConfigs.ts`

把前端 `src/lib/agentConfigs.ts:851-885` 的确定性兜底逻辑复刻到 server 端（同一契约，双端守住覆盖不全兜底 + 幻觉拦截）：

- `truncateClaimAtomKey(value, maxLength = 180)`：与 compact 截断规则保持一致，作为 covered 判定键。
- `mergeSubclaimVerdicts(claimAtoms, verdicts)`：
  - 对输入 claimAtoms 做截断（上限 6 条、每条 180 字，与前端 `compactStrings` 一致）；
  - 幻觉拦截：仅接受真实存在于输入 claimAtoms 中的原子，模型编造的原子丢弃；
  - 非法 verdict 回退 `unverified`；
  - 覆盖不全：剩余未覆盖原子补 `{ claimAtom, verdict: "unverified", evidence: "", boundary: "模型未覆盖，待补证" }`。

> 注意：server 端当前没有 `compactStrings`/`compactText` helper（前端有）。需在 server 端补一个最小等价实现（`compactStrings(arr, maxCount, maxLen)`、`compactText(str, maxLen)`），或内联到 `mergeSubclaimVerdicts`。避免为只此一处、按需最小实现。

### 3. server 端 agentConfigs.ts — `buildAgentInput` 透传

文件：`mvp/server/src/lib/agentConfigs.ts`

- `fact_checker` 分支：input 增加 `claimAtoms: prev?.output?.claimAtoms ?? []`（从 rumor_detector step 取），供模型逐命题定罪。
- `report_composer` 分支：`factCheck` 对象增加 `subclaimVerdicts: mergeSubclaimVerdicts(rumorStep?.output?.claimAtoms, factStep?.output?.subclaimVerdicts)`。

### 4. server 端 prompt 引导

文件：`mvp/server/src/lib/agentConfigs.ts`

- `rumor_detector` systemPrompt：追加"先拆分原子命题"引导，输出 `claimAtoms`（可核查原子命题，能回溯原句），并给出 JSON 示例。
- `fact_checker` systemPrompt：追加逐命题定罪约定——`subclaimVerdicts` 必须覆盖输入 `claimAtoms` 的每个原子，每条 `claimAtom` 可回溯原句，不得引入原句未声称的信息；verdict 取值说明（`true/false/partial/exaggerated/unverified`）。
- `report_composer` systemPrompt：追加"把 `subclaimVerdicts` 作为报告一部分渲染，逐条列出判定/证据/边界，不得遗漏、不得编造输入中不存在的原子"。

### 5. server 端 handlers.ts — demo fallback 补齐

文件：`mvp/server/src/handlers.ts`

`buildOrchestrateDemoFallback`（约 3120 行）：
- `rumor_detector` fallback 补 `claimAtoms: []`（已有）。
- `fact_checker` fallback 补 `subclaimVerdicts: []`。
- `report_composer` fallback 补 `subclaimVerdicts: []`（`buildReportComposerFallbackFromInput` 若从 input 组装，也应透传 `input.factCheck.subclaimVerdicts`）。

> 目的：模型失败走 demo fallback 时，结构不残缺，前端/下游不会因缺字段报错。

### 6. 类型契约同步（schemas.ts）— 已核实，无需动作

已核实：`FactCheckerOutput`/`RumorDetectorOutput`/`ReportComposerOutput` 只在 `server/src/lib/agentConfigs.ts` 定义，`schemas.ts` 未复用它们（`schemas.ts` 有独立的 `FinalReport` 等结构），`handlers.ts` 以 `any` 消费 Agent 输出。因此补齐接口类型后自动生效，无类型漂移风险。本任务无代码改动。

## 验收标准

- [ ] server 端 `rumor_detector` schema 含 `claimAtoms`（string[]），且 prompt 引导拆分。
- [ ] server 端 `fact_checker` schema 含 `subclaimVerdicts`，item 结构 = `{claimAtom, verdict, evidence, boundary}`，verdict enum 五值。
- [ ] server 端 `report_composer` schema 含 `subclaimVerdicts`。
- [ ] `buildAgentInput("fact_checker", ...)` 透传 `claimAtoms`；`buildAgentInput("report_composer", ...)` 的 `factCheck.subclaimVerdicts` 由 `mergeSubclaimVerdicts` 产出，覆盖不全补 `unverified` + "模型未覆盖，待补证"，幻觉原子被拦截。
- [ ] demo fallback 各 agent 输出含 `claimAtoms`/`subclaimVerdicts` 字段，结构不残缺。
- [ ] 新增测试覆盖：schema 字段存在性、`mergeSubclaimVerdicts` 覆盖不全与幻觉拦截、`buildAgentInput` 透传。
- [ ] 全量回归通过（基线 508 测试绿，新增用例后仍全绿）。
- [ ] `tsc --noEmit` 无新增类型错误（既有未改动文件错误除外）。

## 非目标（本迭代不做）

- 前端 `ReportModal.tsx` 渲染 `subclaimVerdicts`（第二步）。
- 前端 DAG 运行时同步（已实现，无需改动）。
- 改动搜索策略（仍整句检索，拆分只负责定罪）。

## 受影响文件

- `mvp/server/src/lib/agentConfigs.ts`：类型 + 3 个 schema + `mergeSubclaimVerdicts` + `buildAgentInput` + prompt。
- `mvp/server/src/handlers.ts`：`buildOrchestrateDemoFallback` / `buildReportComposerFallbackFromInput`。
- `mvp/server/src/lib/schemas.ts`：若存在重复类型定义则同步。
- `mvp/server/src/lib/agentConfigs.test.ts`：新增 schema 与兜底断言。
- 相关测试：`handlers.reportFallback.test.ts` 若断言 fallback 结构则需跟进。