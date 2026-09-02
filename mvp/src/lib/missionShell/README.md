# missionShell — SSE → 过程模型

把 `orchestrate-stream` 事件收成 `MissionShellModel`。直播 UI 是 `ApodexRunView`（`mapShellToApodexRun`）。本目录不负责编排。

## 试用

直播过程是 `ApodexRunView`。`?shell=legacy` 不是产品路径。

## 目录

| 文件 | 作用 |
|------|------|
| `types.ts` | ThoughtChain / Tool / AgentChip / Verdict 形状 |
| `streamAdapter.ts` | `OrchestrateStreamEvent[]` → `MissionShellModel` |
| `fixtures.ts` | early / mid / complete / review_fail / debate / error / agent_error |
| `labels.ts` | verdict / factCheck / claimType / 信源等级中文化 |
| `streamAdapter.test.ts` | 适配器单测 |
| `labels.test.ts` | 文案单测 |

```ts
import { adaptOrchestrateStreamToShell } from "./missionShell";

const model = adaptOrchestrateStreamToShell(events, { claim });
// model.thoughtItems / model.tools / model.agents → ApodexRunView 过程条目
// model.verdict → ApodexRunView 完成态判断
// model.errorMessage → ApodexRunView 中断提示（role=alert）
```

## UI

| 组件 | 路径 |
|------|------|
| 直播过程 | `components/v3/phases/mission/ApodexRunView.tsx` |
| 直播接线 | `MissionControlView` 累积 `sseEvents` → adapter → `mapShellToApodexRun` |

## 字段映射（SSE → Shell）

| SSE type | Shell |
|----------|--------|
| planner_update | thought kind=planner |
| agent_start/complete/error | thought kind=agent + agents[] |
| agent_error (no stream error) | phase「角色异常」; chip/thought error; **live 仍 true**; 无 errorMessage |
| tool_* | tools[] + thought kind=tool\|review |
| report_reviewer tool | tools key=tool:report_reviewer |
| complete | verdict + thought kind=report |
| error | phase「过程中断」+ errorMessage + fail thought + live false |

## 边界

- 只是过程层组件；不改 SSE 协议、不换产品壳
- 默认 `variant=token`（稳）；`antdx` 可选
- 角色芯片可筛选 thoughtItems（保留 planner/report/review）
