# 验收标准：[Reset 4B] Claim Trace 生产化：命题必须可回指原句

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#62。Parent Issue：#53。前置：#61 / PR #67。分支：`feat/reset-4b-claim-trace`。

对照原则（Will's S Design Note，工作区确认：`yishuziyu@gmail.com`）：
- **层级**：Refactoring UI *Not all elements are equal*；NNGroup *Visual Hierarchy*（颜色与对比建立层次，且不能只靠颜色）。同一时刻只强调原句里正在对照的那一截，编号仍标识命题。
- **焦点与悬停**：Material *States*（状态在组件间保持一致，且有两个视觉指示）；Apple *Focus and selection*（键盘焦点必须得到与悬停等价的 Trace 关系，而不是另一套效果）。
- **动效**：Apple *Motion*（简短精准、动效应是可选的）；NNGroup *The Role of Animation and Motion*（动效用于反馈，克制、短）；Material *Easing and duration*（小范围过渡用短时长）。生产用已有 `--gp-motion-fast: 140ms`（落在 Issue 要求的 120–180ms）。
- **无障碍**：Apple *Core Accessibility Principles*（不仅靠颜色区分；Reduced Motion 时内容仍在，不依赖动画才能看见 Trace）。

---

## Change

用户在生产 Golden Path 上必须能确认：**系统没有偷偷改题**。每一个用户可见 Claim，都能在原始说法里找到真实出处；找不到就明确不高亮。

可观察结果：

1. Claim Trace 只消费 `snapshot.originalClaim + claims[].originalSpan`，由纯函数 `buildClaimTraceSegments` 生成可渲染 segment（`text` / `claimId | null` / `traceable`）。
2. 合法 span：`originalClaim.slice(start, end)` 与预期短语逐字相等；Hover 或 keyboard focus 某个 Claim 标题时，原句对应短语出现极轻 accent/neutral tint + 细 underline；其他原文保持稳定；原句盒子宽高变化为 0px。
3. 缺失 span、越界、`start >= end`、空切片、与 `claim.text` 明显不一致且现有契约无法解释、无法确定性解释的重叠：不高亮、不猜测、不伪造第二套映射。
4. Keyboard focus 与 hover 得到同一套 Trace。移动端通过 focus / expanded-active 显示当前命题的 Trace，不增加「点一下只为高亮」的步骤，expand/collapse 仍可用。
5. 语义 `<mark>` 包住有文本的可回指片段；无合法 span 时不制造空 mark；原句仍可被线性读出；`prefers-reduced-motion` 下 Trace 内容仍在。

---

## Not this

- 不创建 `quoteTokens`、二次 phrase map、手写正则、模糊匹配或任何第二套事实源。
- 不把原文改写成 `claim.text`。
- 不做蓝色整块、marker-yellow、荧光笔大块，不发明第四套视觉体系，不新增 accent / radius / spacing 哲学。
- 不实现 Evidence Settling、Source Drawer 深改、Conclusion Emergence。
- 不改服务器拆题逻辑；若发现 producer/contract 歧义，只在 PR 描述报告，不扩 scope。
- 不改 `ops.sh`、不删 `mvp/`。
- 真实 SSE 端到端留给 #66。本 Issue 的截图与测试是生产组件 + 确定性 fixture。

---

## Evaluator

### 机器项（全绿才交付）

- [x] **E1（单一事实源与 fail-safe）**：`buildClaimTraceSegments` 只读 `originalClaim + originalSpan`。valid span 精确切出短语；missing / OOR / invalid / mismatch / 无法解释的 overlap → `traceable=false` 且不出现对应 `<mark>`。
  - 验证命令：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`
  - 结果：37 通过
- [x] **E2（真实中文 fixture 逐字相等）**：生产形态 Snapshot（`mixedComplete()`）上 `originalClaim.slice(start, end)` 与预期短语精确一致；连接全部 segment 文本后等于整句 `originalClaim`。
  - 验证命令：同上
- [x] **E3（Hover / Focus / 恢复 / 展开）**：Hover Claim 01 只激活 Claim 01 短语；keyboard focus 同样激活；blur / mouseleave 恢复；expand/collapse 不回归。不是 grep。
  - 验证命令：同上（Testing Library 真实事件）
- [x] **E3b（pointer / keyboard 仲裁，PR #68 Review blocker）**：当前真实交互对象决定 Trace。`hoverClaimId ?? focusClaimId ?? expandedTraceClaimId`；keyboard focus 开始时清掉陈旧 hover。
  1. click/focus Claim 01 → mouseEnter Claim 02 → 只激活 Claim 02（Claim 01 仍保持 focus）
  2. mouseLeave Claim 02 → Claim 01 仍 focus → 恢复 Claim 01
  3. 先前 hover Claim 02 → keyboard focus Claim 01 → 激活 Claim 01
  - jsdom：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx` → **37 通过**
  - 浏览器（第 1 条为硬门，2/3 同脚本）：`python3 scripts/capture_claim_trace.py` → **GATE PASS**；click 后 hover Claim 02 只激活 claim-2，且 focus 仍在 claim-1
- [x] **E4（无第二套映射）**：`mvp/src/goldenPath/` 生产源码（测试除外）不出现 `quoteTokens`、phrase map、按命题文本正则改写原句。
  - 验证命令：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`（源码合同测试）
- [x] **E5（生产截图与 0px 位移）**：`python3 scripts/capture_claim_trace.py` 从生产 Golden Path 捕获 Desktop 1440 / Mobile 390，并测量 hover 前后 `.gp-original-quote` 宽高变化为 0px。
  - 路径：`docs/design/2026-09-06-claim-trace/claim-trace-idle.png`、`claim-trace-claim-01.png`、`claim-trace-claim-02.png`、`claim-trace-no-span.png`、`claim-trace-mobile-focus.png`
  - 结果：GATE PASS；hover 原句宽高 724×27.21875 → 724×27.21875（0px）
- [x] **E6（根测试）**：`npm test` core 578 / eval 85 / server 21 / web 83 = 767 通过
- [x] **E7（根构建）**：`npm run build` 通过
- [x] **E8（生产壳测试与构建）**：`cd mvp && npm test` 928 通过 / 1 跳过；`cd mvp && npm run build` 通过

### 人评项

- [ ] 人评：Quiet Editorial 成立——极轻 tint + 细 underline，不是大面积彩色高亮；去掉颜色后仍能靠编号与结构认出对应关系。
- [ ] 人评：Desktop hover 与 keyboard focus 观感等价；Mobile 不增加额外交互摩擦。
- [ ] 人评：原句在高亮时不跳、不挤行；截图来自生产 Golden Path 而非 PR #60 原型。

---

## Evidence

- 纯函数：`mvp/src/goldenPath/claimTrace.ts`
- 测试：`mvp/src/goldenPath/goldenPath.test.tsx`（覆盖 Issue 列出的 10 项）
- 截图：`docs/design/2026-09-06-claim-trace/`
- 捕获脚本：`scripts/capture_claim_trace.py`（Vite 端口 **5181**）
- 本文件是完成尺度；测试绿但用户路径没通，改 evaluator，不改口说完成。
