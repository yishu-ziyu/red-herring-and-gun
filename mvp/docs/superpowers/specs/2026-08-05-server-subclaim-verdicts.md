# 迭代 Spec · 逐命题定罪全链路落地（server 数据层 + UI 可见）

> 日期：2026-08-05
> 状态：已实现
> 所属：周打磨 · 阶段1 核查正确性 · 生产路径落地
> 依赖：`2026-08-04-subclaim-verdicts.md`（前端 DAG 数据层已实现并验证）
> 范围：本迭代 = 08-05 原第一步（server 数据层）+ 并入第二步（UI 渲染），一次让用户看到清单

## Why

上一迭代（A1）证明前端 DAG 运行时已能产出 `subclaimVerdicts`，但生产路径（`/api/agent/orchestrate(-stream)`，前端实际消费）走的是 server 端精简版 `agentConfigs.ts`，该文件：
- fact_checker 无 `subclaimVerdicts`、rumor_detector 无 `claimAtoms`；
- 前端 `ReportModal.tsx` 渲染的是旧字段 `subclaimStatuses`，用户看不到逐命题清单。

逐命题定罪是产品"可审查、可审计"承诺的核心。本迭代把数据契约接入生产路径，让 server 端真实产出 `claimAtoms` + `subclaimVerdicts`。

**边界（两步并入本迭代）**：本迭代同时做 **server 端数据层（第 1-7 节）** 与 **UI 渲染（第 8 节）**。goal 是让 server 端真实产出并透传逐命题定罪，且用户在报告弹窗里真实看到逐命题清单。先数据后 UI，但同一迭代内完成，不做一半。

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
- **（review 修正 · R2）** report_composer 的 `subclaimVerdicts` 输出会在落库前被 `buildDeterministicFinalReport` 或 `mergeSubclaimVerdicts` 重新规范（见第 7 节），因此该 schema 仅表达"模型约定产出"，**不作为最终权威清单**。权威清单一律由 `mergeSubclaimVerdicts(claimAtoms, fact_checker.subclaimVerdicts)` 确定性产出，杜绝报告 composer 编造原句未声称的原子进入存档。

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

### 5. server 端 handlers.ts — 生产 fallback 补齐（review 修正 · R3）

文件：`mvp/server/src/handlers.ts`

> **修正说明**：原 spec 将第 5 节指向 `buildOrchestrateDemoFallback`（handlers.ts:3120），但该函数全文件无任何调用点，是死代码。生产路径 report_composer 失败时走的是 `runReportComposerWithFallback`（handlers.ts:2281）→ `buildDeterministicFinalReport`（handlers.ts:2319）。因此本节的 fallback 加固目标改为 `buildDeterministicFinalReport`。

在 `buildDeterministicFinalReport`（handlers.ts:2319）中补 `subclaimVerdicts`：
- 从 `factStep?.output?.subclaimVerdicts` 取原始 verdicts，经 `mergeSubclaimVerdicts(rumorStep?.output?.claimAtoms, factStep?.output?.subclaimVerdicts)` 产出权威清单（覆盖不全补 `unverified` + "模型未覆盖，待补证"，幻觉原子拦截）。
- 若 `claimAtoms` 为空，则 `subclaimVerdicts: []`，不伪造空条目。

> 目的：模型失败走确定性兜底报告时，`subclaimVerdicts` 结构不残缺、且与正常路径同源（同一 merge 契约），前端/下游不会因缺字段报错，也不会出现"报告声称已核查、逐命题清单为空"的误导。
>
> 说明：`buildOrchestrateDemoFallback` / `buildReportComposerFallbackFromInput` 是 demo 专用死代码，本次不改（避免扩大改动面）。它们与生产路径无关。

### 6. 类型契约同步（schemas.ts）— 已核实，无需动作

已核实：`FactCheckerOutput`/`RumorDetectorOutput`/`ReportComposerOutput` 只在 `server/src/lib/agentConfigs.ts` 定义，`schemas.ts` 未复用它们（`schemas.ts` 有独立的 `FinalReport` 等结构），`handlers.ts` 以 `any` 消费 Agent 输出。因此补齐接口类型后自动生效，无类型漂移风险。本任务无代码改动。

### 7. report_composer 输出落库前的幻觉拦截闸门（review 修正 · R2）

文件：`mvp/server/src/handlers.ts`（`orchestrateHandler` 与 `orchestrateStreamHandler` 的 `finalReport` 落库前）

report_composer 的输出 `subclaimVerdicts` 不能直接写入 `finalReport` 落库，必须过一次确定性闸门：

- 持久化进 `finalReport.subclaimVerdicts` 的值 = `mergeSubclaimVerdicts(rumorStep?.output?.claimAtoms, reportStep?.output?.subclaimVerdicts)`。
- 该闸门以 claimAtoms 为锚，拦截 report_composer 编造的原子、回退非法 verdict、补齐未覆盖原子，保证存档与 fact_checker 的激励机制一致、可审计。
- 若 report_composer 输出缺失 `subclaimVerdicts`，则回退为 `mergeSubclaimVerdicts(claimAtoms, factStep?.output?.subclaimVerdicts)`（与第 3 节输入侧同源），确保最终清单非空。

> 设计意图：`subclaimVerdicts` 是可审计的核心数据契约，只允许确定性来源（merge 契约）写入，不允许模型自由创作。两个入口（正常 `reportStep.output`、确定性兜底 `buildDeterministicFinalReport`）最终都汇入同一 merge 闸门，单点维护、双端一致。

### 8. 前端 UI — ReportModal 渲染逐命题清单（第二步）

文件：`mvp/src/components/v3/phases/mission/ReportModal.tsx`

现状：`ReportModal` 渲染的是旧字段 `subclaimStatuses`（`subclaimId/status` 占位结构），与 `subclaimVerdicts` 完全无关，用户看不到真实逐命题定罪。

目标：在报告弹窗新增一个"逐命题定罪"区块，渲染 server 端产出的 `finalReport.subclaimVerdicts`。

- 数据源：`finalReport.subclaimVerdicts`（第 7 节落库闸门后的权威清单）。
- 逐条渲染：每个 item 展示 `claimAtom`（原子命题）、`verdict`（判定）、`evidence`（证据）、`boundary`（边界）。
- 判定着色：`verdict` 五值（`true`/`false`/`partial`/`exaggerated`/`unverified`）用不同颜色/标签区分，`unverified` 明确标注"系统未判定/待补证"，不伪装成定罪。
- 若 `subclaimVerdicts` 为空数组或缺失：渲染空态提示（如"本次未生成逐命题判定"），不显示旧 `subclaimStatuses` 占位。
- 复用现有 UI 组件与样式体系（见 `docs/DESIGN-SYSTEM.md`），不新建全局 style。

> 说明：旧 `subclaimStatuses` 字段与 `subclaimVerdicts` 结构完全不同，不能复用其渲染逻辑，需新写区块。若旧字段无其它消费方，可在本次一并移除或保留不渲染（由实现者按代码现状决定，以不破坏现有 UI 为准）。

## 验收标准

- [x] server 端 `rumor_detector` schema 含 `claimAtoms`（string[]），且 prompt 引导拆分。
- [x] server 端 `fact_checker` schema 含 `subclaimVerdicts`，item 结构 = `{claimAtom, verdict, evidence, boundary}`，verdict enum 五值。
- [x] server 端 `report_composer` schema 含 `subclaimVerdicts`。
- [x] `buildAgentInput("fact_checker", ...)` 透传 `claimAtoms`；`buildAgentInput("report_composer", ...)` 的 `factCheck.subclaimVerdicts` 由 `mergeSubclaimVerdicts` 产出，覆盖不全补 `unverified` + "模型未覆盖，待补证"，幻觉原子被拦截。
- [x] **（R2）** `finalReport.subclaimVerdicts` 落库前过 `mergeSubclaimVerdicts` 闸门：report_composer 编造原子被拦截，缺失时回退到 fact_checker 同源清单，最终清单非空。
- [x] **（R3）** `buildDeterministicFinalReport` 产出 `subclaimVerdicts`（来自 `mergeSubclaimVerdicts(claimAtoms, fact_checker.subclaimVerdicts)`），claimAtoms 为空时返回 `[]`；该函数是生产兜底，`buildOrchestrateDemoFallback` 为死代码不改。
- [x] 新增测试覆盖：schema 字段存在性、`mergeSubclaimVerdicts` 覆盖不全与幻觉拦截、`buildAgentInput` 透传、`buildDeterministicFinalReport` 的 `subclaimVerdicts`、落库闸门。
- [x] **（UI）** `ReportModal` 渲染 `finalReport.subclaimVerdicts` 逐命题清单（claimAtom/verdict/evidence/boundary），五值着色，空态不显示旧占位。
- [x] 全量回归通过（基线 531 测试绿，新增用例后仍全绿；迭代落地时为 508，后续 verdict-traceability 用例将总数推至 531）。
- [x] `tsc --noEmit` 无新增类型错误（既有未改动文件错误除外）。

## 非目标（本迭代不做）

- 前端 DAG 运行时同步（已实现，无需改动）。
- 改动搜索策略（仍整句检索，拆分只负责定罪）。
- 把 `mergeSubclaimVerdicts` 抽成前后端共享模块（可选优化，本迭代按最小实现双端各一份）。

## 落地边界

本 spec 在代码层已随 `d9b798c`（server 数据层：schema + merge 兜底 + buildAgentInput + prompt + 落库闸门 + buildDeterministicFinalReport）、`a8b1d10`（ReportModal 渲染逐命题定罪清单）等提交完整落地（`5b45756` 为 spec/产品手册更新，非代码），本次仅做验收核对与文档状态翻转。

- **数据层 + merge 闸门**：server `agentConfigs.ts` 的 rumor_detector/fact_checker/report_composer 三 schema 补齐 `claimAtoms`/`subclaimVerdicts`，`mergeSubclaimVerdicts` 做覆盖不全补 `unverified` + 幻觉原子拦截 + 非法 verdict 回退；`handlers.ts` 的两个 handler 落库前与 `buildDeterministicFinalReport` 均过同一 merge 闸门。
- **UI**：`ReportModal` 渲染 `finalReport.subclaimVerdicts` 逐命题清单（claimAtom/verdict/evidence/boundary），verdict 五值着色，`unverified` 标注"未判定·待补证"，空态不显示旧 `subclaimStatuses` 占位。
- **新增测试**：server `agentConfigs.test.ts`（schema 字段存在性、merge 覆盖不全与幻觉拦截、buildAgentInput 透传、落库闸门）、`handlers.reportFallback.test.ts`（buildDeterministicFinalReport 的 `subclaimVerdicts`）、前端 `ReportModal.test.tsx`（逐命题渲染与空态）。
- **验证结果**：在 `mvp/` 目录 `npx vitest run` 全量通过；`npx tsc --noEmit` 无新增类型错误。

## 受影响文件

- `mvp/server/src/lib/agentConfigs.ts`：类型 + 3 个 schema + `mergeSubclaimVerdicts` + `buildAgentInput` + prompt。
- `mvp/server/src/handlers.ts`：`buildDeterministicFinalReport`（补 `subclaimVerdicts`）+ 两个 handler 落库前加 merge 闸门（第 7 节）。`buildOrchestrateDemoFallback` 为死代码，不改。
- `mvp/server/src/lib/schemas.ts`：若存在重复类型定义则同步。
- `mvp/src/components/v3/phases/mission/ReportModal.tsx`：新增逐命题定罪区块（第 8 节）。
- `mvp/server/src/lib/agentConfigs.test.ts`：新增 schema 与兜底断言。
- 相关测试：`handlers.reportFallback.test.ts` 若断言 fallback 结构则需跟进；前端 UI 测试若存在则补渲染断言。