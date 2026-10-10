# 首批四题参考材料（未执行 LIVE）

核对日：2026-09-08。独立 Validator 会话只做公开网页阅读；没有模型调查、没有费用授权。与 Implementer 共用账号和目录，隔离为 logical-only，不是严格盲测。下表是允答范围，不能抄历史 Snapshot 作为标准答案。医疗专业准确性保留 NEEDS_HUMAN。

| 编号 | 调查原句 | 允答范围与禁止外推 | 参考与状态 |
| --- | --- | --- | --- |
| 1 历史 | 维生素C能治感冒，而且每次感冒都应当输液。 | 分开维生素 C 的预防、规律补充与症状出现后治疗；不得用有限病程影响证明治愈。每次都输液必须单独有适应症证据，不能用维生素来源证明它，也不能把未查到当成已证伪。允许整体未获支持、明确未知边界；若用反证否定合取，保留两个部分各自的状态。 | Cochrane 2013 综述与 CDC 普通感冒页面已读；输液具体适应症尚无独立临床指南，NEEDS_HUMAN。 |
| 2 历史 | 吃饭会使血糖升高，胰岛素可以降低血糖，所以所有人每顿饭后都应该注射胰岛素。 | 生理前提、药理作用和全人群治疗建议分开。NIDDK 的糖尿病治疗依据不能推出所有人、每餐后均需注射。不能把前提真汇总为整句 true；必须解释治疗适应症与个体差异这个推理缺口。 | NIDDK 治疗说明已读；饮食引起血糖变化的量化条件未单独核对，个体治疗和专业措辞 NEEDS_HUMAN。 |
| 3 正向 | 地球围绕太阳运行，而且月球围绕地球运行。 | NASA 对两部分均有直接支持，可给整体 supported/true；不能靠全 unknown 通过。无需引入原句没有声称的完美圆轨道或固定距离。 | NASA 2017-01-25 教育原文已读；非医疗正向对照，参考范围 READY。 |
| 4 Validator 保留变式 | 月球的公转围绕地球，地球的公转则围绕太阳。 | 第 3 题的倒序改写；两部分独立有据，引用必须跟随实际 Claim 身份，不随编号重排错绑。允答同第 3 题。此变式选定后不用于产品修补；若公开用于修补，转公开回归，再另选保留题。 | 同 NASA 原文；只测表达与顺序变化，不声称覆盖未知所有变式。已写入共享目录，故不是权限隔离的盲题。 |

已核对的原始资料：

- [Cochrane: Vitamin C for preventing and treating the common cold](https://www.cochrane.org/evidence/CD000980_vitamin-c-preventing-and-treating-common-cold)，2013 年综述，搜索截至 2012 年 11 月。一般人群规律补充未显著降低发病率；规律补充的病程影响与患病后才开始补充是不同问题，后者试验未显示一致的病程或严重程度效果，仍需要研究。本材料不冒充 2026 年最新全面综述。
- [CDC: Manage Common Cold](https://www.cdc.gov/common-cold/treatment/index.html)，读取当前页面。多数普通感冒无需特定治疗，页面给出休息、补充液体等处理，并区分需要就医的情形。口服饮水建议不能当作静脉输液指南，也不能推出任何人任何情况下不得输液。
- [NIDDK: Insulin, Medicines, & Other Diabetes Treatments](https://www.niddk.nih.gov/health-information/diabetes/overview/insulin-medicines-treatments)，读取当前页面。治疗依糖尿病类型和血糖控制而不同，胰岛素有不同给药方式及用药时机。页面不是全人群每餐注射建议；个体用药结论不在本 QA 的裁决能力内。
- [NASA: What Is an Orbit? (Grades K-4)](https://www.nasa.gov/solar-system/what-is-an-orbit-grades-k-4/)，2017-01-25。正文明确月球绕地球、地球绕太阳，支持第 3、4 题普通语言层面的两个部分。轨道精密力学不在原句范围。

旧失败保留：docs/design/2026-09-06-mode3-production/final/real-after-76/snapshots/complete.json 的 claim-2 为 not-applicable、无 evidence，而 conclusion 声称两条均不成立。其 UI 可回放不等于医疗语义已通过。本 dossier 没有修写这份记录，也不为旧结论补造来源。

执行前门：先由用户批准金额或明确调用额度，A 人工合入后再启动正式 post-#78 复验；4 次包含失败与重试、并发 1。费用、服务和墙钟上限由总预算申请列明，本文件不授权任何调用。独立 Simulator 不得读取此文件。
