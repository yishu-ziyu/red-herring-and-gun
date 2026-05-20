# Agent Reasoning Canvas v3

- [x] 确认项目目录、入口文件、数据层和文档位置。
- [x] 新增 reasoning canvas 数据模型与预置节点/边/trace。
- [x] 新增三栏 Canvas 工作台组件。
- [x] 将 App 入口切到 ReasoningWorkspace。
- [x] 重写样式为 Agent reasoning canvas 工作台。
- [x] 更新 MVP spec 和 demo script。
- [x] 运行 build 并做浏览器交互验证。

# User-directed Node Expansion v4

- [x] 拆包查看 Kimi 原型，确认其 Canvas / Trace / Inspector / Dock 结构。
- [x] 将自动展开改为前三层问题空间后暂停。
- [x] 在 Node Inspector 增加节点追问、能力选择和中控 LLM 调度入口。
- [x] 新增用户触发后的动态 Canvas 节点和边。
- [x] 调整节点尺寸和布局，避免用户发散分支重叠。
- [x] 更新 MVP spec 和 demo script。
- [x] 运行 build 和浏览器交互验证。

# Layered Canvas Design + Drag v5

- [x] 搜索并参考开源 DESIGN.md / Design System 规范，把本项目视觉规则沉淀为 `DESIGN.md`。
- [x] 将 `DESIGN.md` 扩展为 YAML tokens + Markdown rationale 的双层结构。
- [x] 将 Canvas 节点改为可拖拽，拖拽状态只覆盖前端布局，不污染原始 reasoning 数据。
- [x] 增加节点拖拽手势样式，避免拖拽时误选中文字或触发页面滚动。
- [x] 运行 build 并在 `http://127.0.0.1:4173/` 验证拖拽。

# Flowith-inspired Canvas Shell v6

- [x] 搜索 Flowith 公开产品叙事，确认其核心是 AI Canvas / Knowledge Garden / 多线程空间工作台。
- [x] 将主界面改成 Flowith-inspired shell：左侧工具 rail、顶部浮动 command bar、中央 Context Canvas、右侧 Context Inspector。
- [x] 在 Canvas 内增加 mode pills 和 selected-thread metadata，降低报告页感。
- [x] 更新 `DESIGN.md`，把 Flowith-inspired UX Direction 写入设计规范。
- [x] 运行 build 和浏览器视觉验收。

## Review

- Build: `npm run build` 通过。
- Browser QA: `http://127.0.0.1:4173/` 通过开始推理、逐步展开、点击因果节点、点击候选证据节点、底部改写检查。
- Visual QA: 最终阶段 17 个 Canvas 节点无 DOM 边界重叠，截图保存在 `/tmp/suzheng-agent-canvas-verified.png`。
- v4 Browser QA: 三层后暂停为“等待选择节点”；点击“替代解释”并选择“联网搜索”后，只在该节点附近新增“中控 LLM 调度 / Searcher 子 Agent / 新增候选证据”三类节点。
- v4 Visual QA: 用户发散后 13 个 Canvas 节点无 DOM 边界重叠，截图保存在 `/tmp/suzheng-user-directed-expansion-final-ok.png`。
- v5 Build: `npm run build` 通过。
- v5 Browser QA: 在 4173 页面展开到三层后，拖动“因果判断”节点，DOM 位置从 `left=681.17/top=750.84` 移动到 `left=850.90/top=838.00`；Inspector 仍显示该节点的因果证据不足说明。
- v6 Build: `npm run build` 通过。
- v6 Browser QA: 4173 页面出现左侧 rail、浮动 command bar、Context Canvas、mode pills、selected-thread metadata 和 Context Inspector；展开到三层后无横向溢出，拖动“因果判断”节点从 `left=758.97/top=761.05` 到 `left=898.70/top=827.86`，Inspector 仍显示因果证据不足。
