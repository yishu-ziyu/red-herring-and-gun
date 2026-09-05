# 验收标准：[Reset 2] 统一白盒调查数据契约（Issue #51）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#51。前置：#50（PR #55 已合并）。

## Change

把现有生产核查能力归一成一个前端可直接消费、运行中与完成后都成立的白盒调查语义契约 `InvestigationSnapshotV1`（命题 / 证据 / 冲突 / 缺口 / 判断），并提供：

1. server 与 web 共用的 versioned schema/type（唯一真值在 `packages/core`，生产 `mvp/server` 因部署只打包 `mvp/` 而使用带漂移守卫的同内容镜像；web 经 `@rhg/core/investigation` 消费）；
2. 生产数据 → Snapshot 的确定性映射（不调用额外 LLM）；
3. SSE 稳定语义事件 `investigation_snapshot`（完整 Snapshot，前端只取最新版）；
4. `finalReport.investigation` 稳定字段（完成态）；
5. 历史与中断的确定性重建（缺字段表达 unknown/unresolved，不启动模型/搜索）。

## Not this

- 不做 #52 的 Golden Path 前端 UI，不做 #53 视觉系统，不做 #54 用户理解实验。
- 不迁移整条生产 pipeline 到 CaseFile；不删除 `claimItems / subclaimVerdicts / evidenceChain / crossExam / evidencePursuit / citationSources` 任何现有字段。
- 不重建第二条核查 pipeline；不用 LLM 生成 Investigation JSON。
- 不做 Agent delta/event UI 协议；raw Agent/tool SSE 原样保留，Golden Path 前端未来可以完全不读取它们。
- 不把 Agent / provider / tool / token / RRF / 内部 verdict enum 放进用户语义契约的必要字段。
- 不改 `ops.sh`、不删 `mvp/`（T20 之前红线）。
- pi agent loop（`runClaimLoopPi`）与批量接口不在本期接线范围：它们的完成报告可通过同一 builder 从存储字段确定性重建，实时 Snapshot 只保证 Case Pipeline 路径。

## Evaluator

机器项（全绿才交付）：

- [ ] E1 `npm test`（root workspaces：core / eval / server / web）全绿；`npm run build` 全绿。
- [ ] E2 `cd mvp && npm test` 全绿（含新增契约测试）；`cd mvp && npm run build` 通过。
- [ ] E3 schema 唯一性：`packages/core/src/investigation/` 是唯一 type/schema 源文件；存在漂移守卫测试，字节级比较 core 与 mvp/server 镜像文件，任何单侧改动即测试红。
- [ ] E4 五类 golden case 均通过确定性 fixture：
  1. 明确错误：有绑定反驳来源 → judgment=refuted，反驳 evidence link 存在且可解析到 Source；
  2. 基本正确：有绑定支持来源 → judgment=supported，支持 link 存在；
  3. 半真半假：≥2 个独立 Claim，judgment 各自成立，不压成单一真假；
  4. 证据不足：judgment=unresolved，Gap 为 open，无来源可为 Gap；不得出现 refuted；
  5. 真实冲突：同一命题同时存在支持与反驳 evidence link → Conflict 存在；原因已知（crossExam 回应）与原因未知（reasonStatus=unknown、无 reason 字段或 unknown）至少各一例。
- [ ] E5 边界案例（fixture 断言）：
  - context-only（`sourcesRelatedOnly=true`）绝不映射为 support；
  - `unassessed` 只出现在检索返回后、FactChecker 核查前；judging/complete 阶段不残留 unassessed；
  - crossExam 未运行但证据层有双方来源 → Conflict 仍生成；
  - crossExam 两模型意见不同（disagree）但证据层只有单侧 → 不生成 Conflict；
  - `reasonStatus=unknown` 的 Conflict 不带 reason 文本；
  - 中断：phase=interrupted，保留已获得的 claims/sources/gaps，conclusion 缺省；
  - 旧历史报告（缺 investigation 字段）：可从 claimItems/subclaimVerdicts/非空字段确定性重建；缺判断字段表达 unresolved，不伪造；`_source==='error-boundary'` 重建为 interrupted；
  - Snapshot 中不出现 provider/model/agent/tool/token 字段（对整份 JSON 做黑名单键值扫描）；
  - 推断前提不冒充用户主张：dropped atoms 不进 claims；claims 仅来自 self-proof 后保留的原子。
- [ ] E6 命题追踪：每条 claim 可对照原句（originalSpan 仅在原子文本逐字出现在原句时给出；否则缺省）；有 verdict 判 supported/refuted 的 claim 必须存在对应 evidence link（production demote 规则保证）。
- [ ] E7 SSE：`investigation_snapshot` 在语义里程碑更新（received → decomposed → investigating（检索返回 unassessed）→ judging（核查绑定）→ 质询/补查 → complete / interrupted）；E2 的 server 集成测试断言里程碑序列与每帧 schema 校验通过；`complete` 事件里的 finalReport 含 `investigation` 字段且校验通过。
- [ ] E8 历史兼容：`GET /api/case/:caseId` 对新 case 直接返回已存 `investigation`；对旧 case（无该字段）确定性重建；重建不发起任何模型/搜索调用（测试以注入假环境断言零调用）。
- [ ] E9 raw SSE 兼容：现有 `agent_start/tool_start/tool_result/consensus_debate/complete` 事件不受影响（既有 handler 测试继续通过）。

人评项（单独列出等人裁，不阻塞机器交付）：

- [ ] H1 Snapshot 字段命名与粒度是否符合 #52 前端消费直觉（等人裁）。
- [ ] H2 中断时「保留多少已获数据」的展示口径（等人裁）。

## 结果

2026-09-06 回填。实现落点：

- 唯一契约源：`packages/core/src/investigation/`（schema.ts / build.ts / invariants.ts / index.ts）。生产镜像：`mvp/server/src/lib/investigation/`（同 4 文件字节一致）。原因：生产部署 `ops.sh` 只打包 `mvp/`（远端 `docker compose up -d --build` 只见 mvp/ 内容），server 不能运行时 import 工作区包；沿用仓库既有 claimAtom/text 镜像模式，并补上此前缺失的字节级漂移守卫测试（core 侧 + mvp 侧各一，改一侧必红）。
- 生产接线：`runCasePipeline.ts` 新钩子 `onInvestigationSnapshot`，8 个语义里程碑（received / decomposed / 每原子检索开始 / 检索返回 unassessed / 核查绑定 judging / 补查收束 / 质询收束 / complete）；complete 里程碑写 `finalReport.investigation`。`handlers.ts` 发 SSE `investigation_snapshot`；超时与失败补 phase=interrupted 帧（保留已获 claims/sources/gaps/conflicts，剥 conclusion，未判命题标 interrupted），超时报告挂同一 interrupted 快照。`caseHandlers.ts` 的 `GET /api/case/:id` 优先返回落库 investigation，缺失时用同一 builder 从 claimItems/subclaimVerdicts/crossExam/evidencePursuit/结论字段确定性重建，`_source==='error-boundary'` 重建为 interrupted。
- 未接线：pi agent loop（`runClaimLoopPi`，AGENT_LOOP 默认关闭，仅批量/显式 loop 使用）不发实时快照；其落库报告打开时走同一确定性重建。imageOrigin 未进 v1 快照（无归属命题，留待 #52 裁决呈现位置）；claim-less 聚合缺口（如原图没查到）暂不入 gaps。

逐条验收：

- [x] E1 根 `npm test`（core 576 / eval 85 / server 21 / web 83）全绿；根 `npm run build` 全绿。
- [x] E2 `cd mvp && npm test` 885 通过 / 1 跳过（既有 real 测试）；`cd mvp && npm run build` 通过；`cd mvp/server && npm run build`（独立 tsc）通过。
- [x] E3 镜像守卫：`packages/core/src/investigation/mirror.test.ts` 与 `mvp/server/src/lib/investigation/mirror.test.ts` 双向字节比较，4 文件 ×2 全过。
- [x] E4 五类 golden case（core `investigation.test.ts`）：1 明确错误（refuted+contradict 可解析）、2 基本正确（supported+support）、3 半真半假（mixed+refuted 两条独立命题）、4 证据不足（unresolved+open gap 无来源、非 refuted）、5 真实冲突（known reason 与 unknown reason 各一例）全过。
- [x] E5 边界：context-only 不算 support；unassessed 仅暂态（investigating 出现、complete 不残留）；crossExam 未运行仍有 Conflict；模型意见不同但证据单侧无 Conflict；reasonStatus=unknown 不带 reason；中断帧保留真实数据无 conclusion；旧历史确定性重建（complete / error-boundary=interrupted / 损坏返回 undefined）；快照键黑名单扫描（provider/model/agent/tool/token 等）为空；dropped 原子不进 claims。全过。
- [x] E6 命题追踪：逐字命中给真实 originalSpan（断言 start/end）、改写命题不给 span；supported/refuted 必有对应 evidence link（invariants 强制 + builder demote 兜底与生产同向）。
- [x] E7 SSE 里程碑：`runCasePipeline.investigation.test.ts` 断言 received→decomposed→investigating×4→judging×3→complete 序列、每帧 schema 可校验、finalReport.investigation 与最后一帧一致；handlers 测试断言 interrupted 帧。
- [x] E8 历史兼容：`caseHandlers.investigation.test.ts` 4 例（重建 complete / 原样返回 / error-boundary / 损坏 undefined）；重建为纯函数零模型零搜索调用。
- [x] E9 raw SSE 兼容：既有 handlers.friendlyError 等测试全过（E2 内）；raw 事件未改动。

人评项（等人裁，不阻塞）：

- [ ] H1 字段命名与粒度是否符合 #52 消费直觉。
- [ ] H2 中断时保留数据的展示口径。

eval:gate：未跑。理由：本期不改判词/检索/评分逻辑，只新增只读快照事件与 finalReport 字段；旧 gate 基线仍因资格标签缺失被判 invalid（与本改动无关）。如需全量真实回归，等人裁后单独跑。

## 复审 blocker 修复（2026-09-06）

PR #56 人工复审唯一 blocker：`claim.text` 不能使用 `claimAtomKey` 的结果作为展示文本——键函数会规范化全角空格并在 180 字截断后追加省略号，把键当展示文本会静默改写用户可见命题，且省略号会让 `originalSpan` 无法回到原句，违反 #50 命题透明。

Change：`buildInvestigationSnapshot` 改为 `{ key, text }` 分离——`key`（`claimAtomKey` 产物）只做 identity join（去重 / verdict / bundle / types / crossExam / pursuit），`text` 用 self-proof 后 kept atom 的真实文本（仅 trim）；`originalSpan` 按真实展示文本对原句计算。冲突循环原先用 `verdicts.get(claim.text)` 反查（在 text=键 时碰巧成立），随本修复改为按 assembly 携带的内部 key join，不受展示文本影响。

Evaluator：

- [ ] R1 超 180 字命题：`claim.text` 与原子原文逐字相等、不含省略号；判词与证据经内部 key 正常 join（supported + support link）；`originalSpan` 按真实文本定位回原句。
- [ ] R2 全角空格命题：键被规范化为半角空格，但 `claim.text` 保留全角空格原样；join 与 span 均正常。
- [ ] R3 既有 5 类 golden case 与全部边界案例不回归（同一测试文件全绿）。
- [ ] R4 镜像守卫：`build.ts` 两侧字节一致，core + mvp 双向守卫全过。
- [ ] R5 全量门禁：根 `npm test` / `npm run build`；mvp `npm test` / `npm run build` / `mvp/server` tsc。

结果（2026-09-06 回填，全绿）：

- [x] R1 `investigation.test.ts`「超 180 字命题」：text=原文 211 字无截断、judgment=supported、support link 存在、span={start:4,end:4+211}（fixture 按生产形状：byAtomKey 用截断键，判词用原文）。
- [x] R2「全角空格」：key=`"空气中 氧气约占两成"`（半角）正常 join 判词与检索集，text 保留 `\u3000`，span 按全角文本命中。
- [x] R3 investigation 测试 24 项（原 22 + 新 2）全过；镜像守卫 4×2 全过。
- [x] R4 build.ts 两侧 `cmp` 一致。
- [x] R5 根测试 core 578 / eval 85 / server 21 / web 83 全绿，根 build 绿；mvp 885 过 / 1 跳过，mvp build 与 server tsc 绿。
