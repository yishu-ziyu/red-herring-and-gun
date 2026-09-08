# LIVE 四次：准入与强制方式（待批准，实际 0 次）

状态：REQUESTED，未批准。本文件说明上限如何强制执行；不是授权，也不是 qa:live 实现。

将测版本必须在每次启动前写入收据，缺一则 BLOCKED：

| 绑定 | 如何证明 | 当前已有 |
| --- | --- | --- |
| 前端 candidate SHA | `git rev-parse HEAD`，dirty/diff hash | 回放收据 frontend_sha=`b55b03b` |
| 后端 candidate SHA | 实际服务进程的 40 位 git SHA，且 `/api` 绑定 JSON 与该 SHA 一致 | 回放 backend=`DISABLED_RECORDED_REPLAY`，没有后端 SHA |
| 输入 | 本次用户原句，不是旧 Snapshot | 未执行 |

`out/shannon-80-review-head/replay` 是未改写的 real-after-76 Snapshot 在当前 UI 上的 RECORDED_REPLAY。它不能证明 #79 新 producer，不能当作真实调查、实时延迟或真人理解通过。

## 调用上限（可执行）

四次调查，失败、重试、fallback 均计入。并发 1。

- 每次：最多 40 次模型请求、80 次搜索请求。
- 批次：最多 160 次模型请求、320 次搜索请求。
- 墙钟：每次 10 分钟、批次 40 分钟。
- 浏览器：每 session 至多 40 个动作。
- 模型：仅 MiniMax-M2.7-highspeed；独立质询仅 step-3.7-flash。其它 fallback 未申请，一旦出现即计次并停止该次。
- 计数点：每个 provider HTTP、每次 retry、每次 fallback、每次搜索 provider 分别 +1。超限必须在发起下一请求前拒绝，而不是事后记录。

实现位置：现有 `runCasePipeline` 的 `runAgent` / `searchOne` 外包一层计数器即可，不必新建 QA 平台。未接线前不得开跑。

## 总费用上限（当前不可执行）

账户实际费率 unknown。没有单价表时，金额上限不能从调用次数换算，也不能写成 0。

可执行条件（缺一 BLOCKED）：

1. 用户书面给出本批人民币或美元硬上限；
2. 写入 MiniMax / StepFun / 各搜索源的计费单价或套餐剩余查询；
3. 计数器在每次请求前用「已用 + 下一次最坏单价」与上限比较，超限拒绝。

在此之前只申请调用额度，不把未知费用当已批准预算。

## 取消 / 停止

已有：

- 浏览器关页：`handlers.ts` 在响应 `close` 时 `disconnect.abort()`，`runCasePipeline` 在阶段边界 `throwIfAborted()`。
- 阶段边界最多再浪费一次模型/搜索调用后退出。

未有，因此「停止计费」仍 BLOCKED：

- `withTimeout` 是 `Promise.race`。总超时取胜后，`pipelinePromise.catch(() => {})` 吞掉后续错误，在途 HTTP 不会被 abort。
- `providerRouter.withTimeout` 同样 race，不把 AbortSignal 传进 `callMiniMaxAgent` 等 fetch。
- MiniMax 的 `callMiniMaxAgent` 已接受 `signal`，但 `dispatchSingleProvider` 未传入。

停止机制要成为可执行：超时与用户取消必须 `abort()` 同一条 signal，并把它传到每个 provider fetch。在此之前 LIVE 维持 BLOCKED，不能仅凭墙钟声明开跑。

## 停止预算

每根因最多 2 次自动修复；本批最多 3 轮测量—修复—重验。用尽后停，等复审。
