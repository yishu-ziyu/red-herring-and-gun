# 重写计划：增量竖切（2026-09-29）

一次只换一个边界。每片都走完同一套步骤，再开下一片：

```text
确认旧行为 → 表征测试（已有 + 补） → 新实现（保留旧接口） → 新旧对照（差分） → golden 回放 → 删旧实现 → commit
```

差分的做法统一为：**旧实现对同一输入的输出，作为新实现的预期**。
- 系统级：同一份录音，基线代码与新代码各回放一次，`golden.ts compare` 逐项比对（`golden-scenarios.md`）。
- 模块级（影子运行）：切片期间旧实现仍是主路径；设了 `RHG_DIFF_DIR` 时，旧实现开始前把边界的全部输入深拷贝一份，旧实现跑完后用拷贝跑一遍新实现（外部副作用按旧实现的结果重放，不再联网、不再发事件），逐字段比对两边跑完后的全部状态，每次比对写一个文件到 `RHG_DIFF_DIR`。单元测试与 golden 回放（`harness.ts` 把 `RHG_DIFF_DIR` 按场景传给服务进程）都开着它跑一遍，语料就是边界上真实出现过的全部输入。切片结束时影子代码与旧实现一起删除。
  选影子运行而不是「采集到文件再离线重放」：边界上有 handlers 注入的闭包（收尾钩子带着截图解析结果），写不进文件；进程内深拷贝保留真实钩子与对象之间的引用关系。
- 语料强度：差分全过之后，再对新实现做变异（调换步骤顺序、删一步），看单元测试、golden、差分能不能发现；发现不了的先后关系补表征测试。

基线：`f96a37f` 的服务端 golden（标签 `base`）与界面 golden（标签 `ui-base`）。任何一片发现差异，先判断是新代码的错还是旧行为本身有问题；后者写进 `rewrite-issues.md` 等用户裁决，**不在切片里改**。

## Slice A：报告收尾链 → `casePipeline/finalizeReport.ts`（2026-09-29 完成）

| 项 | 内容 |
|---|---|
| 边界 | `runCasePipeline.ts` 从 `assembleFinalReport` 到完成快照之前的收尾块（约 230 行） |
| 旧行为 | `behavior-spec` 12.1；`architecture-target` 2.3 的顺序 |
| 表征 | 已有：`runCasePipeline.test.ts`、`runCasePipeline.wholeClaimAudit.test.ts`（27 条）、`runCasePipeline.shannonConjunction.test.ts`、`reportAssembly`、`conclusionGate`、`sentenceVerdict`、`reportReviewer`、`citationLiveness` 各自的测试；golden 全部场景 |
| 新实现 | `finalizeReport()`：16 段有序步骤写在一个函数里；收尾钩子、复核开始回调、来源探活都是注入的端口；返回终态报告、deadUrls、复核结果 |
| 差分 | 影子运行：探活按旧块判出的死链重放（旧块探活出错则同样抛错）；比对终态报告、全部步骤的 output（含 `factStep.output`）、检索包、deadUrls、复核结果；`checkedAt` 只比格式 |
| 删旧 | 删除内联块与影子代码 |
| 风险 | 原地修改的对象引用：`reportStep.output` 与 `finalReport` 是同一对象，`factStep.output` 在守门里被改（`_factCheckResultDerived`）。新实现必须保留这些副作用，差分要比对 `factStep.output` |
| 结果 | 差分 116 条输入全部逐字段相同：单元测试 82 条、golden 17 条 × 两种时钟（其中 44 条有死链剔除、1 条探活通道出错、7 条原子级守门救回 mixed、12 条短谣通道被收权门拦下）。开着影子跑的 golden 与基线 20/20 相同。变异 12 个（调换或删掉一步）：追问直答、打不开的链接、整句判定后的重绑这三处原来没有任何测试或 golden 能发现，补了 `finalizeReport.test.ts`（7 条，含副作用顺序与探活端口失败语义），并在短谣通道用例里加了命题条目与全局引用的断言；之后单元测试 + golden 能发现 10 个，剩下 2 个（复核后不重绑、质询记录挪到复核之后）只改复核结果里不外露的报告副本，用户可见输出不变。换上新实现后 golden 与 `base`、`base-nv` 20/20 相同，界面 golden 与 `ui-base` 8/8 相同，apps 全量 1482 passed / 0 failed。`runCasePipeline.ts` 1,541 → 1,344 行 |

## Slice B：管线阶段与进行态 → `stages/*`、`caseState.ts`、`budget.ts`、`snapshotTimeline.ts`（2026-09-29 完成）

| 项 | 内容 |
|---|---|
| 边界 | `runCasePipeline` 函数体（Slice A 之后剩下的约 850 行） |
| 旧行为 | `architecture-current` 第 5 节阶段链；快照顺序 `state-model` 2.2 |
| 表征 | `runCasePipeline.*.test.ts` 全部（9 个文件）；golden 全部服务端场景（外部请求清单必须逐条相同：阶段顺序与请求内容不能变） |
| 新实现 | 八个阶段函数 + 进行态；`runCasePipeline` 只剩顺序与预算判断；对外签名与返回值不变 |
| 差分 | 系统级 golden（录音保证同一输入）；模块级复用现有 fake 驱动的测试 |
| 删旧 | 旧函数体整体替换，不留并存路径 |
| 风险 | 请求发出顺序与内容一变，录音就对不上（miss）。`network` 清单比对能立刻发现 |
| 结果 | `runCasePipeline.ts` 1,344 → 454 行（其中对外类型约 200 行），函数体只剩阶段顺序。新增 `budget.ts`（阈值与 7 个具名判断，每个判断保留原来的比较方向）、`snapshotTimeline.ts`（5 个里程碑方法，合并语义不变）、`sourceAudit.ts`、`caseState.ts`、`stages/` 8 个文件；`throwIfAborted` 的位置逐个保留。golden 与 `base`、`base-nv` 20/20 相同，外部请求发出顺序与基线一致（g12 关虚拟时钟时基线代码自己也会换序），界面 golden 8/8，apps 全量 1488 passed / 0 failed。变异 8 个（调换阶段、挪动或删掉审计刷新、首份 judging 快照提前、刷新后不重算）：单元测试原来只能发现 1 个，golden 能发现 7 个（其中 1 个只有请求顺序提示能看出，golden 为此加了发出顺序比对）；补了 `runCasePipeline.stageOrder.test.ts`（整条调用与快照序列）与 `sourceAudit.test.ts`（5 条），之后单元测试 8 个全能发现。golden 录音只在本机，这两条测试是仓库里守阶段顺序的东西 |

## Slice C：HTTP 调查处理器 → `http/investigationRun.ts`、`http/sseChannel.ts`、`http/orchestrateStream.ts`

| 项 | 内容 |
|---|---|
| 边界 | `handlers.ts` 的 `orchestrateStreamHandler` 与 `investigationEventsHandler` |
| 旧行为 | `behavior-spec` 第 9、10 节；`state-model` 2.1、第 3 节 |
| 表征 | `handlers.*.test.ts`（6 个文件）、`orchestrateByo.test.ts`、`quotaPolicy.test.ts`、`checkQuota.test.ts`；golden g10–g20（停止、断线接回、重复提交、重启、全挂、检索挂、自带密钥、旧数据、额度、MCP、错误请求） |
| 新实现 | 结局枚举 + 结算表；SSE 通道共用 |
| 差分 | 系统级 golden；结局表对每个 catch 分支逐条对照写单测 |
| 删旧 | 删 catch 分支与重复的写帧代码 |
| 风险 | 帧顺序与额度结算时机；golden 的帧序列与 quota 查询结果能发现 |

## Slice D：前端产品壳 → `app/use*.ts`

| 项 | 内容 |
|---|---|
| 边界 | `App.tsx` 里的业务状态与副作用 |
| 旧行为 | `behavior-spec` 第 2、3、6、7、9 节；`state-model` 2.4 |
| 表征 | `App*.test.tsx`（4 个文件，35 条）、`stopAndResume`、`presentationIssue*`、`materialAndAccount`、`resultAndQuota`；界面 golden（逐帧 DOM、localStorage、客户端请求） |
| 新实现 | 四个 hook；App 只组合 |
| 差分 | 界面 golden 基线 `ui-base` 对比；浏览器端到端（Ego 脚本，数值断言） |
| 删旧 | App 内联状态整体移走 |
| 风险 | 副作用执行顺序（React effect 顺序跟声明顺序走）；界面 golden 的逐帧 DOM 与 localStorage 能发现 |

## Slice E：死代码与清理

| 项 | 内容 |
|---|---|
| 目标 | `ReasoningProvider` 与 `reasoningStore`（无消费者）、`casePipeline/testSourceRelationAudit.ts` 移到测试目录、`handlers.ts` 的过时注释、确认无用的再导出 |
| 表征 | 界面 golden；构建；全量测试 |
| 不在此片 | `styles.css` 的旧壳样式：需要像素对比的视觉 golden，另开一片且要用户看图裁决 |

## 顺序与依赖

```mermaid
flowchart LR
  G[Phase 2 golden 基线] --> A[Slice A 收尾链]
  A --> B[Slice B 管线阶段]
  G --> C[Slice C HTTP 处理器]
  G --> D[Slice D 前端壳]
  B --> E[Slice E 清理]
  C --> E
  D --> E
```

A 在 B 之前：收尾链先独立出来，B 搬阶段时函数体已经短了一截。C、D 与 A/B 互不依赖。

## 每片完成时必须有的证据

1. `cd apps && npm test` 全过（与基线同一批用例）。
2. `cd apps && npm run build`、`cd apps/server && npx tsc --noEmit`、根目录 `npm test` 与 `npm run build` 全过。
3. `golden.ts replay <片名>` 后与 `base` 比对全部 PASS；界面相关的片再加界面 golden 比对。
4. 模块级差分（有采集语料的片）全部相等。
5. `docs/NOTES.md` 头部更新；commit 信息写清换了哪个边界、删了哪些旧实现、差分覆盖了多少条输入。
