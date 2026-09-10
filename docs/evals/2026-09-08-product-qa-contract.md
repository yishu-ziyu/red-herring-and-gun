# 2026-09-08 产品验收契约与 QA 基础（工作包 B 第一版）

性质：本文件是任务书《Red Herring 下一轮开发任务书》工作包 B 的验收标准（先于实现建立），同时是后续产品验收的契约入口。它不修改产品答案，不替 PR #79 宣告通过，不改变 #53/#54 的任何人评门槛。

## Change

建立独立于实现的验收基础：行为清单（含尚未覆盖范围）、确定性验证器入口、证据 manifest、失败分诊字段、报告生成器。运行模式（REAL_LIVE / RECORDED_REPLAY / SYNTHETIC_FIXTURE / FAULT_INJECTED_LIVE）与 driver（browser_agent / deterministic_runner / human）在记录结构中强制区分。

## Not this

- 不修改产品代码行为（`mvp/`、`packages/` 生产源码零改动；唯一仓库内改动是新增 QA 文件、QA 脚本与 npm 入口）。
- 不替 #79 宣告通过；不触发模型费用（qa:live 不实现，只登记为待实现接口）；不新增面向用户的 Agent、控制台或日志。
- 不宣称「模拟用户看懂了」等于真人研究结果；不伪造参与者、原话或情绪。
- 不把 LegacyDesk / eval:gate 历史失败改口径；不动 baseline。

## Evaluator（对工作包 B 本身的完成标准）

- **E1**：`docs/qa/behavior-inventory.yaml` 存在且每条 behavior 都含全部必需字段（`behavior_id / requirement_ref / 用户目标 / 前置条件 / 允许的结果 / 禁止的结果 / 测量程序 / 证据路径 / 严重度 / 当前覆盖状态`），由 `qa:report` 的 schema 校验强制（缺字段即非零退出）。
- **E2**：必需行为不以「已实现」为分母：无法给出有效证据的条目必须是 `missing / blocked / pending-audit` 之一并写明原因；`blocked` 必须写阻塞条件（如 blocked-on-#79-merge、blocked-on-#53、blocked-on-#54-human-validation、blocked-on-live-budget）。
- **E3**：`npm run qa:report` 在空证据目录下能生成报告：所有需要运行证据的条目为 NOT_RUN，退出码非零（fail-closed）；附一个带完整证据的最小 fixture 时，对应条目 PASS 且退出码由其余 NOT_RUN 决定。报告生成器自身的该行为有单元测试覆盖（含「证据缺字段不得 PASS」「FAIL 不被其他 PASS 抵消」两个反例）。
- **E4**：`npm run qa:contracts` 对 main 上已成立的不变量（#74 证伪分桶、related-only 降级、merge 覆盖补全、marker clamp、双桶保留）实际断言且全绿；依赖 PR #79 的组合（方向契约三处一致、audit fail-closed、hard-verdict 未查清边界）登记在 `docs/qa/pending-after-79.yaml`，状态 `blocked-on-#79-merge`，不被静默跳过也不假装通过。
- **E5**：`python3 scripts/qa/qa_smoke.py` 能真实启动 headless Chromium 并截图（浏览器工具可用性的实测证据，存 `docs/qa/artifacts/` 下带日期的目录）；设置 `QA_BASE_URL` 时对产品输入卡做真实断言，未设置时如实输出 `TOOL_PROBE_ONLY`。本轮实际运行结果记录在本文件「本轮实测」节。
- **E6**：五条 npm 入口的状态如实：`qa:report` / `qa:contracts` / `qa:smoke` 已实现；`qa:replay` / `qa:live` 只在本文档登记为待实现接口，package.json 里不存在同名假脚本。
- **E7**：根 `npm test`（workspaces）与根 `npm run build` 仍全绿；本分支不改 `mvp/` 下任何文件。
- **E8（人评，等人裁）**：行为清单的覆盖判定是否诚实；`pending-after-79.yaml` 的组合是否与 PR #79 的回归一一对应；qa:live 预算与审批流程设计是否可接受；后续批次是否放行。

## 契约结构（对后续所有 QA 运行生效）

### 状态语义

`PASS / FAIL / BLOCKED / NOT_RUN / NEEDS_HUMAN / NOT_APPLICABLE`（NOT_APPLICABLE 必须附与契约对应的理由）。没有执行、缺证据、环境不对、评分器不可用不得显示 PASS。必需非人评门存在 FAIL/BLOCKED/NOT_RUN 时自动化总门非零退出；自动化门全过但人评尚缺时报 `AUTOMATION_PASSED_HUMAN_PENDING`，不得写 READY_TO_SHIP。

### 运行模式与操作者

每个 trial 同时记录 `execution_mode`（REAL_LIVE / RECORDED_REPLAY / SYNTHETIC_FIXTURE / FAULT_INJECTED_LIVE）与 `driver`（browser_agent / deterministic_runner / human）。Agent 操作真实浏览器是 REAL_LIVE 但不是 HUMAN。环境/前后端版本无法证明时结果记 `ENVIRONMENT_UNVERIFIED`。

### 缺陷记录字段

按任务书附录 B：`defect_id / requirement_ref / observed_behavior / expected_behavior / reproduction / evidence_refs / reproducibility / category(产品代码|模型语义|测试器|环境|规格歧义|UNTRIAGED) / severity / root_cause / issue_or_review_ref / regression_test / fix_pr / independent_verification`。未能重现的现象保留为 `OBSERVED_UNCONFIRMED`，不删除。

### 预算与停止（对 qa:live 生效；本轮未获批不运行）

live investigation 总计 ≤16 次（含失败重试）；产品调查并发 1；每探索 session ≤40 次 UI 动作 / ≤10 分钟；每缺陷 ≤2 次自动修复尝试、每批 ≤3 轮测量—修复—重验；金额未知不填 0。qa:live 未实现前这些是登记值，不是已生效配置。

### 隔离等级

当前所有运行共用同一账户与 shell，`isolation: logical-only` 如实标注，不宣传为严格盲测。保留题（未公开组合/改写）在本分支不存在，待 #79 合入后由 Validator 另建并放在 Implementer workspace 之外；在此之前 `pending-after-79.yaml` 的组合清单本身就是公开的。

## 本轮实测（2026-09-08，分支 `qa/product-acceptance-foundation`）

以下全部为实际运行结果（不是预期声明）：

- `npm run qa:report`（空证据目录）：`gate=GATE_NOT_MET counts={'NOT_RUN': 7, 'PASS': 3, 'BLOCKED': 3}`，exit 1（fail-closed）。3 项 PASS 是 `evidence_kind: repo-suite` 的确定性仓库套件（随根 npm test 对当前 HEAD 运行）；trial 型证据目前为零，相应行为如实 NOT_RUN。
- trial 记录的正反语义由 `python3 -m unittest discover -s scripts/qa -p "qa_report_test.py"` 覆盖（10 项全绿）：缺必需字段拒绝；check 声称 PASS 但 `evidence_refs` 为空 → 记录非法；FAIL 不被其他 PASS 抵消（GATE_NOT_MET）；covered 无有效 trial → NOT_RUN；`backend_sha: unverified` 的 trial 不产生 PASS（ENVIRONMENT_UNVERIFIED）；自动化全过 + 人评门未完成 → `AUTOMATION_PASSED_HUMAN_PENDING`；repo-suite 证据 → PASS。
- `npm run qa:contracts`：7 项全绿（#74 证伪分桶、双桶关系保留、marker clamp、每桶去重、merge 覆盖/编造丢弃/非法回退、无源 true/false 收 unverified、报告级全局归一与越界 marker 删除）。
- `npm run qa:smoke`：headless Chromium 真实启动并渲染本地探针页 + 截图成功（`docs/qa/artifacts/tool-probe/<UTC 日期>/smoke.png`，12.9KB）。Python Playwright 默认浏览器缺失，脚本按缓存可执行文件回退（`chromium_headless_shell-1234`）——该回退行为本身已实测。未设 `QA_BASE_URL`，输出 `TOOL_PROBE_ONLY`，未对产品做任何断言。
- 根 `npm test`：612（core，含新增 contracts 7 项）+ 85（eval）+ 21（server）+ 83（web）全绿；根 `npm run build` exit 0。
- `mvp/` 与 `packages/` 生产源码零改动：`git diff origin/main --name-only` 仅含 `docs/qa/*`、`docs/evals/*`、`scripts/qa/*`、`package.json`（仅新增三条 qa 脚本）。
- `qa:replay` / `qa:live` 未实现：package.json 中不存在同名脚本（E6）；qa:live 的预算登记值见上文「预算与停止」。
