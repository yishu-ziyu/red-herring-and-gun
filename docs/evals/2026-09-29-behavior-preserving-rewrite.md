# 2026-09-29 行为保持重写（Behavior-Preserving Rewrite）

用户 2026-09-29 指令：在不改变任何用户可观察行为、不改 UI、不优化交互、不加功能的前提下，
逐片替换 `apps/` 的现有实现，让核心代码换成清晰、可维护、低耦合的结构。行为等价优先于代码好看。
拿不准某个行为该不该变时，默认保持原样。

分支：`rewrite/behavior-preserving`，基线提交 `f96a37f`（main，含 round2 修复）。

## Change

1. **Phase 1 逆向**：`docs/behavior-spec.md`、`docs/architecture-current.md`、`docs/state-model.md`、
   `docs/external-contracts.md` 写清现有系统的真实行为与边界。本阶段不改生产代码。
2. **Phase 2 表征**：在基线代码上建立 golden master，覆盖正常、边界、错误、中断、重启、数据兼容、
   并发、状态恢复八类场景；自动化不了的写成验收场景。形成 `docs/golden-scenarios.md`。
3. **Phase 3 设计**：`docs/architecture-target.md`、`docs/rewrite-plan.md`。新增的每层抽象都要说明
   它解决哪一个现有失败方式。计划按竖切片排，一次换一个边界。
4. **Phase 4 增量替换**：每片按「确认旧行为 → 表征测试 → 新实现 → 保留旧接口 → 新旧对照 →
   golden 回放 → 删旧实现 → commit」走完再开下一片。
5. **Phase 5 差分验证**：新旧实现吃同一输入，比较输出、状态、副作用、持久化、网络交互和界面结果。
   任何差异要么修掉，要么单独写成待裁决的产品问题，不顺手改。
6. **Phase 6 收尾**：golden 全过、关键路径 E2E 全过、数据兼容与恢复路径通过、新代码不再依赖旧实现后，
   才删最后的旧代码，再做清理（死代码、重复抽象、兼容垫片、模块边界、文档）。

## Not this

- 不改 UI、文案、交互、业务规则、API 契约、SSE 事件形状、持久化格式（SQLite、localStorage、cookie、JSONL）。
- 不恢复 T20，不往冻结的 `packages/` 里写新功能；`investigation/` 字节镜像照旧两边一起改。
- 不把旧行为当 bug 顺手修。发现的问题记进 `docs/rewrite-issues.md`，等用户裁决；是否发到 GitHub 由用户决定。
- 不批量删旧测试。只删随被替换实现一起失效、且已有等价 golden 或新测试覆盖的内部测试，并在 commit 里写明。
- 不提交录音（外部回复原文、提示词、第三方内容）与真实用户数据；它们放 `outputs/`（已被 git 忽略）。
- 不推送、不发布、不动线上。
- 不碰 `rhg-fix` 工作区里未提交的端到端工作；那边的录音层设计在本分支复用时，差异写明。

## Evaluator

| 项 | 判法 | 通过线 |
|---|---|---|
| 单元与组件测试 | `cd apps && npm test` | 与基线同一批用例全过（已知偶发超时的用例单独重跑通过并记录） |
| 构建 | `cd apps && npm run build`；`cd apps/server && npx tsc --noEmit`；根目录 `npm test` 与 `npm run build` | 全绿 |
| golden 回放 | 同一份录音在基线与新代码上各回放一次，按 `docs/golden-scenarios.md` 的归一化规则比对 SSE 事件序列、完成报告、运行记录与活动、案件落库 | 逐字节相同；差异必须归入已裁决清单 |
| 回放确定性 | 基线代码对同一录音回放两次 | 两次逐字节相同（否则先修 harness，不许放宽比对） |
| 切片差分 | 每片保留旧实现对照，喂 golden 采集到的真实中间输入 | 全部语料输出相同后才删旧实现 |
| 浏览器端到端 | Ego 脚本在回放后端上走首页 → 提交 → 调查中 → 完成 → 来源抽屉 → 追问 → 历史重开 → 停止，数值断言 | 通过；截图存 `outputs/` |
| 真实端到端 | 真实供应商跑少量说法，新旧代码各一次 | 只作参考（模型输出不确定），不作等价证据；结果如实报告 |
| 人评 | 用户看界面与交互 | 用户裁 |

测试绿但用户路径不通时，改 evaluator，不改口说完成。
