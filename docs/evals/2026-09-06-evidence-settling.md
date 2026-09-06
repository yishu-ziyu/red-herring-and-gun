# 验收标准：[Reset 4C] Evidence Settling 生产化（同一证据从待核对平滑归位）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#63。Parent：#53。Depends：#61（PR #67 已合入 `main`）。分支：`feat/reset-4c-evidence-settling`。

设计判断对照 Will's S Design Note（工作区 `Will's S Design Note`，`yishuziyu@gmail.com`）：

- **Creating Usability with Motion**：Object Continuity / Transformation——同一对象改位置与状态，不是另造一个对象再淡入。
- **The Role of Animation and Motion in UX**：动效解释状态切换与空间位置，短、克制；fade 不能说明「这条材料被重新归类」。
- **Apple Motion / Accessibility**：动效应是可选的；`prefers-reduced-motion` 下语义立刻完整，不把动画当成唯一通道。

---

## Change

把 Mode 3 的核心 Motion **Evidence Settling** 落入生产 Golden Path：同一 Claim 下同一条证据从「待核对」归到「支持 / 反驳 / 相关材料」时，用户看到的是**同一条材料被重新归类**。

可观察结果：

1. 角色从 `unassessed` 变为 `support` / `contradict` / `context-only` 时，真实 DOM 节点保持 `before === after`（不是只匹配 `data-source-id` 字符串）。
2. 证据行始终是每个命题下一个稳定父容器的 keyed children；分组标题用文字（待核对 / 支持 / 反驳 / 相关材料）加 CSS `order` 穿插，不把行搬到新的父节点。
3. 归位是 layout / transform（`--gp-motion-layout` 280ms，落在 260–360ms），不是 opacity 消失再出现，不 stagger 整表。
4. Quiet Editorial：白/近白行、发丝线、小圆点与文字标签；无支持绿底、无反驳红底、无 card-on-card。
5. `prefers-reduced-motion` 下角色与分组立刻正确，无大幅位移，焦点不丢。
6. 点击仍打开现有 Source Drawer；展开中的命题、焦点中的证据、标题与摘录在 rerender 后仍在。

---

## Not this

- 不把旧行卸载、新行挂到另一个 group 父节点上，再用 fade / shared-layout clone 伪装连续。
- 不用数组 index 作为跨状态身份核心。
- 不实现 Claim Trace（#62）、Conclusion Emergence（#64）、Source Drawer 重写（#65）。
- 不改 Investigation Snapshot / SSE / 后端。本轮取证使用生产组件 + 确定性 fixture，**不等于真实 SSE**（留给 #66）。
- 不新增动画库（只用已有 `framer-motion ^12.40.0`）。
- 不把 `context-only` 画成支持，不把 `unassessed` 计入最终支持/反驳。

---

## Evaluator

### 机器项（全绿才交付）

- [x] **E1（验收文档先于实现）**：本文件含 Change / Not this / Evaluator；断言真实节点引用。
  - 验证：本文件存在且含 `before === after`。
- [x] **E2（DOM 身份：unassessed → support）**：rerender 后 `querySelector('[data-gp-claim-id] [data-source-id]')` 的节点引用严格相等。
  - 验证：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`（34 通过）
- [x] **E3（DOM 身份：unassessed → contradict）**：同上，`before === after`。
- [x] **E4（DOM 身份：unassessed → context-only）**：同上，`before === after`。
- [x] **E5（role 标签与 data 属性）**：`data-gp-role` 与可见文字（支持 / 反驳 / 待核对 / 相关材料）随 snapshot 更新。
- [x] **E6（context-only 不是 support）**：`context-only` 行的 `data-gp-role` 不是 `support`，分组标题是「相关材料」。
- [x] **E7（分组计数）**：各 `data-gp-group-role` 计数等于该 role 的实际行数。
- [x] **E8（空分组隐藏）**：某 role 行数为 0 时，对应 `data-gp-group-role` 不在 DOM。
- [x] **E9（点击下钻）**：点击证据行仍打开 Source Drawer（现有 API，不重写 Drawer）。
- [x] **E10（焦点连续）**：focus 中的证据按钮在 role 更新后仍是同一节点且 `document.activeElement` 仍是它。
- [x] **E11（reduced-motion）**：`useReducedMotion` / `prefers-reduced-motion` 下角色立刻更新，`data-gp-layout-motion="off"`，不做大幅 translate。
- [x] **E12（打断的 snapshot）**：interrupted 帧保留已存在证据，不把它伪造成最终支持/反驳。
- [x] **E13（身份 key）**：生产源码不以 `` `${sourceId}-${i}` `` 作为 Evidence 的 React key；稳定键为 `${claimId}:${sourceId}`（同源重复时 `${claimId}:${sourceId}#n`）。
- [x] **E14（测试与构建）**：
  - `npm test`：core 578 / eval 85 / server 21 / web 83 = 767 通过
  - `npm run build`：通过
  - `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：34 通过
  - `cd mvp && npm test`：925 通过 / 1 跳过
  - `cd mvp && npm run build`：通过
- [x] **E15（取证脚本）**：`python3 scripts/capture_evidence_settling.py` 在端口 **5182** 跑生产 Golden Path；写出 before/after 与 motion 证据；脚本与 README 写明 **fixture ≠ 真实 SSE**。真实浏览器 `before === after`；非 reduce 采样到 layout translate，reduce 下 moving=0。

### 人评项

- [ ] **H1**：运动看起来像「同一条材料归位」，不是闪一下换行。
- [ ] **H2**：去掉颜色后，待核对 / 支持 / 反驳 / 相关材料仍能靠文字与位置区分。
- [ ] **H3**：大量行同时变角色时，优先可读，不要全体飞行。

---

## Evidence

- 测试：`mvp/src/goldenPath/goldenPath.test.tsx` 用节点引用比较，不只比 attribute。
- 截图与运动：`docs/design/2026-09-06-evidence-settling/`（生产组件 + `/?fixture=settling` 确定性回放）。**不是真实 SSE。**
