# 2026-09-05 · 指标名称必须等于实际测量对象

一句话：只检查引用编号和 URL 是否存在的指标，不得继续叫“幻觉率”。

## Change

- 将现有 `hallucinationRate` 改名为 `citationIntegrityErrorRate`；计算逻辑保持为悬空引用、未知 evidence、案外 URL 和缺报告错误率。
- 运行结果、汇总、门禁快照、公开导出和测试统一使用新名；不同时输出旧名制造两个看似不同的指标。
- 指标版本升级，旧快照因名称与语义版本不同而明确拒绝比较。

## Not this

- 改个中文解释但 JSON、门禁和代码仍叫 hallucination。
- 把引用结构完整推断成事实语义正确。
- 暂时没有语义幻觉 evaluator，就用 0 代替未知。

## Evaluator

- eval 单元测试：原有四类引用结构错误仍按同一数值计算，新字段名贯穿 case、summary、gate。
- 静态检查：`packages/eval/src` 的生产代码不再导出或输出 `hallucinationRate`；测试可保留旧名，只用于证明旧快照被拒绝。
- gate 单元测试：旧 metricSemver 快照拒绝比较，新快照缺少 `citationIntegrityErrorRate` 时拒绝读取。
- 真实回归 JSON：只出现 `citationIntegrityErrorRate`；报告语义是否越界不由该值宣称。

## Goal / Hard bar / Improve

- Goal：用户看到一个指标名就能知道它是怎么得到的。
- Hard bar：名字与计算一致，旧基线不可偷渡，新输出不宣称已测语义幻觉。
- Improve：等同事实证据与报告逐句语义 evaluator 可用后，再新增独立指标，不复用当前名称。
