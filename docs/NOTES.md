# 当前状态

- 正在做：[#131](https://github.com/yishu-ziyu/red-herring-and-gun/issues/131) 已完成本地收束与验收，保留rewrite/evidence-first供评审；#129原文接线已完成，#128工具暂停，#130分支收束完成。未合并/发布。
- 看板：[docs/board/index.html](board/index.html)；数字曲线：[docs/metrics/index.html](metrics/index.html)。
- 最近数字：生产测试1533通过/13跳过，离线合同12/12；三例真实运行78/147/326秒，其中苏打水末次规则修正用真实输出重放验收；记录见[本次验收](evals/2026-09-30-single-investigation-result.md)。

## 刚落地、仍然有效

- **`packages/core` 未同步 Shannon 修补**：没有 `textbookAtoms.ts` / `wholeClaimAudit/conclusionGate.ts`，也没有 `extractLeapAtoms` / `repairGatedConclusion`。`stages/decompose` 是模型拆题，不是剥连词。契约 `docs/evals/2026-09-15-core-shannon-sync.md`。
- **真实用户路径（Issue E）**：提交混合说法 → 点关键依据 → 抽屉命题/摘录/原文 URL 对上该条 → 保存后历史重开日期不变、不 POST 新调查。分享预览只渲染 GET 脱敏投影；撤销后 `/s/` 明确不可用。进行中指针走 resume GET，不重开、不扣额。五类输入：混合 / 无实质争议 / 证据不足 / 中断已覆盖；链接失败纳入已有 `inputStageLinkScrape`。人评 5 人未做。契约 `docs/evals/2026-09-15-presentation-issue-e.md`。

- **首页案例、简报、历史、分享（Issue D）**：输入下方案例卡用生产 fixture（混合说法 / 语境错位 / 证据不足），主操作「查看这次调查」走同一套结果组件、不发起调查、不扣额；次要「用同一说法重新查」。复制简报含原句、判断、边界、日期、来源 URL，失败可见，不用产品署名当证据。历史重开保持原日期、不 POST 新调查；抽屉写清本机与账号留存范围；保存失败可重试且不改原日期。分享预览渲染 GET 公开投影正文；`/s/` 不存在或已撤销不静默回首页；Vite 代理 `/s/`。契约 `docs/evals/2026-09-15-presentation-issue-d.md`。
- **B+C 并行核对**：同一文件里 C 的停止总答（`closedAnswer` / `data-gp-interrupted-answer`）和 B 的完成态顺序（结论区关键依据 → 详情 → 追问/案卷）并存。前端 24 文件 284 绿；C 服务端 3 文件 31 绿。
- **收束时限（Issue C）**：judging 之后、写报告之前，可核查命题都有判断且剩余时间不够一次写报告（约 90s 窗口 / MiniMax 单次 180s）则走确定性报告再 complete，不把 interrupted 标成 complete。`timeout_pending` 后流结束无 finalReport 用 `interruptedInvestigationSnapshot` 收口。停止信号仍只在阶段边界生效（未接入 runAgent/检索）；点停止且分条已齐时总答仍可见，不重复说「中断」。刷新 GET 未改额度。契约 `docs/evals/2026-09-15-presentation-issue-c.md`。
- **完成态阅读顺序（Issue B）**：结论区先原句再 24px 直答；1–3 条可点关键依据（无决定性证据则为零，不拿相关材料凑数）；缺口与适用边界在依据之后；追问与案卷排在逐条核查详情之后；来源目录默认折叠且在边界之后，首屏不是胶囊墙。追问不编「双方」模板。未改停止/中断/超时显示条件。契约 `docs/evals/2026-09-15-presentation-issue-b.md`。2026-09-15 人评：`127.0.0.1:5173` 的 `?fixture=mixed` / `complete` / `conflict` 在 1440 与 390 均为 PASS（Cursor 内置浏览器标签建完即消失，改对同一地址用本机 Chrome 走查）。
- **完成态展示（Issue A）**：案卷默认材料 / 分歧 / 缺口，没有公共活动就不写调查经历；禁止固定秒数与疾控/永久保留；`ConclusionHero` 不再替换混合判断原句；顶部来源用原始 EvidenceLink 与真实 claimId；外链默认「打开原文」，不写「已查验」「前往官方原文核验」「权威材料」。契约 `docs/evals/2026-09-15-presentation-issue-a.md`。
- **调查界面字阶**：SF Pro Regular/Medium，字距 `-0.15px`；字号只 12/13/14/24px；墨 `#292929` / `#5D5D5D` / `#9E9E9E`；导航圆角 8px、卡片 16px、主按钮药丸。24px 只给首页标语和结论第一句；调查中原句 14px。活动流在左栏原句下，角色标签无色块。契约 `docs/evals/2026-09-15-type-and-salt-run.md`。
- **阅读顺序**：空等有正文，不数秒当标题；命题只在主列出现一次；思考默认折叠。契约 `docs/evals/2026-09-14-investigation-reading-order.md`。
- **中断**：没有分条判断 → 「还没有写成总判断」，不编第一句。分条判断已齐 → 「收束时中途停了」并按判断拼总答。契约 `docs/evals/2026-09-15-salt-followthrough.md`。
- **这次没查**：原句里没进命题的整句留下，不按逗号切碎。同一 finding 只挂一次；摘录约 80 字。
- **作判断时限**：MiniMax-M2.7 单次 180s；M2.7 超时两次才跳过（M3 一次仍跳过）；密钥无效跳过；管道总时限 420s。盐说法 `23799fa5` 作判断 29/38/47s 完成，终态有总答。契约 `docs/evals/2026-09-15-fact-checker-timeout.md`。
- **拆题**：所以/因此后的跳跃强制进命题；同一 URL 不得同时当支持和反驳。契约 `docs/evals/2026-09-14-salt-p1-p2.md`。

## 已经否定、不要再当现行

- `agentLoop` / `AGENT_LOOP=1` / `?loop=1`：代码已删，ADR-006 废止。
- 调查中原句 24px、空等只显示秒数、假三步 01/02/03、中断清掉已有结论、MiniMax 一次 90s 超时就当额度耗尽：都已改掉。
- 生产目录不是 `mvp/`。
- 旧三栏壳与 `/?legacy=1`：2026-09-28 已删除，可从 tag `legacy-desk-final` 找回。

## 还没做完

- 完整 live eval gate 与最终版本完整真实追问理解质量尚未验收；本轮已分别验证真实运行收束、快照重放和停止链路，不合并宣称整版端到端全绿。
- T20：生产切到 `packages/` 脊柱。2026-09-28 起暂停，`packages/` 冻结，见 `docs/devlog/2026-09-28-pause-t20.md`。
- `qa:contracts` 已指向apps生产离线行为合同；真实模型质量评测为单独的eval:live。
- `apps/src/lib/v4-ui-e2e.test.ts` 的 framer-motion 检查仍指向不存在的 `mvp/` 路径，永远空跑通过。

更早条目见 `docs/devlog/2026-09-status-archive.md`。不要从 `docs/evals/` 里翻已被取代的「未做」句当现状。
