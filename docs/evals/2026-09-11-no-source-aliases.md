# 完成态正文不写来源序号 · 验收

- 日期：2026-09-11
- 用户原话：观察结果页是不是仍然会出现很多内部语言，比如 S1、S3；改动要从全栈想。
- 复现：咖啡争夺战争真实完成态。解释段与依据加粗句都有 `S1将…`、`S3/S5中…`、`S2/S4同样…`。材料列表本身没有这些编号。

## 这件事是什么

检索给写作模型的来源曾带 `id`/`ref` = `S1`、`S2`。提示还允许「来源编号」。模型把序号写进 `conclusion` / `evidence`。结果页把 `evidence` 再挂成 finding。上一轮只剥了 `[n]` 和 `wholeClaimAudit`，S 编号留下了。

可见正文里的材料点名，用标题、域名，或让下面的收据自己说话。句内 `[n]` 仍只给管线绑定，完成态画面继续剥掉。

## Change

人在完成态读到的判断解释、依据论点句、材料说明，不再出现 `S1`、`S3/S5`、`S2/S4`、`C1` 这类检索序号。

## Not this

- 只在前端正则掉 S1，prompt 和检索压缩仍把来源标成 S1。
- 把管线里的 `[n]` 绑定也删掉。
- 误伤「第一次世界大战」、CSS、普通英文缩写。
- 编造 finding 来填空。
- 把内部评分用的 source.id 改名就算修完（那一层可以继续用自己的键，只要不进写作输入、不进用户正文）。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| E1 | 咖啡案那句经 `scrubPublicText` 后不含 `S1`/`S3`/`S5`/`S2`/`S4`，标题书名号还在 | `publicCopy.test.ts`（core 与 mvp/server） | 命令 |
| E2 | `compactSearchResultForAgent` / `buildReportEvidenceInputs` 给模型的来源没有 `S1` 这类 id/ref | 服务端测试 | 命令 |
| E3 | 写作提示不再允许「来源编号」作为用户正文点名方式 | 读 `agentConfigs.ts` 断言 | 命令 |
| E4 | 完成态画面：rationale 与 `.gp-point` 都不含 `S1`；与判断段重叠的 finding 不出现 | `goldenPath.test.tsx` | 命令 |
| E5 | 论点句若与结论不是同一段，finding 仍在（不误伤「通常不需要输液」） | 既有 investigation 测试仍绿 | 命令 |
| E6 | 门禁 | `cd mvp && npm test`；行为变更另跑根测试中与 publicCopy / investigation 相关的套件 | 命令 |

人评：同一条咖啡完成态再打开，解释和依据不再出现 S 编号。
