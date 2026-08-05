# 迭代 Spec · 判定可追溯（逐条定罪可展开看依据）

> 日期：2026-08-05
> 状态：已实现
> 所属：周打磨 · 阶段1 核查正确性 · 可审查可审计落地
> 依赖：`2026-08-05-server-subclaim-verdicts.md`（逐命题定罪全链路已落地，用户可见清单）

## Why

逐命题定罪已经让用户看见"判了什么"（`subclaimVerdicts`）。但"可审查、可审计"承诺只兑现了一半——用户还看不到"为什么这么判"。

现状：每条定罪的 `evidence` 只是一行自由文本，搜索来源是全局的、没有绑定到具体定罪。用户得到一个结论，却无法点开看支撑这条结论的证据、反证和缺口。这是黑箱的残留。

本迭代把定罪从"一行结论"升级为"可展开的依据卡"：每条定罪点开，能看到支撑证据、反证/质疑、证据缺口，且来源可点击。遵循"界面按需披露"——正常态只显示定罪标签，追问才展开。

## What Changes

### 1. 数据模型 — 扩展 `SubclaimVerdict` item 结构

文件：`server/src/lib/agentConfigs.ts`、`src/lib/agentConfigs.ts`、`src/lib/schemas.ts`

当前 item：`{ claimAtom, verdict, evidence, boundary }`（`evidence` 为字符串）。

扩展为（新增三个字段，均可选以兼容兜底）：

```ts
type SubclaimVerdict = {
  claimAtom: string;
  verdict: "true" | "false" | "partial" | "exaggerated" | "unverified";
  evidence: string;          // 保留：人读的判定小结
  boundary: string;          // 保留：边界条件
  supportingSources: Array<{ url: string; title: string; snippet: string }>;   // 新增：支撑证据来源
  contradictingSources: Array<{ url: string; title: string; snippet: string }>; // 新增：反证来源
  evidenceGaps: string[];    // 新增：证据缺口
};
```

- 三个新字段在 schema 中 `required` 不强制（兜底时可为空数组），但 `properties` 明确定义结构。
- 前端 `src/lib/schemas.ts` 的 `SubclaimVerdict` 类型同步扩展。

### 2. fact_checker — 逐条定罪产出结构化来源

文件：`server/src/lib/agentConfigs.ts`

- `fact_checker` systemPrompt 追加约定：对输入 `claimAtoms` 的每个原子，`subclaimVerdicts` 中对应 item 的 `supportingSources`/`contradictingSources` 必须引用**真实搜索结果中存在**的来源（给 url/title/snippet），不得编造不存在的来源；`evidenceGaps` 列出尚缺的证据。
- 新增确定性兜底：该 item 的 `supportingSources`/`contradictingSources` 需要与 `search360Result.sources` 交叉校验——只保留真实存在于搜索结果中的 URL，编造的 URL 丢弃（幻觉拦截，对齐"可审计"承诺）。

### 3. merge / 落库闸门 — 保留并校验新字段

文件：`server/src/lib/agentConfigs.ts`、`server/src/handlers.ts`

- `mergeSubclaimVerdicts` 复刻时，对 item 的 `supportingSources`/`contradictingSources` 做同样的 URL 幻觉拦截（与搜索结果交叉校验），`evidenceGaps` 截断长度。
- 落库闸门（`finalReport.subclaimVerdicts`）与 `buildDeterministicFinalReport` 兜底同样透传/产出这三个新字段（兜底时为空数组）。

### 4. 前端 UI — 逐条可展开

文件：`src/components/v3/ReportModal.tsx`、`src/styles.css`

- "逐命题定罪"区块的每行定罪新增展开交互（点击展开/折叠）。
- 展开后显示三个分区：
  - **支撑证据**：`supportingSources` 列表，每条可点击源码（url 新窗口打开）。
  - **反证 / 质疑**：`contradictingSources` 列表，每条可点击。
  - **证据缺口**：`evidenceGaps` 列表，纯文本。
- 某分区为空则隐藏该分区，不显示空标题。
- 展开默认收起（按需披露），复用现有样式 token，不新建全局 style。

## 验收标准

- [x] `SubclaimVerdict` item 在 server + 前端 schema 均含 `supportingSources`/`contradictingSources`/`evidenceGaps`，结构为 `{url,title,snippet}[]` / `string[]`。
- [x] `fact_checker` prompt 引导逐条定罪引用真实来源，不编造。
- [x] merge/闸门对 per-verdict 来源做 URL 幻觉拦截（与搜索结果交叉校验），编造 URL 被丢弃；`buildDeterministicFinalReport` 兜底产出空数组。
- [x] `ReportModal` 逐条定罪可展开，展示支撑/反证/缺口三区，来源可点击，空分区隐藏。
- [x] 新增测试：schema 字段存在性、来源幻觉拦截、UI 展开与空态。
- [x] 全量回归通过（前端 + server 全绿）+ `tsc --noEmit` 无新增类型错误。

## 非目标（本迭代不做）

- 后台全量审计日志 / ReAct 轨迹展示（那是"出错时展开轨迹"层，另行排期）。
- 改动搜索策略（仍整句检索）。
- 把双端 `mergeSubclaimVerdicts` 抽成共享模块（纯技术债，暂缓）。

## 落地边界

本迭代在代码层已随 `686b14a`（数据层）、`846eb90`（ReportModal UI）等提交完整落地（`5b45756` 为 spec/产品手册更新，非代码），本次仅做验收核对与文档状态翻转。

- **数据层 + merge 闸门**：server [agentConfigs.ts](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp/server/src/lib/agentConfigs.ts) 的 `SubclaimVerdict` 扩展三字段、`sanitizeVerdictSources` 做 URL 幻觉拦截、`mergeSubclaimVerdicts` 携带 `searchSources` 交叉校验；前端 [schemas.ts](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp/src/lib/schemas.ts) 类型同步。落库闸门与 `buildDeterministicFinalReport` 兜底在 [handlers.ts](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp/server/src/handlers.ts) 均透传/产出三字段。
- **fact_checker prompt**：server 版已加入"逐条定罪来源绑定 / 判定可追溯 — 强制"约定，要求引用 `search360.sources` 真实来源、编造 URL 宁可留空。
- **前端 UI**：[ReportModal.tsx](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/mvp/src/components/v3/ReportModal.tsx) 逐条定罪点击展开，显示支撑证据 / 反证质疑 / 证据缺口三区，来源新窗口可点击，空分区隐藏；默认收起，复用现有样式 token。
- **新增测试**：server `agentConfigs.test.ts`（schema 字段存在性、URL 幻觉拦截、evidenceGaps 截断）、`handlers.reportFallback.test.ts`（兜底透传与交叉校验）、前端 `ReportModal.test.tsx`（展开/折叠/空态/链接）。
- **验证结果**：vitest 全量 531 通过（含 40 个本次功能相关用例），功能涉及文件（agentConfigs / schemas / ReportModal / handlers）在两端 `tsc --noEmit` 均无类型错误。完整基线可在 `mvp/` 目录用 `npx vitest run` 复现（531 用例全绿），类型检查用 `npx tsc --noEmit`。
- **未覆盖**：前端 `src/lib/agentConfigs.ts` 的 `mergeSubclaimVerdicts` 未做 URL 交叉校验（前端无搜索结果上下文，由 server 闸门保证落库数据可信）；`src/lib/agentConfigs.test.ts` 未新增三字段用例（前端边界由 server 测试 + ReportModal 测试覆盖）。
- **遗留类型债（非本迭代引入）**：前端 `evaluation/`、`deepagents-poc/`、`App.test.tsx` 14 处；server `caseHandlers.ts`、`claimReview.ts` 5 处。均与判定可追溯无关，另行排期。

## 受影响文件

- `mvp/server/src/lib/agentConfigs.ts`：`SubclaimVerdict` 扩展 + schema + merge 来源校验 + fact_checker prompt。
- `mvp/server/src/handlers.ts`：落库闸门 + `buildDeterministicFinalReport` 透传新字段。
- `mvp/src/lib/agentConfigs.ts`、`mvp/src/lib/schemas.ts`：前端类型同步。
- `mvp/src/components/v3/ReportModal.tsx`、`mvp/src/styles.css`：逐条展开 UI。
- 相关测试：`agentConfigs.test.ts`、`handlers.reportFallback.test.ts`、`ReportModal.test.tsx`。