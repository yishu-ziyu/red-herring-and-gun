# 工程债记录 — PR #4 引入的技术债

> 记录时间：2026-08-04
> 来源：PR #4（feature/product-spec-and-agent-runtime，已合并到 main @ dc13285）
> 流程：发现 → 记录 → 定性 → 定影响与优先级 → 拆任务 → 定义验收 → 开发 → 回归

## 状态更新

D-1 ~ D-4 已全部修复（commit `1083e88`，2026-08-04）。下文问题清单保留为历史记录，待办项已清零。

## 背景

PR #4 合并时 handoff 声称"唯一失败是既有问题，与本次改动无关"。经核实，**该说法不成立**：
4 个问题是本次 PR 新增文件引入的，需在本轮修复并回归。

## 问题清单

### D-1 测试用例与实现的环境契约冲突（测试 bug）

- **文件**：`mvp/src/lib/claimReviewStream.test.ts`
- **现象**：`handleCaseSaved` 缺省 `baseUrl` 时断言 `https://gun.yishuziyu.cn/r/fallback`，实际返回 `http://localhost:3000/r/fallback`。
- **定性**：测试 bug。实现是 `typeof window !== "undefined" ? window.location.origin : "https://gun.yishuziyu.cn"`——浏览器内用 `window.location.origin`（正确），jsdom 测试环境里 `window` 存在，走 window 分支，兜底分支不可达。测试意图（验证兜底常量）与实现环境假设冲突。
- **影响**：阻断该文件全绿（1 失败 / 11）。

### D-2 测试夹具类型漂移 — claimReview.test.ts

- **文件**：`mvp/src/lib/claimReview.test.ts`
- **现象**：tsc 报 4 错。
  - `claimDiagnosis` 用了旧 shape（`originalClaim/subclaims/routes/searchPlans`），当前 `ClaimDiagnosis` 是 `{mixedJudgments, ambiguousTerms, risk, whyNotDirectFactCheck, rumorIndicators?}`。
  - `evidenceQualitySummary` 用了不存在字段 `gaps`，当前是 `{averageCredibility, averageFreshness, diversityScore, supportCount, contradictCount, weakEvidenceCount, highTierSourceCount}`。
- **定性**：类型债（夹具未随 schema 漂移更新）。
- **影响**：tsc 不干净，运行时不受影响（claimReview.ts 只读 `averageCredibility`）。

### D-3 测试夹具类型漂移 — missionControlEnhancements.test.ts

- **文件**：`mvp/src/lib/missionControlEnhancements.test.ts`
- **现象**：tsc 报 4 错。
  - `makeReport()` 的 `claimDiagnosis` 用旧 shape。
  - `makeCaseData()` 的 `diagnosis` 写成 string `"ok"`（应为 `ClaimDiagnosis`）。
  - `subclaims[].type` 用 `"事实陈述"`（不在 `ClaimType` 枚举）。
  - `candidates[]` 用不存在字段 `url`，且缺必填字段（sourceType/targetSubclaimIds/matchedNeed/traceability/contextFit/independence/limitations）。
- **定性**：类型债（夹具用旧 schema + 臆造字段）。
- **影响**：tsc 不干净，运行时不受影响（测试只断言 subclaimTree 节点数、citation/声誉/谬误/盲点，不依赖 candidates 具体值）。

### D-4 测试夹具类型漂移 — subclaimTree.test.ts

- **文件**：`mvp/src/lib/subclaimTree.test.ts`
- **现象**：tsc 报 3 错。`Subclaim.type` 用 `"事实陈述"`，不在 `ClaimType` 枚举。
- **定性**：类型债（`ClaimType` 与 `AtomicProposition.type` 混淆——后者才有 `"事实陈述"`）。
- **影响**：tsc 不干净，运行时不受影响（buildSubclaimTree 不按 type 分支）。

## 范围外（既有，不在本轮处理）

- `mvp/src/lib/agentRuntime/evaluation/`（benchmarkRunner/evaluationMetrics/evaluation.test/run）— 实验性预置代码，非本次引入。
- `mvp/src/lib/agentRuntime/deepagents-poc/rumorDetectorAgent.ts` — 预置 POC。
- `mvp/src/App.test.tsx` `Array.prototype.at` — 环境 lib 配置问题，非本次引入。
- 命题拆分忠实性校验闸门（PRODUCT_SPEC 第十章）— 产品决策，独立待办。

## 修复原则

- 生产 schema（`schemas.ts`）是真相源，**不改**。
- 只修测试夹具与测试用例，使其与当前 schema 对齐，并保持运行时行为与测试意图不变。
- 每个修复独立成文件，可并行派发、独立验证。