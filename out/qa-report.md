# QA 覆盖报告（自动生成，勿手改）

- 清单：`docs/qa/behavior-inventory.yaml`
- 总门：**GATE_NOT_MET**

| behavior | 严重度 | 清单状态 | 判定 | 阻塞/说明 |
|---|---|---|---|---|
| input-fidelity | HIGH | pending-audit | NOT_RUN |  |
| claim-decomposition | HIGH | partial | NOT_RUN |  |
| evidence-relation-direction | HIGH | covered | PASS |  |
| whole-claim-audit-consistency | HIGH | blocked | BLOCKED | PR #79 merge（组合清单见 docs/qa/pending-after-79.yaml） |
| failure-unknown-semantics | HIGH | partial | NOT_RUN |  |
| citation-scope-integrity | HIGH | covered | PASS |  |
| dynamic-ui-identity | HIGH | partial | NOT_RUN |  |
| visual-quiet-editorial | MEDIUM | partial | NOT_RUN |  |
| follow-up-usage | MEDIUM | pending-audit | NOT_RUN |  |
| privacy-isolation | HIGH | partial | NOT_RUN |  |
| simulated-comprehension | HIGH | blocked | BLOCKED | qa:live 未实现（且真人理解属 #54，blocked-on-#54-human-validation） |
| human-comprehension | HIGH | blocked | BLOCKED | #54 真人环节（HUMAN_VALIDATION_PENDING） |
| environment-version-binding | HIGH | covered | PASS |  |

高严重度错误不与其它分数抵消：任何 FAIL 都独立列在上方并使总门失败。
本报告不写 READY_TO_SHIP；人评门全过且人工裁决后才可能由人宣布验收完成。
