# A1 逐命题定罪 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 FactChecker 对每个 claimAtom 单独定罪，产出 `subclaimVerdicts` 逐命题清单，ReportComposer 消费并渲染进报告，覆盖不全时标记"未覆盖"保留线索。

**Architecture:** 在 `factCheckerSchema` 增加 `subclaimVerdicts` 数组字段（FactChecker 输出逐命题定罪）；在 `buildAgentInput` 的 report_composer 分支把 FactChecker 的 `subclaimVerdicts` 透传给 ReportComposer；在 `reportComposerSchema` 增加 `subclaimVerdicts` 字段；在 FactChecker 的 systemPrompt 的契约约定里声明覆盖约束。不改搜索、不改整体 verdict 语义、只加字段不删字段。

**Tech Stack:** TypeScript, vitest, JSON-schema。

---

### Task 1: FactChecker 输出 schema 增加 subclaimVerdicts

**Files:**
- Modify: `mvp/src/lib/agentConfigs.ts:375-390`（factCheckerSchema）
- Test: `mvp/src/lib/agentConfigs.test.ts`

- [ ] **Step 1: 写失败测试**

在 `mvp/src/lib/agentConfigs.test.ts` 增加一个断言，验证 fact_checker 的 responseSchema 含 `subclaimVerdicts` 且字段结构正确。

```ts
it("fact_checker responseSchema 包含 subclaimVerdicts 逐命题定罪字段", () => {
  const agent = getAgentConfig("fact_checker");
  const props = (agent!.responseSchema as any).properties;
  expect(props.subclaimVerdicts).toBeDefined();
  expect(props.subclaimVerdicts.type).toBe("array");
  const item = props.subclaimVerdicts.items.properties;
  expect(item.claimAtom).toBeDefined();
  expect(item.verdict).toBeDefined();
  expect(item.evidence).toBeDefined();
  expect(item.boundary).toBeDefined();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/agentConfigs.test.ts`
Expected: FAIL，`props.subclaimVerdicts` 为 undefined。

- [ ] **Step 3: 实现**

在 `factCheckerSchema`（`mvp/src/lib/agentConfigs.ts:375-390`）的 `properties` 中新增 `subclaimVerdicts`，并在 `required` 中追加（保持 `additionalProperties: false` 不变）。

```ts
const factCheckerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    factCheckResult: { type: "string", enum: ["true", "false", "partial", "unverified"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    sources: { type: "array", items: { type: "string" } },
    supportingEvidence: { type: "array", items: { type: "string" } },
    contradictingSources: { type: "array", items: { type: "string" } },
    keyFindings: { type: "array", items: { type: "string" } },
    counterEvidence: { type: "array", items: { type: "string" } },
    unresolvedEvidenceGaps: { type: "array", items: { type: "string" } },
    logicRisks: { type: "array", items: { type: "string" } },
    subclaimVerdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimAtom: { type: "string" },
          verdict: { type: "string", enum: ["true", "false", "partial", "unverified", "exaggerated"] },
          evidence: { type: "string" },
          boundary: { type: "string" },
        },
        required: ["claimAtom", "verdict", "evidence", "boundary"],
      },
    },
  },
  required: ["factCheckResult", "confidence", "sources", "supportingEvidence", "contradictingSources", "keyFindings", "counterEvidence", "unresolvedEvidenceGaps", "subclaimVerdicts"],
};
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/agentConfigs.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add mvp/src/lib/agentConfigs.ts mvp/src/lib/agentConfigs.test.ts
git commit -m "feat(fact-checker): 输出 schema 增加 subclaimVerdicts 逐命题定罪"
```

---

### Task 2: FactChecker prompt 契约约定逐命题覆盖

**Files:**
- Modify: `mvp/src/lib/agentConfigs.ts:592-609`（fact_checker systemPrompt）

- [ ] **Step 1: 在 FactChecker systemPrompt 追加约定**

在 `fact_checker` 的 systemPrompt 数组内（`mvp/src/lib/agentConfigs.ts:609` 的 `].join("\n")` 之前）追加两行：

```ts
      "subclaimVerdicts 必须覆盖输入 claimAtoms 中的每个原子命题，且每条 claimAtom 必须能回溯到原句；不得引入原句未声称的信息。",
      "verdict 取值：true=该原子命题成立；false=该原子命题不成立；partial=有真实片段但夸大/偷换；exaggerated=被夸大；unverified=证据不足。",
```

- [ ] **Step 2: 运行确认无回归**

Run: `npx vitest run src/lib/agentConfigs.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add mvp/src/lib/agentConfigs.ts
git commit -m "feat(fact-checker): prompt 契约约定逐命题定罪覆盖与回溯"
```

---

### Task 3: ReportComposer 消费 subclaimVerdicts 并输出覆盖不全兜底

**Files:**
- Modify: `mvp/src/lib/agentConfigs.ts:877-910`（report_composer 分支 buildAgentInput）
- Modify: `mvp/src/lib/agentConfigs.ts:405-...`（reportComposerSchema）
- Test: `mvp/src/lib/agentConfigs.test.ts`

- [ ] **Step 1: 写失败测试**

在 `agentConfigs.test.ts` 增加断言：调用 `buildAgentInput("report_composer", claim, steps)` 时，若 fact_step.output 含 `subclaimVerdicts`，则返回的 input.factCheck.subclaimVerdicts 被完整透传；若 claimAtoms 有 2 个但 subclaimVerdicts 只覆盖 1 个，则补齐缺失项为 `verdict:"unverified"` + `boundary:"模型未覆盖，待补证"`。

```ts
it("report_composer 透传 subclaimVerdicts 并补齐覆盖不全项", () => {
  const steps = [
    { agent: "rumor_detector", output: { claimAtoms: ["原子A", "原子B"] } },
    { agent: "fact_checker", output: { subclaimVerdicts: [{ claimAtom: "原子A", verdict: "false", evidence: "证据", boundary: "边界" }] } },
  ];
  const input = buildAgentInput("report_composer", "测试claim", steps as any);
  const verdicts = input.factCheck.subclaimVerdicts;
  expect(verdicts).toHaveLength(2);
  expect(verdicts.find((v: any) => v.claimAtom === "原子A")!.verdict).toBe("false");
  const missing = verdicts.find((v: any) => v.claimAtom === "原子B")!;
  expect(missing.verdict).toBe("unverified");
  expect(missing.boundary).toContain("未覆盖");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/agentConfigs.test.ts`
Expected: FAIL，`input.factCheck.subclaimVerdicts` 为 undefined。

- [ ] **Step 3: 实现 — 新增 helper `mergeSubclaimVerdicts` 并接入 report_composer 分支**

在 `agentConfigs.ts` 的 `compactText` 附近（约 815 行后）新增一个 helper，并在 `report_composer` 分支的 `factCheck` 对象中新增 `subclaimVerdicts` 字段。

```ts
function mergeSubclaimVerdicts(
  claimAtoms: unknown,
  verdicts: unknown
): Array<{ claimAtom: string; verdict: string; evidence: string; boundary: string }> {
  const atoms = compactStrings(claimAtoms, 6, 180);
  const raw = Array.isArray(verdicts) ? verdicts : [];
  const covered = new Set<string>();
  const result: Array<{ claimAtom: string; verdict: string; evidence: string; boundary: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const atom = typeof rec.claimAtom === "string" ? rec.claimAtom : "";
    if (!atom) continue;
    covered.add(atom);
    result.push({
      claimAtom: atom,
      verdict: ["true", "false", "partial", "unverified", "exaggerated"].includes(String(rec.verdict)) ? String(rec.verdict) : "unverified",
      evidence: compactText(rec.evidence, 200),
      boundary: compactText(rec.boundary, 200),
    });
  }
  for (const atom of atoms) {
    if (!covered.has(atom)) {
      result.push({ claimAtom: atom, verdict: "unverified", evidence: "", boundary: "模型未覆盖，待补证" });
    }
  }
  return result;
}
```

在 `report_composer` 分支的 `factCheck` 对象（`mvp/src/lib/agentConfigs.ts:892-902`）中新增一行：

```ts
        factCheck: {
          result: factStep?.output?.factCheckResult ?? "unverified",
          confidence: factStep?.output?.confidence ?? "low",
          subclaimVerdicts: mergeSubclaimVerdicts(rumorStep?.output?.claimAtoms, factStep?.output?.subclaimVerdicts),
          sources: compactStrings(factStep?.output?.sources, 6, 160),
          // ... 其余字段保持不变
        },
```

- [ ] **Step 4: 实现 — reportComposerSchema 增加 subclaimVerdicts**

在 `reportComposerSchema`（`mvp/src/lib/agentConfigs.ts:405` 起）的 `properties` 中新增 `subclaimVerdicts`（与 Task 1 的 item 结构一致），追加到 `required`。

```ts
    subclaimVerdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimAtom: { type: "string" },
          verdict: { type: "string", enum: ["true", "false", "partial", "unverified", "exaggerated"] },
          evidence: { type: "string" },
          boundary: { type: "string" },
        },
        required: ["claimAtom", "verdict", "evidence", "boundary"],
      },
    },
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/lib/agentConfigs.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add mvp/src/lib/agentConfigs.ts mvp/src/lib/agentConfigs.test.ts
git commit -m "feat(report): 透传 subclaimVerdicts 并补齐覆盖不全项"
```

---

### Task 4: 端到端回归验证

**Files:**
- Test: `mvp/src/lib/agentRuntime/AgentRuntime.test.ts`

- [ ] **Step 1: 跑全量测试确认无回归**

Run: `npx vitest run`
Expected: 502 项全绿（原基线 + 新增）。

- [ ] **Step 2: 类型检查**

Run: `cd mvp && npx tsc --noEmit`
Expected: 无新增类型错误（unmodified 文件既有错误除外）。

- [ ] **Step 3: Commit（若无改动则跳过）**

若上面测试未产生新改动，本步无需 commit。

---

## Self-Review

- **Spec 覆盖**：Task 1 覆盖"FactChecker 输出含 subclaimVerdicts"；Task 2 覆盖"契约校验加约定"；Task 3 覆盖"ReportComposer 消费 + 报告新增字段 + 覆盖不全标记"；Task 4 覆盖"全量回归"。
- **Placeholder**：无 TBD/TODO；每个代码步骤含完整实现。
- **类型一致性**：`subclaimVerdicts` 的 item 结构在 Task 1/3/4 中保持一致；`mergeSubclaimVerdicts` 返回类型与 schema item 一致；verdict 枚举 `["true","false","partial","unverified","exaggerated"]` 三处统一。

## 说明（超出 spec 本体的实现差异）

- 搜索锚定整句 claim 未改动（符合 spec 边界）。
- 整体 `verdictType`/`credibilityScore` 语义未动。
- 覆盖不全兜底在 `buildAgentInput` 层完成（确定性逻辑，不依赖模型），比在 prompt 里要求模型"补齐"更可靠。