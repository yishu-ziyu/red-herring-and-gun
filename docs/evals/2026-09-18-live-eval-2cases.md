# 2026-09-18 发布后 live eval 抽查：2 案例

背景：新版本已发布到 `https://gun.yishuziyu.cn`（bundle 指纹已确认）。完整 24 案例 live eval gate 用户裁决不跑全量，抽查 2 个即可。`--gate` 模式要求 totalCases 与基线全量相等，2 案例子集不能走 gate，改看单案 pass/fail 与关键指标。

## Change

不改动任何代码。仅执行 `cd apps/server && npx tsx eval/run.ts --ids RUMOR-006,RUMOR-008`（真实供应商、生产管线进程内执行，消耗真实 API 费用）。

案例选择理由：
- **RUMOR-006**「浙大研究发现：冷冻馒头不能吃，冷冻超过两天会长黄曲霉素」：causal/health，medium。走含 `alternative_explanation_searcher` + `counter_evidence_grader` 的扩展链路；陷阱「误引权威名义」「混淆黄曲霉毒素产生条件」与 Issue #90 同型，直接检验关系审计修复后的健康类因果判断。
- **RUMOR-008**「中国体育代表团出征奥运会自带300多个空调和床垫」：event，hard。预期 `mixed_misleading`、可信度 10–30，检验「只能信一部分」的部分成立判断路径。

## 结果（2026-09-18 执行）

- **RUMOR-006：PASS**。verdict=`false`（预期一致）、可信度 4（区间 [0,15]）、检索 12 条 URL、结论「不能信」，242s。
- **RUMOR-008：FAIL，与历史基线同因，非本次发布退化**。verdict=`false` ≠ 预期 `mixed_misleading`（可信度 14 反而落在预期区间 [10,30]，检索 16 条 URL），207s。该案在 26 案例历史基线中即以同一原因「verdict mismatch」列于 failures，且标注 difficulty: hard。信号是「分数对、标签错」：打分认为部分可信，verdict 标签却给成 false。
- 聚合：passed 1 / failed 1，credibilityAccuracy 1.0。过程中有供应商 401/余额不足/JSON 不合 schema 报错，均被 provider 降级兜住，两案都产出终态报告。
- 已按契约「两案均 pass 为绿」如实记录：**未全绿**，其中一案为基线已知的 hard 难点。记录已追加 `.ship/evaluation/benchmark-history.jsonl`（runId `eval-1789700624150`）。

## Not this

- 不跑全量 24 案例 gate；2 案例聚合数不与 26 案例基线比较。
- 不在本契约内做公网端到端调查（用户随后亲自在公网体验，属人评）。
- 不改 golden 数据集、评分器或管线代码。

## Evaluator

机器项：
- 两案各产出终态报告（无 ERROR），输出 JSON 追加到 `.ship/evaluation/benchmark-history.jsonl`。
- 每案 `verdict` 与 `expectedVerdictType` 一致（RUMOR-006=false、RUMOR-008=mixed_misleading），`credibility` 落在期望区间（[0,15] / [10,30]），检索发生（searched=true 且 urlCount>0）。
- 单案 pass/fail 以 eval 输出为准；两案均 pass 为绿。

人评项（单独列，等用户裁）：
- 用户在 `https://gun.yishuziyu.cn` 亲自提交说法、走完整调查、看结论与依据展示。
