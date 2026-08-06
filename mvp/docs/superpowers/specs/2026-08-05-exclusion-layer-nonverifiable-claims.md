# 迭代 Spec · 排除层：不可核查命题的类型判定与单独处置

> 日期：2026-08-05
> 状态：待实现
> 所属：周打磨 · 阶段1 核查正确性 · 防假阳性定罪
> 依赖：`2026-08-05-server-subclaim-verdicts.md`（逐命题定罪链路已落地，`subclaimVerdicts` 为可审计核心契约）
> 范围：本迭代 = 为"拆出的原子命题 / 整条谣言"加类型判定，识别不可核查项并单独处置，防止对价值/预测类命题强行定罪。

## Why

逐命题定罪链路（`subclaimVerdicts`）落地后，暴露了一个上文游离的漏洞：**系统会对每个原子命题下真/假/存疑/夸大 verdict，但有些原子命题本就不该被定罪。**

事实核查领域的成熟标注体系（Full Fact、Deck 2025、ClaimBuster）一致把 预测、观点、信念、价值判断 划为 **non-claim（不可核查项）**——不是"可核查类型之一"，而是"该被排除/单独处置"的对象。当前实现没有这层识别，于是：

1. **假阳性定罪**：一个价值命题（"文科教育正在失去意义"）会被硬塞进真/假清单，产出一个它本不该有的"结论"，污染可审计性。
2. **证据错配**：对预测/价值命题硬查证据，要么查不到、要么拿"立场"当"事实"，得出误导性 verdict。

产品承诺"可审查、可审计"。排除层是让"逐命题定罪"只对**该定罪的**定罪的第一步——先挡住不该核查的，再谈该核查的查得清。

**边界（本迭代只做"排除层"）**：本迭代**不做**"按类型选证据策略"（因果查反事实、比较查口径）——那是路由层，另一迭代。本迭代只做：识别不可核查项 + 单独处置 + 整句判定。**不做**拆分算法重写、去语境化、拆解质量闸门（属既有缺口，另行排期）。

## 判定框架总览

```mermaid
flowchart TD
    A[RumorDetector 拆 claimAtoms + 判类型] --> B[逐原子判 verifiable]
    B --> C{verifiable?}
    C -->|true| D[进现有逐命题定罪闸门 subclaimVerdicts]
    C -->|false| E[路由到非核查桶 nonVerifiableAtoms]
    D --> F[真/假/存疑/夸大 逐命题定罪]
    E --> G[原位打灰标"立场型" 不订真/假]
    A --> H[整句判 claimType]
    H --> I{整句 verifiable?}
    I -->|true| K[走完整核查流程]
    I -->|false| L[报告顶部标"立场型"横幅，仍走完整核查流程]
```

## What Changes

### 1. 类型系统与排除集定义（判定标准）

**排除集（硬不可核查，verifiable=false）**——两类，文献证据最足，直接进"立场型"：

- `value` 价值判断：对事物价值的评价（"有意义/无意义""好/坏""应该/不应该"）。
- `prediction` 预测/未来命题：断言指向未来、无法用当前证据判定（"未来三年就业会恶化"）。

**可核查集（verifiable=true）**——三类，正常进定罪闸门：

- `fact` 事实陈述：某事件发生、某人/机构说过、某数据为真。
- `causal` 因果推断：A 导致 B，需查机制、时间顺序、替代解释、反事实。
- `comparison` 比较命题：A 与 B 相对（"比""更/更可能"），需明确比较对象与指标口径。
- `concept` 概念定义：某个概念/术语的定义、出处、不同语境下的用法。

**灰度区（不硬性归集，verifiable 由 RumorDetector 按断言形态判定，prompt 引导）**——两类：

#### 个人经验 / 主观感受（`personal`）

判定关键在**断言形态**，不在内容：

- **可核查（true）当**：断言是"某人/某群体 报告/声称 某种经验或反应"——"报告/声称"这个行为本身是可查的事实。例："大量患者报告服用 X 后出现失眠" → 可核查（去查是否有这些报告）。
- **不可核查（false）当**：断言是说话者本人的第一人称主观体验、或未经证实的普遍化主观判断。例："这药对我失眠很有效" → 不可核查。
- **边界示例（安慰剂）**：即使机制未知（可能是安慰剂效应），只要断言形态是"患者报告了反应"，就可核查"是否有报告"；**不能**将其核查为"该反应是药理作用"——后者是因果/机制命题，另按 `causal` 判。

#### 概念定义（`concept`）

- **可核查（true）当**：断言是"某个概念定义是什么、出自哪里、不同语境如何被使用"——可查定义出处、语境、不同解释。例："新质生产力包括哪些内容" → 可核查。
- **不可核查（false）当**：断言是"这个概念（根本）没有意义/不应该存在"这类立场宣泄或规范判断。例："文科教育正在失去意义"若指价值立场 → 不可核查。

> 灰度区是"模型依赖"的明确边界：类型判定由 LLM 经 prompt 完成，**不可核查的识别结果进确定性闸门**（见第 3 节），保证即便模型误判归集，硬定罪也不会落到 `verifiable=false` 的原子身上。

### 2. Schema 扩展（RumorDetector 输出）

文件：`mvp/server/src/lib/agentConfigs.ts`（`RumorDetectorOutput` + `rumorDetectorSchema`）

**2a. 逐原子类型**：新增 `claimAtomTypes: Array<{ text: string; verifiable: boolean; type: "fact"|"causal"|"comparison"|"concept"|"value"|"prediction"|"normative"|"personal" }>`。
- `text` 与 `claimAtoms` 中的原子一一对应（用 `text` 作 join 键）。
- `verifiable` 为确定性路由依据；`type` 为类型标签（供未来路由层复用）。
- schema `properties` 加 `claimAtomTypes`，item 结构含 `text/verifiable/type`，`additionalProperties: false`，required 三项。

**2b. 整句判定**：新增 `claimType: { verifiable: boolean; type: "fact"|"causal"|"comparison"|"concept"|"value"|"prediction"|"normative"|"personal"|"mixed"; reason: string }`。
- `verifiable=false` 表示整条谣言为纯价值/预测/规范型说法。

### 3. 确定性闸门：拆分可核查 / 不可核查（server 端）

文件：`mvp/server/src/lib/agentConfigs.ts`

新增 `splitVerifiableAtoms(claimAtoms: string[], claimAtomTypes)` → `{ verifiable: string[]; nonVerifiable: Array<{ text: string; type: string }> }`：

- 以 `claimAtomTypes[i].text` 与 `claimAtoms` 对齐；`verifiable === false` 的原子进 `nonVerifiable`，其余进 `verifiable`。
- 兜底：若 `claimAtomTypes` 缺失或某原子无对应类型条目，**默认判为可核查**（宁可有漏判，不误杀；整句级 `claimType.verifiable` 单独处理）。
- 该函数是**确定性**的，不依赖模型二次判断。

**落库衔接**（`orchestrateHandler` / `orchestrateStreamHandler` 的 `finalReport` 落库前，与既有 `mergeSubclaimVerdicts` 同一位）：

- `finalReport.subclaimVerdicts` 只对 `splitVerifiableAtoms(...).verifiable` 做 merge 兜底（复用既有 `mergeSubclaimVerdicts`）。
- `finalReport.nonVerifiableAtoms` = 拆分出的 `nonVerifiable`（`{text, type}`），**不进** `subclaimVerdicts`。

> **不变量**：任何 `verifiable === false` 的原子，**绝不**出现在 `subclaimVerdicts` 里。这是"防假阳性定罪"的确定性承诺，与模型输出好坏无关。

### 4. Prompt 引导（RumorDetector）

文件：`mvp/server/src/lib/agentConfigs.ts`（`rumor_detector` systemPrompt）

追加：
1. 输出 `claimAtomTypes`：对每个 `claimAtoms` 原子判 `verifiable` + `type`。
2. **灰度区判定规则**（照第 1 节）：个人经验按"断言形态"判（"报告/声称"→可核查；第一人称主观→不可核查）；概念定义按"查出处 vs 泄立场"判。
3. 输出 `claimType`：判断整条谣言类型与可核查性。
4. 明确：价值/规范/预测类**不可核查**，不进入事实核查范畴。

### 5. 报告 / UI 渲染：原位内联标注

文件：`mvp/src/components/v3/phases/mission/ReportModal.tsx`（逐命题定罪区块）

- 在逐命题清单中，`nonVerifiableAtoms` 的原子**保留原位**，打灰色"立场型"标签（如 `[立场型]`），**不渲染 verdict**（不订真/假/存疑）。
- 与 `subclaimVerdicts` 的条目并列展示：可核查原子显示 verdict 五值着色；不可核查原子显示"立场型·不适用真/假判断"。
- 整句 `claimType.verifiable === false` 时：报告顶部标"本说法属立场/预测/价值型，不适用于事实核查"，不硬造核查结论。
- 复用既有样式体系（`docs/DESIGN-SYSTEM.md`），不新建全局 style。

### 6. 整句标注路径（方案 A · 判定 + 报告标注）

> 用户已确认采用**方案 A**（判定 + 报告标注）：整句判定为立场/价值型时，**仍走完整核查流程**，不重构编排流程，只在报告顶部加"立场型"横幅标注，价值/预测原子原位灰标、不订真/假。

- `claimType.verifiable === false`：仍进入完整核查流程，报告顶部标注"本说法属立场/价值/预测型"；可核查部分照常定罪，价值/预测原子进 `nonVerifiableAtoms` 原位灰标。
- 目的：不因整句类型误判而漏掉本可核查的事实部分；改动面最小（只加判定 + 标注），不重构编排主线。
- 明确不做：不跳过/降级核查流程（方案 B 行为，已排除）。

## 验收标准

- [ ] `rumor_detector` schema 含 `claimAtomTypes`（item = `{text, verifiable, type}`）与 `claimType`（`{verifiable, type, reason}`）。
- [ ] `splitVerifiableAtoms` 确定性拆分：`verifiable=false` 原子进 `nonVerifiable`，`claimAtomTypes` 缺失时默认可核查。
- [ ] `finalReport.subclaimVerdicts` 只覆盖可核查原子；`finalReport.nonVerifiableAtoms` 承载不可核查项；**不变量成立**：`subclaimVerdicts` 里绝不出现 `verifiable=false` 的原子。
- [ ] RumorDetector prompt 含灰度区判定规则（个人经验按断言形态、概念按查出处 vs 泄立场）。
- [ ] `ReportModal` 原位渲染 `nonVerifiableAtoms` 灰标"立场型"，不订真/假；整句 `verifiable=false` 时顶部标注立场型。
- [ ] 新增测试覆盖：`splitVerifiableAtoms` 拆分、不变量（不可核查不进 verdicts）、`claimAtomTypes` schema、prompt 引导、UI 灰标渲染与整句标注。
- [ ] 全量回归通过（基线 538 测试绿，新增用例后仍全绿）。
- [ ] `tsc --noEmit` 无新增类型错误（既有未改动文件错误除外）。

## 非目标（本迭代不做）

- 按类型选证据策略的路由层（因果查反事实、比较查口径）——另迭代。
- 拆分算法重写、去语境化、拆解质量校验闸门（既有缺口，另行排期）。
- 重构编排流程 / 整句跳过主线（仅做整句判定 + 报告标注）。
- 前端 DAG 运行时同步。

## 落地边界

> 本迭代未实现，以下为预期落地边界（实现后回填）：

- server `agentConfigs.ts`：`RumorDetectorOutput` + `rumorDetectorSchema` 加 `claimAtomTypes`/`claimType`；新增 `splitVerifiableAtoms`；`handlers.ts` 落库前拆分并保证 `subclaimVerdicts` 不含不可核查原子。
- prompt：`rumor_detector` systemPrompt 加灰度区判定规则与整句判定。
- UI：`ReportModal` 逐命题清单原位灰标"立场型"，整句立场标注。
- 测试：server `agentConfigs.test.ts`（`splitVerifiableAtoms`、不变量、schema）、`handlers.reportFallback.test.ts`（如需）、前端 `ReportModal.test.tsx`（灰标渲染、整句标注）。
- 验证：`mvp/` 下 `npx vitest run` 全量通过；`npx tsc --noEmit` 无新增类型错误。

## 受影响文件

- `mvp/server/src/lib/agentConfigs.ts`：类型 + `rumor_detector` schema + `splitVerifiableAtoms` + prompt。
- `mvp/server/src/handlers.ts`：`orchestrateHandler` / `orchestrateStreamHandler` 落库前拆分，`subclaimVerdicts` 只覆盖可核查原子，`nonVerifiableAtoms` 单独承载。
- `mvp/src/components/v3/phases/mission/ReportModal.tsx`：原位灰标"立场型" + 整句立场标注。
- 相关测试：`agentConfigs.test.ts`、`ReportModal.test.tsx`，必要时 `handlers.reportFallback.test.ts`。