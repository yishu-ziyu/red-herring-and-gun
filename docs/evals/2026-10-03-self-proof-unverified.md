# self-proof 全丢时的证据不足判词

## Change

- self-proof 连续两次拒绝全部候选时仍保留候选并完成调查；检索只给中性标题和摘要、核查与报告均没有支持或反驳判断时，最终整句判词必须为 `unverified`。Evaluator：现有 `runCasePipeline.test.ts` 的「self-proof 两次全丢」断言保持不变并通过。
- 独立识别导致无依据 `false` 的环节，并增加不依赖 self-proof 的回归：中性材料不能变成反驳依据。Evaluator：旧失败先红后绿；新增负向反例独立通过；单变量对照只改变来源标题，证明搜索查询复制进来源标题造成污染。
- 同一最终工作树根测试、根构建、apps 全量测试、apps 与 server 构建通过。Evaluator：`npm test`、`npm run build`、`npm --prefix apps test`、`npm --prefix apps run build`、`npm --prefix apps/server run build`。

## Not this

- 不删除、跳过或改弱失败测试的 `unverified` 断言；不使用真实供应商或凭据。
- 不改冻结的 packages 业务实现，不部署、不合并。

## Evaluator

以上离线命令只验证确定性规则与模拟端口，不代表真实供应商核查质量；最终精确 SHA 由主 agent 复核。

## 根因与证据

生产判词规则没有把中性检索结果判成反证。旧 `makeSearchOne` 将实际收到的搜索查询直接复制进来源标题；证据追索追加的 `事实A 辟谣` 查询因此伪装成了真实辟谣页标题。生产按该标题绑定 `debunk-title` 反证，最终规则成为 `primary-refuted`。

独立 reviewer 用同一生产代码、相同查询/URL/answer/snippet 做单变量对照：旧标题为 query 时整句 `false`；只将标题改为中性资料索引后整句 `unverified`，规则为 `primary-unresolved`。这证明夹具污染，而不是需要修改生产判词规则。原失败的 `unverified` 断言保留，修复仅让来源元数据与测试声明的中性材料一致。

新增反例不用修复后的搜索 helper、不经过 self-proof，故意使查询、URL 与 answer 都含辟谣词，但来源标题/摘要保持中性；它断言整句与分条均为 `unverified`、反证为空，禁止搜索意图被当成证据。

## 验证结果

- 原 self-proof 全丢断言在修复前实际失败：expected `unverified` / actual `false`；修复后该组已通过。
- 新独立负向反例定向通过；独立 reviewer 再次运行也通过。
- 根测试 832 通过；根构建、apps 前端构建、server TypeScript 构建通过。
- `npm run eval:gate` 实际执行后退出 1：tsx 创建 `/tmp/tsx-0/31.pipe` 时被运行环境拒绝（EPERM），未进入供应商阶段。未读取本地凭据、未运行真实供应商 eval，也未用 fake 结果代替 gate。该门禁属于暂停的 packages 脊柱，不覆盖 apps 生产实现。
- apps 全量 155 files 通过、2 files skipped；1496 tests 通过、13 skipped、0 failed（118.00s）。完整机器运行日志位于 `/tmp/red-verdict-gates/`。未部署、未合并；本轮无新增浏览器验收。


## 续查补充

同等 `node --import tsx` 入口已绕过原 tsx CLI IPC 限制。冻结 packages 和生产 apps runner 均实际进入启动检查，均因缺真实 API key 退出 1。未用 fake 跑分或改基线；真实供应商门禁仍未通过。公开 SSE 另补真实 localhost HTTP 三连接回归，详见公开出口契约；不将其算作浏览器走查。
