# 2026-09-14 代码松散度快照

Date: 2026-09-14
来源：按 measure-code-slop 技能对仓库做只读测量。数字只许来自 `scripts/measure.py`（或其包装的 scb-check JSON），不许模型估分。

## Change

用户能看到本仓库由 `scripts/measure.py`（或它包装的 scb-check JSON）算出的啰嗦程度、结构侵蚀、源码行；这两项数字旁对照人类仓库与模型生成两档已发表区间；热点（克隆组 / 高复杂度函数 / 松散规则命中）最多 10 条来自工具，或工具明确给出 none。

## Not this

- 模型打 1–10、凭感觉说代码还行、脚本失败后填数、为了刷分去压缩/删注释/把函数揉成一行。

## Evaluator

报告里的 verbosity、erosion、total_loc（及 loc_delta 若有）必须能在 measure.py 输出的 JSON 里逐字对上。`scb-check` 退出码 1 表示有 findings，不算失败。脚本失败是退出码 2+ 或没有 JSON——此时只报失败并停止，禁止填数。

## Evidence

measure.py 的 JSON + 按规定表格写的中文报告。
