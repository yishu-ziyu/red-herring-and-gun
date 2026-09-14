# 盐说法实跑 3（作判断超时修复后）

Date: 2026-09-15
Run: `23799fa5-36dc-41c6-9fe9-5dd0686db3ff`
契约：`docs/evals/2026-09-15-fact-checker-timeout.md`

原句同前：卫健委 5 克 / 人均 10 克 / 高钠危险因素 / NEJM 试验 + 「所以高血压全是吃盐造成的，全家换成低钠盐就能预防中风，肾功能不好的老人也完全适用」。

## 修复要点

- MiniMax-M2.7 作判断单次 180s（不再吃 90s 总默认）
- M2.7 超时一次不把 MiniMax 踢出进程；M3 仍一次跳过
- DeepSeek “Authentication Fails / api key is invalid” 算密钥失效并跳过
- 管道总时限 420s

## 时间线

| 时刻 | phase | 画面 | 记下 |
|------|-------|------|------|
| ~01:26 | received | `01-wait.png` | 空等拆题。日志：MiniMax rumor_detector timeoutMs=180000。 |
| ~01:27 | decomposed | `02-claims.png` | 命题上屏。 |
| ~01:32 | interrupted | `03-end.png` | 327 秒。作判断 MiniMax 29s / 38s / 47s 均在 180s 内完成。总答：「全是吃盐」站不住；「肾功能完全适用」站不住；「每天不超过 5 克」站得住。黄卡「收束时中途停了 / 下面是已经查到的」。预防中风标成立场表达，没进总答。报告收束没写完，但分条判断和第一句都在。 |
