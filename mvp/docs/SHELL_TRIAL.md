# 过程壳试用（叙事流 · Ant Design X 形）

## 默认行为（2026-08-06 起）

**Live 默认开启 token 叙事壳**，无需 `?shell=1`。

| 开关 | 效果 |
|------|------|
| （默认） | token 叙事流 |
| `?shell=antdx` 或 `VITE_MISSION_SHELL=antdx` | Ant Design X ThoughtChain |
| `?shell=legacy` 或 `VITE_MISSION_SHELL=legacy` | 旧过程流回退 |
| `VITE_MISSION_SHELL=off` | 同 legacy |

## 立刻可看（不跑真模型）

```text
http://127.0.0.1:5180/shell-preview
http://127.0.0.1:5180/shell-preview?fixture=mid&variant=token
```

切换 **开跑 / 中段 / 完成 / 审稿未过 / 调解 / 失败 / 角色失败** 假 SSE。  
过程区是**单一叙事流**：无内层 claim/phase/进行中胶囊，无顶层工具条与角色芯片；工具嵌在步骤下。  
Query：`fixture=early|mid|complete|review_fail|debate|error|agent_error`，`variant=token|antdx`。

## 真案 + 过程壳

```text
http://127.0.0.1:5180/                 # 默认 token 叙事流
http://127.0.0.1:5180/?shell=antdx     # Ant Design X
http://127.0.0.1:5180/?shell=legacy    # 旧流回退
```

开案后过程区占主列（运行中不预留空右栏）。顶栏 claim/阶段只出现一次。  
完成态：过程壳内 **判决首屏**（判定 · 人话 · 转发建议 · 关键发现 · ≤3 来源），完整报告仍可在右栏展开。

## 代码落点

| 层 | 路径 |
|----|------|
| 默认开关 | `src/lib/missionShell/resolveShellMode.ts` |
| 适配器 | `src/lib/missionShell/streamAdapter.ts` |
| 模型 | `src/lib/missionShell/types.ts` |
| Fixture | `src/lib/missionShell/fixtures.ts` |
| 单测 | `src/lib/missionShell/*` + shell UI |
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
