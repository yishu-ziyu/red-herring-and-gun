# packages/ — 脊柱

ADR-007 的领域与未来运行时。根目录 `npm test` / `npm run build` 跑这里。  
**公网还没切过来。** 用户现在走的是 `apps/`。切换是 T20，见 `docs/REPO.md`。

| 包 | 职责 | 现在谁在用 |
|----|------|------------|
| `@rhg/core` | 领域：调查快照、判决规则、检索、公开文案、模型调用、脊柱 stages | 生产已经在用 investigation 等模块；`apps` 前端经 `src/lib/investigation` 再导出 |
| `@rhg/server` | 未来 Express（事件溯源 CaseFile） | 未接 `ops.sh` |
| `@rhg/web` | 未来界面 | 未接 `ops.sh` |
| `@rhg/eval` | 黄金集与 `eval:gate` | 根目录 `npm run eval:gate` |

`core/src` 按领域切，不按「前端/后端」切：

```text
investigation/   白盒快照（生产镜像在 apps/server）
text/            用户看见的字：publicCopy、引用、命题
rules/           判决纪律、公式分
search/          检索、过滤、证据追索
llm/             模型供应商（实现层）
stages/          脊柱阶段机（intake → … → finalize），生产编排仍是 casePipeline
fetch/           抓网页、以图搜图
runner/          脊柱回合
```

改领域规则：先改 `core`，再改生产镜像（若该文件有镜像），再跑两边测试。不要只在 `apps/server` 里改一份。
