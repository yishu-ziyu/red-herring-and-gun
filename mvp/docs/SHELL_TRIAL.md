# 过程壳试用（认 A · Ant Design X 形）

时间线：半小时已延长至 **1 小时**（约至 20:12）。

## 立刻可看（不跑真模型）

```text
http://127.0.0.1:5180/shell-preview
http://127.0.0.1:5180/shell-preview?fixture=error&variant=antdx
```

切换 **开跑 / 中段 / 完成 / 失败 / 角色失败** 假 SSE，看 ThoughtChain 形过程、工具条、角色芯片、结论卡、中断态与单角色异常。  
Query：`fixture=early|mid|complete|review_fail|debate|error|agent_error`，`variant=token|antdx`（mount 时读；点 tab 会 `replaceState` 写回地址栏；非法值回退 mid/token）。

## 真案 + 过程壳

```text
http://127.0.0.1:5180/?shell=1          # token 自绘壳（默认稳）
http://127.0.0.1:5180/?shell=antdx      # 真 Ant Design X ThoughtChain
```

开案后左侧过程区切换为 **过程壳 · X 形**（适配 SSE 实时折叠）。  
不加 `?shell` 仍是原 legacy 流。

环境变量（可选）：

```bash
VITE_MISSION_SHELL=token npm run dev   # 或 antdx
```

## 代码落点

| 层 | 路径 |
|----|------|
| 适配器 | `src/lib/missionShell/streamAdapter.ts` |
| 模型 | `src/lib/missionShell/types.ts` |
| Fixture | `src/lib/missionShell/fixtures.ts` |
| 单测 | `src/lib/missionShell/*` + shell UI（约 23+ pass，见 vitest） |
| 壳 UI | `src/components/v3/phases/mission/MissionProcessShell.tsx` |
| 预览 | `.../MissionShellPreview.tsx` + App `/shell-preview` |
| 直播接线 | `MissionControlView` 累积 `sseEvents` |

## 变体

- 默认 live / 预览：`variant=token`（自绘 ThoughtChain 形，稳）
- 预览页可点 **Ant Design X**：`variant=antdx`（真 ThoughtChain + 深色 token）

## 依赖

已装：`@ant-design/x` `antd` `@ant-design/icons`  
当前默认渲染是 **token 自绘对齐 X 形状**（不绑架全局 Ant 蓝）；原生 ThoughtChain 替换为后续可选。

## 后端未动

SSE 协议不变；只是前端多折叠一份 `MissionShellModel`。
