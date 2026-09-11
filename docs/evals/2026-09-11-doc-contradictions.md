# 文档真相源矛盾清单

盘点日期 2026-09-11。每条都给两侧 `file:line`，并标注处置。

## 一、本次已改（无歧义，只是陈述过期）

| # | 事项 | 改前 | 改后 | 依据 |
|---|---|---|---|---|
| C1 | 默认模型 | `CONTEXT.md:13`「Same MiniMax-M3 as the rest of the pipeline」 | 改为 MiniMax-M2.7-highspeed 默认、M3 显式覆盖 | `PRODUCT_SPEC.md:113,127` 明写公网默认 M2.7-highspeed；CONTEXT 那句是 08-30 改默认之前的旧陈述 |
| C2 | 前端托管 | `DEPLOYMENT_CHECKLIST.md:40,48,67`「指向 Vercel，或由服务器 Nginx 托管」并教用 Vercel IP 验收 | 改为「阿里云 Nginx 单源」；Vercel 段标为历史 | 2026-09-11 已把 `gun` 记录从 CNAME→Vercel 改为 A→121.89.90.68；`README.md:78` 与 `ARCHITECTURE.md:7` 本来就写 Nginx |
| C7 | 运行时决策指向 | `docs/ARCHITECTURE.md:27`「尤其 ADR-003」 | 改为指向 ADR-007，并注明 ADR-003 已被取代 | `docs/adr/ADR-007-casefile-spine.md:10`「与 ADR-001～006 冲突处以本文为准」 |
| C8 | 隐藏强度 | `README.md:20`「属实现层，默认不出现」 | 改为「一律不出现在用户界面」 | `PRODUCT_SPEC.md:55` 用的是一律不许出现；「默认」会被读成可以开开关 |

## 二、需人裁（涉及产品判断，未改）

| # | 事项 | 两侧 | 为什么不能替你决定 |
|---|---|---|---|
| C3 | 五个词（说法/出处/判断/追问/历史）是否仍是现行规则 | `docs/ROADMAP.md:3`「用户确定：产品顶层语言用五个词讲」 vs `docs/PRODUCT_SPEC.md:57`「属于历史设计探索用语，不作为产品宪法或信息架构的硬性约束」 | 一处说现行、一处说历史。PR #55 把五词降为「顶层语言与导航骨架、不是封闭词表」后，两处措辞没有统一。要么把 ROADMAP 那句改成服从，要么把 PRODUCT_SPEC 那句改回去 |
| C4 | 「当前先做独立 HTML 原型」是否仍是当前顺序 | `docs/ARCHITECTURE.md:14,18` 仍把它写成当前计划 vs `docs/PRODUCT_SPEC.md:206`「该原型计划已由 Product Reset 全面接管…不再作为当前主线顺序」 | ARCHITECTURE 的「本轮接线状态」整节停在 2026-09-05，之后 #51/#52/#64/#65/#67/#76/#85 都已落地。这节需要重写而不是改一句 |
| C5 | `mvp/docs/` 下 6-8 月的技术文档是否仍是实现细节真相源 | `docs/PRODUCT_SPEC.md:166`「管线、按条检索、公式分、自证闸门的实现细节以代码和 `mvp/docs/` 技术文档为准」 vs `mvp/docs/DEV-LOG.md:7`「写报告只许能信/不能信/只能信一部分/还查不清」、`mvp/docs/agent-system-architecture.md:37`「Mission Control 大卡片展示 Agent 使命、工具、记忆写入」 | DEV-LOG 与 agent-system-architecture 里的口径已被 `PRODUCT_SPEC.md:157`（「Mission Control 不是产品脸」）和第 76-78 行（结论第一句不许用那四个词）废止。要么给 `mvp/docs/` 加「历史，非现行规则」横幅，要么把 PRODUCT_SPEC 的指针改到别处 |
| C6 | 谁压谁 | `docs/ROADMAP.md:7`「本轮会话定的事优先于历史文档；冲突时改历史文档」+ `docs/devlog/2026-09-06-session-supreme.md:3` vs `docs/PRODUCT_SPEC.md:3`「本文件为仓库唯一产品真相源」 | 两条优先级规则并存。建议：PRODUCT_SPEC 管产品规则，会话决定要么写回 PRODUCT_SPEC 要么标注为历史，不要再留一条「会话高于一切」的通用规则 |

## 三、同一份规则写在多处（去重清单）

| 规则 | 出现位置 | 建议归属 |
|---|---|---|
| Golden Path 五步流程 | `PRODUCT_SPEC.md:41-46`、`README.md:12-17`、`ROADMAP.md:11-39` | 只留 PRODUCT_SPEC，其余改为单向引用 |
| 实现层默认隐藏 | `PRODUCT_SPEC.md:53-55`、`README.md:20`、`CONTEXT.md:4`、`ROADMAP.md:5` | 只留 PRODUCT_SPEC |
| 验收标准三块 / evaluator | `AGENTS.md:7`、`METHODOLOGY.md:11,20` | 只留 METHODOLOGY，AGENTS 引用 |
| 机器全绿≠验收 | `AGENTS.md:12`、`METHODOLOGY.md:20,36,51` | 同上 |
| NOTES 纪律 | `AGENTS.md:9`、`METHODOLOGY.md:22` | 同上 |
| 现象即信号 | `AGENTS.md:6`、`METHODOLOGY.md:26,73` | 同上 |
| 唯一发布入口 ops.sh | `README.md:78`、`PRODUCT_RELEASE_GATE.md:7`、`DEPLOYMENT_CHECKLIST.md:27` | 只留 RELEASE_GATE |
| 类型闸 / 拆题工单 | `PRODUCT_SPEC.md:113,127-146`、`CONTEXT.md:13` | 只留 PRODUCT_SPEC，CONTEXT 改「见 §四」 |
| 证据语义五词 | `PRODUCT_SPEC.md:55`、`ROADMAP.md:5`、`README.md:14` | 只留 PRODUCT_SPEC |

## 四、另一类：已废止的用户可见文案仍留在代码里

`mvp/src/lib/uiLang.ts:132` 的旧壳词表里仍有：

```ts
outcome: "告诉你这条说法是否可靠，问题在哪里，来源能点开。",
```

`README.md` 明确写过「撤『告诉你能信还是不能信』」，`docs/PRODUCT_SPEC.md` 第七节记「（2026-08-13）按赛题原文收回定位…废止「先别转发 / 转不转」作为产品语言」。这句在 Golden Path 里已不存在（`rg '是否可靠' mvp/src/goldenPath/` 无命中），但旧三栏壳 `/?legacy=1` 仍会显示它。改它要连 `mvp/src/legacy/LegacyDesk.test.tsx:541` 的断言一起改。

**本次未改**：旧壳不是默认路径（只在 `?legacy=1` 可达），改动涉及测试断言，属产品文案裁决，留人裁。
