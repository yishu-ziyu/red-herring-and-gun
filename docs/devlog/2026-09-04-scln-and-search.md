# 2026-09-04 · 协作层替换自动生成的 STATE；搜索先测再跳过

## 改了什么

- 工作记忆从 hook 生成的 `runtime/STATE.md` 换成手写 `docs/NOTES.md`。
- 协议收到短 `AGENTS.md`。验收标准开始进 `docs/evals/`。
- 搜索源额度错误后进程内跳过。

## 为什么

旧 runtime 层看起来像「压缩对抗」，实际是 session_start 用任务文件重写 STATE。当天就发生过：工作区里的 STATE 被写回成过期的「T19 checker 在跑」，把已合入 T24 的事实盖掉。这和 ContextPilot 要的「结论外置、压缩后先读」相反。

搜索侧先前记成「配额耗尽、AnySearch 返空」。按现象即信号先打了五家：AnySearch 活着，另外四家是余额/432/credits。系统却每条查询仍打五家，eval 会把死人打满。LLM 路由早已有进程级 skip，搜索没有。

## 结果

- SCLN 四层（协议 / 验收标准 / NOTES / 开发日志）就位。wiki/skill 本轮不建。
- 死源 skip 有单测：第二次 `searchAll` 只打 AnySearch。
- 被推翻的路：把 `runtime/STATE.md` 当记忆源；把「搜索全死」当成事实直接等充值。
