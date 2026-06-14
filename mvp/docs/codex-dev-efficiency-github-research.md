# Codex 开发效率 GitHub 调研

日期：2026-05-29

## 调研目标

从 GitHub 上的 coding-agent 项目、官方文档和公开 issue 中提炼可直接提高本地 Codex 开发效率的做法，重点关注：

- 如何减少重复读项目、重复解释规则和重复确认。
- 如何让 agent 更快找到正确文件、命令和验证路径。
- 如何在不牺牲安全性的前提下提高自治度。
- 如何把大任务拆成可并行、可验证、可恢复的工作流。

## 主要来源

| 来源 | 相关发现 |
| --- | --- |
| GitHub Copilot coding agent best practices | 仓库指令应明确 build、test、validate、结构和约定；能自己构建/测试的 agent 更容易产出可快速合并的 PR。 |
| agentmd/agent.md | 通用 agent 指令文件应覆盖项目结构、构建/测试命令、代码风格、架构模式、测试和安全；支持根目录与子目录分层。 |
| openai/codex | Codex 是本地终端 coding agent；其自身仓库强调 repo 指令、精确测试命令和变更后验证。 |
| openai/codex issue #7138 | 大型 AGENTS.md 可能被截断；规则文件不能无限堆，应拆分、压缩和放到最相关路径。 |
| Aider | repo map、lint/test 命令、自动把失败反馈回编辑循环、`--subtree-only` 等做法适合大仓库节省上下文。 |
| Cline | `.clinerules`、skills、MCP、长任务输出监控、多 agent teams 和任务板体现了“规则化 + 工具化 + 并行化”的方向。 |
| Cline issue #1338 | MCP 信息会占系统 prompt；应按任务启用工具，保持提示词和工具说明瘦身。 |
| OpenHands | microagents 支持公共/仓库级、 always-loaded / trigger-loaded 两种模式；适合沉淀重复任务专家。 |

参考链接：

- https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results
- https://github.com/agentmd/agent.md
- https://github.com/openai/codex
- https://github.com/openai/codex/issues/7138
- https://github.com/Aider-AI/aider
- https://github.com/Aider-AI/aider/blob/main/HISTORY.md
- https://github.com/cline/cline
- https://github.com/cline/cline/issues/1338
- https://github.com/OpenHands/OpenHands/blob/main/AGENTS.md

## 可采用的工作流改进

### 1. 把仓库入口做成机器可读的 onboarding

最高 ROI 不是“更聪明地猜”，而是让仓库告诉 agent：

- 入口文件、核心目录、数据流和当前任务面。
- 本地启动、类型检查、构建、测试、浏览器验收命令。
- 哪些目录是旧实现、降级路径、生成物或不要碰的区域。
- UI 改动、API 改动、数据模型改动分别要跑哪些检查。

落地建议：每个活跃项目保留短版 `AGENTS.md` 或同等文件，控制体积，超过约 20-30KB 的内容拆到子目录或专题文档。

### 2. 把上下文预算当作性能资源

GitHub 上的 agent 项目都在绕同一个问题：上下文太大时，agent 会慢、贵、容易忽略关键约束。

本地可执行规则：

- 先用 `rg` / `rg --files` / `git status --short` 建索引，再定向读文件。
- 对大仓库先限制当前子树，除非任务明确跨域。
- 把长期规则压缩成“决策规则 + 验证命令”，不要把完整历史都塞进 AGENTS。
- 对重复任务用 skills/microagents 触发式加载，而不是常驻加载。

### 3. 验证命令要成为工作流的一部分，而不是收尾仪式

Copilot、Aider、Cline 的共同点是：agent 不只是改文件，还要读取编译/测试/浏览器反馈并继续修。

本地可执行规则：

- 代码改动默认找到最近的验证命令：`npx tsc --noEmit`、`npm run build`、单测、lint、浏览器 console。
- UI 改动必须看真实页面，至少做：页面不空白、无框架 overlay、目标交互生效、console 干净。
- final 前只汇报 fresh verification，不引用上一轮旧结果。

### 4. 把重复任务沉淀为触发式 skill/microagent

OpenHands microagents 和 Cline skills 的共同价值：把“每次都要解释的领域流程”变成可触发的小模块。

适合沉淀的任务：

- React/Vite UI QA。
- 结果报告/证据图谱组件验收。
- GitHub issue/PR review。
- 论文/事实核查类 source audit。
- 本机权限、MCP、Codex 配置诊断。

不适合沉淀的任务：一次性产品决策、很小的文本修改、需要当前上下文强判断的架构取舍。

### 5. 并行 agent 只用于边界清楚的工作

Cline team、OpenHands SDK 和 GitHub custom agents 都支持专用 agent，但高效前提是边界清楚：

- 搜索/调研、实现、验证、代码审查可以并行。
- 同一个文件的核心实现不适合多 agent 同时改。
- 每个子任务要给“输入、允许改的文件、产出格式、验证标准”。
- 主 agent 负责集成和最终 verification，不直接相信 worker 的成功声明。

### 6. MCP 和工具要按任务瘦身

Cline issue #1338 的核心提醒是：MCP 说明会占 prompt，工具越多不等于效率越高。

本地可执行规则：

- 日常代码编辑：优先 shell + rg + apply_patch + 类型检查。
- localhost/UI：用 Browser/Chrome DevTools。
- 登录态网页：用真实浏览器控制工具。
- 长任务、多 agent trace、状态恢复：才启用更重的 orchestration。
- 不把所有 MCP 长说明常驻进上下文。

## 我后续应采用的默认行为

1. 开始任务先定位真实 workspace、读最近的 AGENTS/README/package scripts，而不是凭记忆开改。
2. 安全、可逆、workspace 内的操作直接执行；只有沙箱强制、破坏性、凭证、生产外部操作才停下来要确认。
3. 多步骤开发写入 `tasks/todo.md`，完成时把验证命令和浏览器证据写回 Review。
4. 复杂 UI 改动默认跑浏览器验收；看到 console warning/error 就先排查能否低成本消掉。
5. 对大任务主动拆分并行读取/搜索，但文件编辑由一个主线集成。
6. 不把规则文件无限加长；超过阈值时拆成子目录 AGENTS、skills 或 docs 专题。

## 可立即改进这个 MVP 项目的点

- 增加一个短 `AGENTS.md`，只写本项目入口、脚本、UI 验收、结果态/画布降级路径和不要碰的旧目录。
- 增加 `npm run check`，统一封装 `tsc` + `build`，减少每次猜命令。
- 把三态 redesign 的验收命令保留在 `tasks/todo.md`，后续 C/D/E 扩展继续追加 Review。
- 对 React Flow / 浏览器 QA 这种重复路径，沉淀成一个本项目局部 checklist。

