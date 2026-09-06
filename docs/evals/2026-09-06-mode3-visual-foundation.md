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

### 机器项（全绿才交付）

- [x] **E1（Design Spec 存在且完整）**：`docs/design/2026-09-06-mode3-production-spec.md` 存在且包含全部 22 项规定章节。
  - 验证命令：`node -e 'const fs=require("fs"); const c=fs.readFileSync("docs/design/2026-09-06-mode3-production-spec.md","utf8"); const reqs=["type scale","weights","line height","spacing scale","content width","canvas surface","content surface","chrome surface","primary / secondary ink","hairline","focus ring","accent","semantic micro-accent","radius","elevation","feedback motion","UI motion","layout motion","reduced-motion","1440","390","blacklist"]; for(const r of reqs){ if(!c.toLowerCase().includes(r.toLowerCase())) throw new Error("Missing spec item: "+r); } console.log("E1 PASS");'`
  - 结果：`E1 PASS`
- [x] **E2（无废弃的大面积语义背景 Token）**：`mvp/src/goldenPath/golden-path.css` 中不得再定义或使用 `--gp-positive-bg`、`--gp-negative-bg`、`--gp-mixed-bg`。
  - 验证命令：`node -e 'const fs=require("fs"); const c=fs.readFileSync("mvp/src/goldenPath/golden-path.css","utf8"); if(/--gp-(positive|negative|mixed)-bg/.test(c)) throw new Error("Found deprecated semantic bg tokens"); console.log("E2 PASS");'`
  - 结果：`E2 PASS`
- [x] **E3（无 Card-on-card 嵌套）**：`mvp/src/goldenPath/InputStage.tsx` 与 CSS 不得再产生多重实体卡片边框套叠。
  - 验证命令：`node -e 'const fs=require("fs"); const c=fs.readFileSync("mvp/src/goldenPath/golden-path.css","utf8"); if(/gp-input-card[\s\S]*?box-shadow[\s\S]*?gp-input-card/.test(c)) throw new Error("Found card-on-card"); console.log("E3 PASS");'`
  - 结果：`E3 PASS`（`.gp-input-card [class*="frame"]` 彻底剥离实体边框与阴影，保持单一功能 Surface）
- [x] **E4（Motion Tokens 与 Reduced Motion 齐备）**：`golden-path.css` 中包含标准 motion 变量且有 `@media (prefers-reduced-motion: reduce)` 规则。
  - 验证命令：`node -e 'const fs=require("fs"); const c=fs.readFileSync("mvp/src/goldenPath/golden-path.css","utf8"); if(!c.includes("prefers-reduced-motion")) throw new Error("Missing reduced motion rule"); if(!c.includes("--gp-ease-out")) throw new Error("Missing ease-out token"); console.log("E4 PASS");'`
  - 结果：`E4 PASS`
- [x] **E5（真实生产截图落盘且完整）**：`docs/design/2026-09-06-mode3-production/` 下包含 5 张必要截图。
  - 路径：
    - `desktop-input.png` (77,240 字节)
    - `desktop-investigating-shell.png` (123,160 字节)
    - `desktop-input-grayscale.png` (37,038 字节)
    - `mobile-input.png` (59,798 字节)
    - `mobile-input-grayscale.png` (29,867 字节)
  - 验证命令：`node -e 'const fs=require("fs"); const dir="docs/design/2026-09-06-mode3-production/"; const files=["desktop-input.png","desktop-investigating-shell.png","desktop-input-grayscale.png","mobile-input.png","mobile-input-grayscale.png"]; for(const f of files){ if(!fs.existsSync(dir+f)) throw new Error("Missing screenshot: "+f); } console.log("E5 PASS");'`
  - 结果：`E5 PASS`
- [x] **E6（根测试全绿）**：`npm test` 578 core / 85 eval / 21 server / 83 web = 767 项通过。
  - 验证命令：`npm test`
  - 结果：79 测试套件全绿，767 测试通过，0 失败。
- [x] **E7（根构建全绿）**：`npm run build` 成功通过。
  - 验证命令：`npm run build`
  - 结果：core、server、web、eval 构建全成功。
- [x] **E8（生产壳 Golden Path 测试全绿）**：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx` 成功通过。
  - 验证命令：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`
  - 结果：19 测试全通过（包含 Mode 3 视觉基础断言与 InputStage 单层 surface 断言）。
- [x] **E9（生产壳测试套件全绿）**：`cd mvp && npm test` 910 通过 / 1 跳过。
  - 验证命令：`cd mvp && npm test`
  - 结果：95 passed, 1 skipped (910 passed, 0 failed).

### 人评项（待人工裁决）

- [ ] **H1（去色灰度审查 Grayscale Gate）**：
  - 在完全去色（100% Grayscale）后：
    - Headline 是否仍清楚？（走查结果：墨黑大字 750 字重配微下划线，对比分明）
    - Input 是否仍清楚？（走查结果：发丝边框与克制投影，边界与输入行极其清晰）
    - Primary action 是否仍明确？（走查结果：圆环加号与向上箭头图标，无色差也能立刻定位）
    - Warning/error 是否仍能理解（不纯靠色彩差异）？（走查结果：带 `!` 标志徽章与明确文案，脱离红蓝色彩依然明确）
    - Chrome 与 Content 是否仍有清晰层级？（走查结果：顶部发丝分割线与背景微明度差形成清晰层次）
- [ ] **H2（Quiet Editorial 气质审查）**：
  - 是否像一份被认真编辑的调查文稿，而非 SaaS Dashboard / AI Chat 模板；
  - 是否消除了彩色边框+彩色背景的大面积色块（调查正文零彩色大色块）；
  - 示例、链接、操作是否安静、克制、低摩擦。
- [ ] **H3（响应式与触控布局 Responsive Gate）**：
  - 1440px / 768px / 390px 无横向滚动溢出；
  - 移动端输入区域与按钮触控目标符合易用性要求（≥44px）。
