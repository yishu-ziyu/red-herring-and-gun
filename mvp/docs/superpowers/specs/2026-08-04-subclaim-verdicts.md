# A1 设计 · 逐命题定罪（subclaim verdicts）

> 日期：2026-08-04
> 状态：已实现（2026-08-04，commit af0a788…6cbb97b）
> 所属：周打磨 · 阶段1 核查正确性

## Why

破译"拆完为什么"的断点：RumorDetector 已把 claim 拆成可独立核查的原子命题（claimAtoms），FactChecker 的 input 也拿到了 claimAtoms，但 FactChecker 的 responseSchema 只允许输出**一个整体** `factCheckResult`，没有逐命题定罪。ReportComposer 的 input 拿到了 claimAtoms，但报告 schema 也没有逐命题清单。

结果：拆了，但拆解的红利没兑现——用户只看到单一 verdict，看不到"哪部分真、哪部分假、哪个夸大"。这违背产品"可审查、可审计"的核心承诺，也是投资人视角下"最怕你没有"的东西。

**边界澄清**：搜索仍锚定整句原始 claim（intent 正确，`runSearch` 用 `claim`），不改为逐原子命题检索。搜索负责召回，拆分负责定罪——两者分离，本设计只补定罪端。

## What Changes

让每个 claimAtom 单独走完"证据 → 定罪"，产出逐命题清单，而非只给整体 verdict。

### 1. FactChecker 输出结构（数据源）

`factCheckerSchema` 新增 `subclaimVerdicts` 数组，每项：

```
{
  claimAtom: string,        // 该条定罪对应的原子命题（原句）
  verdict: "true" | "false" | "partial" | "unverified" | "exaggerated",
  evidence: string,         // 依据（支持/反驳/未解缺口）
  boundary: string,         // 不能推出的边界
}
```

- `partial` 与 `exaggerated` 可区分"有真实片段但夸大/偷换"。
- 必须能被原句回溯：每条 `claimAtom` 应来自输入的 claimAtoms。

### 2. ReportComposer 消费（报告形态）

- input 在已有 `claimAtoms` 基础上，新增 `subclaimVerdicts`（来自 FactChecker 输出）。
- 报告 structure 新增 `subclaimVerdicts` 字段，渲染成逐命题清单。
- **覆盖不全处理**：若模型输出的定罪条数 < 输入的 claimAtoms 数，缺失的 claimAtom 标记为 `verdict: "unverified"` + `boundary: "模型未覆盖，待补证"`，保留线索，不静默丢弃。
- 整体 `verdictType` / `credibilityScore` 的语义**不变**，与逐命题汇总一致。

### 3. 契约校验

`withAgentContract("fact_checker", ...)` 的 __contract 增加：
- "逐命题定罪必须覆盖输入的全部 claimAtoms，每条可回溯到原句。"
- "不得在此字段引入原句未声称的信息。"

## 关键约束

- 不改搜索（整句检索）。
- 不动 `verdictType` / `credibilityScore` 的整体语义。
- 只加字段，不删字段，不破坏事件契约（`planner_update` / `agent_*` / `tool_*` / `consensus_debate_*` / `speculative_update`）。

## 受影响文件

- `mvp/src/lib/agentConfigs.ts`：`factCheckerSchema` 加 `subclaimVerdicts`；ReportComposer 的 `buildAgentInput` 透传 `subclaimVerdicts`；`withAgentContract` 加约定。
- `mvp/src/lib/agentRuntime/AgentRuntime.ts`：ReportComposer 的 input 组装传入 `subclaimVerdicts`（在 `buildAgentInput` 的 fact_checker 输出可获处）。
- 相关测试：`agentConfigs.test.ts`、`agentRuntime/*.test.ts`。

## 验收标准

- [x] FactChecker 的 responseSchema 含 `subclaimVerdicts`，且输出可覆盖全部 claimAtoms。
- [x] ReportComposer 报告含逐命题清单 `subclaimVerdicts`。
- [x] 构造含 2 个 claimAtoms 的 case，逐命题定罪覆盖全部、整体 verdict 与逐命题汇总一致。
- [x] 模型少输出时，缺失项标记 `unverified` + `未覆盖` 线索，不静默丢弃。
- [x] 全量回归通过（基线 502 测试绿，实际 505 全绿）。

> 实现说明：`mergeSubclaimVerdicts` 在 buildAgentInput 层做确定性兜底（覆盖不全补 `unverified` + "模型未覆盖，待补证"），并对不在输入 claimAtoms 中的幻觉原子做拦截（可审计承诺的代码级守持）。report_composer 的 prompt 已补引导，要求逐条渲染判定/证据/边界且不得编造。

## 落地边界（2026-08-04 补充）

本功能当前落在**前端 DAG 运行时数据层**：`src/lib/agentConfigs.ts` 的 fact_checker 产出 `subclaimVerdicts`，report_composer input 透传并在报告 schema 中保留该字段。全量回归 508 通过，含 5 条专项断言（覆盖不全兜底、幻觉原子拦截、超长原子截断键一致）。

**尚未接入生产路径**（属下一阶段，非本设计缺陷）：
- server 端 `agentConfigs.ts` 为精简演示版，fact_checker 无 `subclaimVerdicts`、rumor_detector 无 `claimAtoms`，`/api/agent/orchestrate(-stream)` 走的是串行 handoff，不产出逐命题定罪。
- 前端 `ReportModal.tsx` 渲染的是旧字段 `subclaimStatuses`，未渲染 `subclaimVerdicts`。

即：逐命题定罪的数据契约已实现并验证，但用户当前在浏览器里看不到该清单。接入生产路径（server 同步 + UI 渲染）应排入下一功能迭代。