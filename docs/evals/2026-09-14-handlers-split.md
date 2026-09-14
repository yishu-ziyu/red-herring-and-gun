# handlers-split — 删旧循环 + 钩子命名化

**用户裁定（2026-09-14）：新闻室批量核查走旧循环是历史遗留，废弃。第一刀把整套旧循环清掉。**

## Change（用户可见，必须不变）

- 提交说法开始调查、在结果上追问、取消、超时/刷新后取回：推到页面的事件序列与现在完全一样。
- 现有入口测试继续全绿。测试若因删除死代码而引用已删符号，只改测试的 import/死路径断言，不放宽行为。

## Change（维护者可见）

- 主调查入口函数打开后约十行内能看到骨架：校验 → 建这次调查 → 开始推送 → 调流水线 → 收尾。
- 流水线的钩子来自一个有名字的函数 `makePipelineHooks(…)`，不再是嵌在入口肚子里的匿名对象。
- 生产路径不再有「必须先排除的旧循环分支」。整套旧循环（`apps/server/src/lib/agentLoop/` 及主入口里的 `wantsAgentLoop` / `runClaimLoopPi` 死分支）删除。
- 新闻室批量接口（`/api/agent/batch`）删除：`BatchChecker.tsx` 唯一调用方本身也是遗留 v3 壳，测试已明确断言生产路径不渲染该组件。

## Not this

- 改变调查语义、结论顺序、活动流事件内容。
- 把测量啰嗦程度/结构侵蚀当完成依据。
- 拆 `runCasePipeline.ts` 或给它加新抽象层。
- 把追问改成独立 HTTP 接口。
- 把超时竞态、自带密钥逻辑提前做成通用框架。
- minify / 删注释刷分。

## Evaluator

```bash
cd apps && npm test
```

重点测试文件：
- `handlers.followupValidation.test.ts`
- `handlers.timeoutRace.test.ts`
- `handlers.followupObservation.test.ts`
- `handlers.friendlyError.test.ts`
- `handlers.investigation.test.ts`

批量相关（`BatchChecker.test.tsx`）：测试文件随组件一起删除。`quotaPolicy.test.ts` 中的 `/api/agent/batch` 断言更新为不再含该路径。

## 停手条件

- 入口主逻辑（不含注释）能在约 200 行内读完，每块有名字；
- `runCasePipeline.ts` 未改；
- `apps/server/src/lib/agentLoop/` 目录不在了；
- 主入口里的 `wantsAgentLoop` / `runClaimLoopPi` 死分支不在了；
- `cd apps && npm test` 全绿。
