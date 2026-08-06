# UIUX 综合拷问 — 2026-08-06

> 源库：https://github.com/msitarzewski/agency-agents  
> 专家：UX Architect / UI Finish-Gate / Persona Walkthrough（小陈）  
> 真跑：`http://127.0.0.1:5180/` · 广西百色洪灾视频 · ~4m35s 收束

## 一句结论

**你们后端已经能查对（「不实 / 外地素材拼接」），UI 却把这件事做成了 Agent 运维台直播。用户要判决书，你给刑侦指挥中心。三方一致：HOLD，必须大改信息架构，不是换皮。**

## 三方对齐

| 角色 | 判决 |
|------|------|
| UX Architect | 死刑：办案台把「要不要转发」做成流水线直播；P0 五条可验收 |
| UI Finish-Gate | **HOLD**（不可 PASS） |
| 小陈（persona） | 三 fold 放弃风险全 High；信任单调掉 |

## 后台取证（你刚测的那类广西谣）

- 5180 vite 日志此前已出现：`网传百色严重洪灾视频实为外地素材拼接`
- 本轮我们重跑同主题 claim：
  - 耗时 ~4 分 35 秒
  - 结论文案正确（不实 + 拼接）
  - 但 UI 在等的全程：Case Workbench、双「立案分诊员」、空 Sources、模型 ID、事件流 KPI
  - 终态：结论仍嵌在时间线「最终判断已生成」按钮文案里，不像判决书首屏

截图：`mvp/output/uiux-audit/01`–`06*.png`

## P0（只这五条，先做完再谈美）

1. **默认去控制台化** — 无 Case Workbench / Agent Team / 模型 ID 作主信息  
2. **一级锚点** — 原句 + 人话三态（理解 / 对照报道 / 整理结论）  
3. **关键发现进一级**（含等待预告）— 「外地素材拼接」不得埋墙  
4. **结果首屏服务转不转** — 判定 → 人话 → 转发建议 → ≤3 来源  
5. **消重 + 空态诚实** — 双卡/双标题/空 Sources 假模块

## 保护域（别砍）

编排与真实事件流、ReportModal 逐条定罪、排除层、来源导出 — **机制保留，只改暴露层级**。

## Subagent 落盘

| 文件 |
|------|
| `docs/agents/uiux/README.md` + 4 wrappers + source-* |
| `docs/uiux-audit/2026-08-06-evidence.md` |
| `docs/uiux-audit/2026-08-06-ux-architect.md` |
| `docs/uiux-audit/2026-08-06-ui-finish-gate.md` |
| `docs/uiux-audit/2026-08-06-persona-walkthrough.md` |
| 本文件 |

## 下一步（需你拍板）

是否按 P0-1→3 开改 `MissionControlView` + 首页（大改等待屏），验收 case 固定：百色洪灾视频，**10 秒内能回答转不转**。
