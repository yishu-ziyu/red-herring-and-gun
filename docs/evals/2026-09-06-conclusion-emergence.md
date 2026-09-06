# 验收标准：[Reset 4D] Conclusion Emergence 生产化

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#64。Parent：#53。Depends on：#61（已关闭）。分支：`feat/reset-4d-conclusion-emergence`。

对照 Will's S Design Note（工作区确认：`yishuziyu@gmail.com` / **Will's S Design Note**）：

- **第一视觉层级**：`directAnswer` 用字号/字重/主墨水领先；kicker、judgment、来源数、时间靠弱化次要内容让出（Refactoring UI *Emphasize by de-emphasizing*、*Labels are a last resort*、*Separate visual hierarchy from document hierarchy*）。
- **形成而不庆祝**：动效只解释 investigating → complete 的状态切换与空间连续性，短、可关、不劫持注意（NNGroup *The Role of Animation and Motion in UX*；Apple *Motion*：目的性、可选、简短）。
- **不抢焦点**：完成时不 `focus()`、不 `scrollIntoView()`；调查中结论区是空容器而不是误导性「无记录」空状态（NNGroup *Designing Empty States*：不要先报无内容再换成真内容）。

---

## Change

生产 Golden Path 在 **investigating → complete** 全程保持同一个结论区域 DOM 节点。调查中该容器不占明显空间、不把未来答案预渲染给读屏；完成后同一容器进入可见态，`directAnswer` 作为文稿 lede 从已有证据上方形成。原始说法、命题、证据仍在同一画布且不 remount。不弹出结果卡、不换页、不播放庆祝/打字机。不抢焦点、不自动滚动、不无故关闭正在阅读的 Evidence / Source Drawer。

用户必须能观察到：

1. 调查进行中已有 `[data-gp-conclusion-region]`，但看不到、读不到结论正文。
2. 完成后 `document.querySelector('[data-gp-conclusion-region]')` 的 **对象引用** 与完成前相同（`before === after`）。
3. 完成态第一眼是对原句的直接回答，而不是「调查完成」kicker、judgment chip、0–100 分或来源计数。
4. unresolved 用句子写出「证据还不够」，不是只靠徽章。
5. boundaries 是认识论边界（中性发丝线 / 次级墨水），不是 warning alert。
6. 正在看某条证据或 Drawer 打开时，complete 不把阅读位置/焦点/抽屉拆掉。
7. `prefers-reduced-motion: reduce` 下 directAnswer 立即可读，不依赖透明度动画。

---

## Not this

- 把 `ConclusionHero` 仍写成 `{complete ? <Hero/> : null}` 挂在画布根上，完成时才插入新节点。
- 用 `display:none` 藏一个节点再换成另一个节点，冒充动画。
- 调查中把未来 `directAnswer` 放进 DOM（即使 `hidden` / `opacity:0`）给读屏预读。
- 结果卡、全屏过渡、confetti、typewriter、streaming cursor、字符飞入、巨大 success banner、先藏 500ms 再展示、自动滚到页顶。
- 用 judgment chip / 「调查完成」盖过 directAnswer。
- 黄底、⚠️、橙色警报边框、`role="alert"` / `role="warning"` 表达 boundary。
- 实现 #62 Claim Trace、#63 Evidence Settling 身份重写、#65 Source Drawer 内容重写。
- 真实 SSE investigating → complete 作为本 Issue 的最终证据（留给 #66）。本 Issue 用生产组件 + DEV fixture。
- 新动画库。只允许现有 `framer-motion`。
- 改 `ops.sh`、删 `mvp/`。

---

## Evaluator

### 机器项（全绿才交付）

- [x] **E1（验收契约先于实现）**：本文件存在，含 Change / Not this / Evaluator。
  - 命令：`test -f docs/evals/2026-09-06-conclusion-emergence.md`

- [x] **E2（11 项组件行为，含真实 node 引用）**：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`
  必须覆盖 Issue #64 第 7 节 11 项：
  1. investigating 时 persistent region 存在，结论不可读/不可访问（无 `[data-gp-direct-answer]`，region `aria-hidden`，不包含未来答案文本）。
  2. complete 后 **同一** region 节点：`before === after`（`toBe`，不是只比 selector 字符串）。
  3. directAnswer 在结论区内且位于 judgment/meta 之前；可见文案不是以「调查完成」抢第一层。
  4. conclusion 不替换 page shell：`.gp-canvas` 与 `.gp-original` 引用不变。
  5. original claim / `[data-gp-claim-id]` DOM 仍是同一节点。
  6. unresolved 文案直接出现「证据还不够」（或等价完整句子），不只靠 `data-gp-judgment`。
  7. boundary 容器没有 `role="alert"` / `role="warning"`，文案不含 ⚠️。
  8. complete 不调用 `HTMLElement.focus`（spy）。
  9. complete 不调用 `scrollIntoView`（spy）。
  10. Drawer 打开时 complete 不卸载该 drawer 节点。
  11. `prefers-reduced-motion: reduce` 下 complete 后 directAnswer 立即在 DOM 中可读。

- [x] **E3（源码护栏）**：`ConclusionHero` / `InvestigationCanvas` 不含 `scrollIntoView`、`autoFocus`、`role="alert"`（结论区）、`⚠️`；`golden-path.css` 结论区不用黄底/橙色警报边框；存在 `--gp-motion-emerge` 且时长在 260–420ms。
  - 命令：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`（源码扫描用例）

- [x] **E4（生产截图与 Motion 取证，fixture，非真实 SSE）**：`python3 scripts/capture_conclusion_emergence.py`
  产出在 `docs/design/2026-09-06-conclusion-emergence/`：
  - Desktop 1440：`conclusion-investigating.png`、`conclusion-complete.png`
  - Mobile 390：`conclusion-mobile-complete.png`
  - Motion：`conclusion-emergence.gif` 或 `.webm`/`.mp4`，加连续帧目录
  - reduced-motion 对照：`conclusion-reduced-motion-complete.png`（及帧或短片）
  - Vite 仅用端口 **5184**。不改 `scripts/capture_mode3_production.py`。

- [x] **E5（根测试）**：`npm test` — core 578 / eval 85 / server 21 / web 83 = 767 通过
- [x] **E6（根构建）**：`npm run build` 通过
- [x] **E7（生产壳全量）**：`cd mvp && npm test` **920 通过 / 1 跳过**；`cd mvp && npm run build` 通过

### 人评项（等人裁）

- [ ] **H1**：完成态去掉颜色后，directAnswer 仍是第一层；judgment / 计数 / 时间明显更弱。
- [ ] **H2**：emergence 看起来像文稿让出空间，不像系统宣布胜利。时长体感约 260–420ms。
- [ ] **H3**：调查中结论区几乎不占位置；完成后原说法与证据还在刚才那一页。
- [ ] **H4**：真实 SSE 路径的同一节点与取证留给 #66，不在本 PR 关闭。
