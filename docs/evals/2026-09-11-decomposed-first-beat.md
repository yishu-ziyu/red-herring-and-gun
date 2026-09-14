# 拆问题第一拍在调查画布落地 · 验收

- 日期：2026-09-11
- 来源：`docs/design/2026-09-11-investigation-experience/HANDOFF.md` 与实际全栈画布闭环
- 现状：`received` / `decomposed` 阶段虽只渲染拆问题单人，但缺少「谁在拆、拆成了什么」的体感：原句中切片短语默认 underline 透明看不到；拆问题角色缺少活跃拆分流动与拆毕收拢状态；命题列表在尚未有证据时缺乏明确的待查议程骨架感。

## Change

1. **原句切片可见标定**：
   - 当 `claims.length > 0` 时，原句中拆出的关键片段（`gp-trace-mark`）拥有清晰细腻的默认下划线（非 transparent，细线条），悬停/聚焦时激活为高亮重墨/强调色；
   - 证明系统准确理解了用户原句的各个切片，与下方拆出的问题形成直接对应。

2. **拆问题角色工作态与收拢**：
   - `phase === "received"` 时：工作区只有「拆问题」到场，显示 shimmer 流光动效与「拆分问题中」；后三位角色不出场（保持 1 人）；
   - `phase === "decomposed"` 时：拆问题角色状态结算为「已拆出问题」（或带条数），动效收拢；后三位角色仍不出场；
   - `phase === "investigating"` 及之后：后三位角色按既有 70ms 间隔依次平滑滑入。

3. **命题容器的待查骨架**：
   - `phase === "decomposed"` 阶段，命题列表作为「要核对的问题」议程清晰呈现，带序号 `01`、`02`，排版规整无空状态报错；
   - 明确建立起“这是给后续调查派发的工单容器”的视觉心智，无缝承接后续带回的材料与证据。

4. **样式规范与无障碍**：
   - 彻底杜绝薄荷绿芯片、对话气泡或伪造思考流；
   - 支持键盘 Tab 聚焦原句片段联动；`prefers-reduced-motion` 下关闭流光与位移。

## Not this

- 不做聊天气泡对话流（不把四个角色变成 AI 聊天头像）。
- 不把模型私有 CoT 思考流放到主界面。
- 不推倒重写已稳定的 `InvestigationCanvas` 与 `WorkRoles` 结构。
- 不使用成功绿或胶囊芯片。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | `phase === "received"` 时 `WorkRoles` 仅渲染拆问题，带拆解中 shimmer/doing 状态 | `goldenPath.test.tsx` | 命令 |
| E2 | `phase === "decomposed"` 时 `WorkRoles` 仅渲染拆问题，状态为已拆出（完成） | `goldenPath.test.tsx` | 命令 |
| E3 | `phase === "decomposed"` 时原句对应切片短语带可见细下划线样式 | 读 CSS / 测试 | 命令 |
| E4 | `phase === "decomposed"` 时命题区呈现清晰的待查议程（01 / 02 等待查命题） | `goldenPath.test.tsx` | 命令 |
| E5 | 进入 `phase === "investigating"` 后，后三位角色带 `is-enter` 登场，原句切片保持可交互 | `goldenPath.test.tsx` | 命令 |
| E6 | 无回归：`cd apps && npm test` 全绿，`cd apps && npm run build` 通过 | 命令 | 命令 |
| E7 | 人看真实调查过程：原句切片清楚、拆问题单人工作后收拢、命题整齐列出 | 人评 | 人评 |

## Evidence

- 测试：`apps/src/goldenPath/goldenPath.test.tsx` 补充针对 `received` / `decomposed` 第一拍的断言。
- 构建与测试：全量 116+ 套测试通过，无红项。
