# 验收标准：[Reset 4A] 生产视觉基础（Quiet Editorial tokens、Shell 与输入态）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#61。Parent Issue：#53。分支：`feat/reset-4a-visual-foundation`。

---

## Change

将 PR #60 已裁决并合入 main 的 **Mode 3 / Hybrid (Quiet Editorial Evidence)** 视觉语言正式落地到生产 `mvp/src/goldenPath/`，建立稳定、有限、可维护的视觉基础与生产 Design Spec，完成 Shell 与输入态的视觉收敛：

1. **Production Design Spec 先行落盘**：
   - 创建 `docs/design/2026-09-06-mode3-production-spec.md`；
   - 完整覆盖 22 项规范：Type scale、Weights、Line height、Spacing scale、Content width、Canvas surface、Content surface、Chrome surface、Primary / Secondary ink、Hairline、Focus ring、Accent、Semantic micro-accent、Radius 允许场景、Elevation 允许场景、Feedback motion、UI motion、Layout motion、Reduced-motion strategy、Desktop 1440 layout、Mobile 390 layout、Quiet Editorial visual smell blacklist。
2. **生产 Token 体系收敛与 Content/UI 分层**：
   - 确立两层分立架构：
     - **Content Layer**（正文、原始说法、Claim、Evidence、Gap、Conflict、Conclusion）：Paper-first，纯粹依靠排版字阶、字重、留白、发丝细线与极小微点（glyph/dot），彻底废除大面积语义背景大色块（`--gp-positive-bg`, `--gp-negative-bg`, `--gp-mixed-bg`）；
     - **UI Layer**（Topbar、Menu、Input 功能容器、Drawer、Popover）：允许极克制的圆角（radius）、极克制的阴影（elevation）与轻微毛玻璃材质（backdrop blur）；
   - 生产 CSS 变量统一为有限体系，零无序追加。
3. **ProductShell 轻量 Chrome 统一**：
   - Topbar 视觉后退，采用轻量半透明材质与发丝细线底边，内容与控制层分明；
   - 品牌区、操作按钮、账号与历史菜单符合 Quiet Editorial 气质，杜绝 SaaS 仪表盘感。
4. **InputStage 输入态视觉重塑**：
   - 保持“一个材料进去”的低摩擦主动作，不改变既有输入能力、链接抓取和配额状态机；
   - 消除 `gp-input-card` 与内部 `PromptInput` 形成的 card-on-card 嵌套；
   - 示例链接与标签告别大面积彩色 pill，改用安静的排版与次级墨水线框；
   - 错误与警告信息不只靠颜色，同时靠文字与语义图标传达。
5. **有限 Motion Token 基础**：
   - 建立 feedback fast (120–160ms)、UI open/close (220–280ms)、spatial/layout (260–360ms) 与 quick-out easing `cubic-bezier(0.16, 1, 0.3, 1)`；
   - 适配 `prefers-reduced-motion: reduce`，不依赖动效才能看到关键信息。
6. **真实生产走查截图矩阵与灰度门禁**：
   - 在真实生产代码环境（非原型）捕获 Desktop 1440px 与 Mobile 390px 截图；
   - 生成去色灰度图并执行 Grayscale Gate 审查；
   - 截图保存至 `docs/design/2026-09-06-mode3-production/`。

---

## Not this

- **不实现 #62 Claim Trace 交互机制**（由 #62 消费本 Issue 基础）；
- **不实现 #63 Evidence Settling 物理连续性动画**（由 #63 消费本 Issue 基础）；
- **不实现 #64 Conclusion Emergence 展开生成机制**（由 #64 消费本 Issue 基础）；
- **不实现 #65 Source Drawer 生产交互重构**（由 #65 消费本 Issue 基础）；
- **不改动数据契约**（`InvestigationSnapshotV1`、`InvestigationRun` 等契约零漂移）；
- **不改动后端管线与 SSE**（不碰 `runCasePipeline`、SSE handlers、provider 路由）；
- **不引入新依赖**（零新增 UI 组件库或动效库）；
- **不发明第四套设计方向**（严格以 PR #60 裁决的 Mode 3 / Hybrid 为唯一基准）；
- **完成后不自行开始 #62–#66**。

---

## Evaluator

以下是 **current truth** 唯一一套机器门禁。旧 grep E3、`[class*="frame"]`、19 tests、910 passed 均已作废，不再并列。

### 机器项（全绿才交付）

- [x] **E1（Design Spec 存在且完整）**：`docs/design/2026-09-06-mode3-production-spec.md` 包含全部 22 项规定章节，并区分 production CSS custom property 与 spec-only design scale。
  - 验证命令：`node -e 'const fs=require("fs"); const c=fs.readFileSync("docs/design/2026-09-06-mode3-production-spec.md","utf8"); const reqs=["type scale","weights","line height","spacing scale","content width","canvas surface","content surface","chrome surface","primary / secondary ink","hairline","focus ring","accent","semantic micro-accent","radius","elevation","feedback motion","UI motion","layout motion","reduced-motion","1440","390","blacklist","spec-only"]; for(const r of reqs){ if(!c.toLowerCase().includes(r.toLowerCase())) throw new Error("Missing spec item: "+r); } console.log("E1 PASS");'`
  - 结果：`E1 PASS`
- [x] **E2（无废弃的大面积语义背景 Token）**：`golden-path.css` 不得定义或使用 `--gp-positive-bg`、`--gp-negative-bg`、`--gp-mixed-bg`。
  - 验证命令：`node -e 'const fs=require("fs"); const c=fs.readFileSync("mvp/src/goldenPath/golden-path.css","utf8"); if(/--gp-(positive|negative|mixed)-bg/.test(c)) throw new Error("Found deprecated semantic bg tokens"); console.log("E2 PASS");'`
  - 结果：`E2 PASS`
- [x] **E3（嵌入 PromptInput 的真实 computed-style）**：Playwright 在 Desktop 1440 测量：外层 `.gp-input-card` 四边 1px + `--gp-elevation-input`；内层 `[data-prompt-frame]` `border-width=0`、`box-shadow=none`、背景 `rgba(0,0,0,0)`。源码不得再有 `[class*="frame"]` 劫持。
  - 验证命令：`python3 scripts/capture_mode3_production.py`（E3 段）；`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`
  - 结果：Playwright GATE PASS；goldenPath 23 通过；无 `[class*="frame"]`
- [x] **E4（Motion tokens 与 scoped reduced-motion）**：`:root` 有 `--gp-motion-fast` / `--gp-motion-ui` / `--gp-motion-layout` / `--gp-ease-out`；`prefers-reduced-motion` 与 `:focus-visible` 均以 `.gp-shell` 为前缀。Playwright 在 reduce 下：壳外探测节点 transition 仍为 1s，`.gp-input-card` 为 `1e-05s`。
  - 验证命令：`python3 scripts/capture_mode3_production.py`（E12 段）
  - 结果：`E4 PASS`
- [x] **E5（生产截图）**：`docs/design/2026-09-06-mode3-production/` 含输入态与调查壳截图，以及 conflict/gap fixture 图。
  - 路径：`desktop-input.png`、`desktop-input-grayscale.png`、`desktop-investigating-shell.png`、`mobile-input.png`、`mobile-input-grayscale.png`、`desktop-investigating-conflict-gap.png`
  - `desktop-investigating-conflict-gap.png` 是 production Golden Path + `/?fixture=conflict` 确定性 fixture，**不是真实 SSE**。
  - 验证命令：`node -e 'const fs=require("fs"); const dir="docs/design/2026-09-06-mode3-production/"; const files=["desktop-input.png","desktop-investigating-shell.png","desktop-input-grayscale.png","mobile-input.png","mobile-input-grayscale.png","desktop-investigating-conflict-gap.png"]; for(const f of files){ if(!fs.existsSync(dir+f)) throw new Error("Missing screenshot: "+f); } console.log("E5 PASS");'`
  - 结果：`E5 PASS`
- [x] **E6（根测试）**：`npm test` core 578 / eval 85 / server 21 / web 83 = 767 通过。
- [x] **E7（根构建）**：`npm run build` 通过。
- [x] **E8（Golden Path 测试）**：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx` **23 通过**（含 Quiet Editorial tokens、scoped CSS、`--prompt-frame-*` 嵌入契约、Content Layer 非卡片、mobile 44×44 源码合同）。
- [x] **E9（生产壳全量测试与构建）**：`cd mvp && npm test` **914 通过 / 1 跳过**；`cd mvp && npm run build` 通过。
- [x] **E10（Mobile 44px hit target）**：390 视口 add/send `boundingBox` 均为 44×44；`::before` 视觉圆 28×28；`scrollWidth=clientWidth=390`。
  - 验证命令：`python3 scripts/capture_mode3_production.py`
- [x] **E11（768 overflow）**：768 视口 `scrollWidth=clientWidth=768`；topbar / input / examples 不溢出；add/send 在视口内。不强制存 768 截图。
- [x] **E12（Content Layer 非卡片 + Spec token 诚实）**：`.gp-conflict` / `.gp-gaps` / `.gp-image-origin` computed 为透明底、radius 0、无全边框；Interrupted 可保留 `--gp-surface-inset`。Production Spec 里写成 production token 的 `--gp-*` 必须存在于 `golden-path.css :root`；`--gp-type-*` / `--gp-lh-*` / `--gp-space-*` / `--gp-chrome-*` 不得冒充 production token。

### 人评项（待人工裁决）

- [ ] **H1（去色灰度审查 Grayscale Gate）**：
  - Headline / Input / Primary action 去色后是否仍清楚；
  - Warning/error 是否不纯靠色彩；
  - Chrome 与 Content 是否仍有层级。
- [ ] **H2（Quiet Editorial 气质审查）**：
  - 是否像一份被认真编辑的调查文稿，而非 SaaS Dashboard / AI Chat 模板；
  - Conflict / Gap 截图是否没有变回浅灰 Card 堆；
  - 示例、链接、操作是否安静、克制、低摩擦。
- [ ] **H3（响应式与触控布局 Responsive Gate）**：
  - 1440px / 768px / 390px 无横向滚动溢出；
  - 移动端输入区域与按钮触控目标 ≥44px（机器项 E10/E11 已测；观感仍由人裁）。

### Evidence

- Playwright：`python3 scripts/capture_mode3_production.py` → `GATE PASS`
- `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：23 通过
- `npm test`：767 通过；`npm run build`：通过
- `cd mvp && npm test`：914 通过 / 1 跳过；`cd mvp && npm run build`：通过
- 截图目录 `docs/design/2026-09-06-mode3-production/`
- Token 事实源：`golden-path.css :root` 为 production CSS custom properties；字阶 / 行高 / 间距 / Topbar 毛玻璃为 spec-only 内联值

人评项 H1 / H2 / H3 仍待人工最终验收。不 merge。不开始 #62–#66。
