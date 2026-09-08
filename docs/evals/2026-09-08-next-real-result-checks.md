# 下一批真实结果核对（post-#79 LIVE，待批准）

对象：批准后的真实调查输出，不是旧 Snapshot 回放，也不是改写后的历史样本。

历史矛盾保留为诊断材料：`docs/design/2026-09-06-mode3-production/final/real-after-76/snapshots/complete.json` 中 claim-2 为 not-applicable、evidence=[]，首屏却写两条均不成立。独立 Simulator 指出同一矛盾。这是 QA 发现，不是真人理解通过，也不证明 #79 新 producer 已重现或已修好该次真实调查。

## 必查，且不只查 URL 能否打开

对每个 Claim、每条 Evidence、首屏答案分别记录「支持范围」：

1. 关系标签是否与材料方向一致。support / contradict / related-only / 尚缺不得靠标题或能打开来决定。
2. finding 与摘录是否落在原文实际写下的限定里。原文若只说日常补充、特定人群或辅助缓解，不得把标签读成支持「能治/治愈」。
3. 摘录是否在原文中真实出现，有无截断导致范围被放大或缩小。
4. 首屏直接回答与各 Claim 的已知/未知边界是否同向。某 Claim 无方向性证据或 not-applicable / unverified 时，首屏不得把它写成已成立或不成立。
5. 合取句：A 有据且 B 未知，不得发布整句 true；A 有据 false 可以否定整句，但仍须保留 B 的未知边界。

## 禁止

- 只记录链接 HTTP 200。
- 用旧样本改字来展示新版成功。
- 把 Simulator 五问通过写成医学语义或真人理解通过。
- 在 #79 未合入、LIVE 未批准、前后端 SHA 未双绑时，把回放结果当成 post-#78 真实复验。

#53 / #54 保持开放。
