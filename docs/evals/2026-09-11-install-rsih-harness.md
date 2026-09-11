# 2026-09-11 安装 RSIH Harness（CosmosMind-ai/RSI-Harness）

来源：https://github.com/CosmosMind-ai/RSI-Harness
锁定 commit：`33c4f8dfac4359987f2e814e187de67c332498de`（2026-09-10）
前置审计：`/tmp/rsih-audit/RSI-Harness`（shallow clone，只有 1 个 commit，历史不可审）

## Change

用户级安装，全部在 home 目录，不碰项目仓库：

| 路径 | 内容 |
| --- | --- |
| `~/tools/RSI-Harness` | 源码 checkout |
| `~/.local/bin/rsih`、`~/.local/bin/gee` | 可执行入口 |
| `~/.local/lib/rsih` | copy 模式的二进制载荷 |
| `~/.rsih` | RSIH 自己的配置目录（genomes、settings） |

审计事实：源码中唯一的 `fetch` 是 `src/model/model-runtime.ts` 调模型 API（默认 `http://127.0.0.1` 本地代理）；无遥测、无上传。extension 只注册三个工具：`scan_workspaces`、`choose_workspaces`、`AskUserQuestion`。

## Not this

- 不修改 `~/.pi` 下任何文件（settings.json / auth.json / sessions / skills / mcp.json）。
- 不修改 `红鲱鱼与枪` 仓库任何已存在文件。
- 不自动读取会话历史：`harness-rsi` 这个 Genome 会读 `~/.pi/agent/sessions`（224M）和 `~/.claude/projects`（41M），但必须先在对话框里被授权选源。
- 不提供 MetaRSI 论文里的 Data-RSI / Model-RSI。仓库只有 harness 层。
- 不接管 `pi`：全局 pi 仍是 0.85.1，RSIH 内部自带 0.84.3，互不影响。

## Evaluator

| # | 检查 | 命令 | 期望 |
| --- | --- | --- | --- |
| E1 | 装了且能跑 | `rsih --version` | 输出非空版本号，exit 0 |
| E2 | 自带 Genome 完好 | `rsih genome validate paperlab` | exit 0 |
| E3 | `~/.pi` 未被改 | 安装前后对 `~/.pi` 顶层文件 + 目录树做 diff | 无差异 |
| E4 | 配置目录隔离 | 跑一次 bare `rsih`，看新建的目录 | 建的是 `~/.rsih`，`~/.pi` mtime 不变 |
| E5 | 可卸载 | 删除四个路径后 `command -v rsih`、`pi --version` | rsih 消失，pi 照常 0.85.1 |
| E6 | 人评 | `rsih :harness-rsi` 走一遍造 Genome 流程 | 是否真的产出可用的 Genome |
| E7 | 未验证 | 论文侧：MetaRSI 三层架构、机构署名、Sina 报道 | 本次不核，与安装无关 |

E6 需要用户实际用一次才能判；E7 明确留空，不假装核过。

## 结果（2026-09-11，当日装当日卸）

E1–E5 全部通过，实际测量值：

| # | 实测 |
| --- | --- |
| E1 | `rsih --version` → `0.1.0`，`gee --version` 同 |
| E2 | `paperlab is valid (4 components, 0 managed settings)` |
| E3 | `~/.pi` 目录树 diff 为空，`agent/*.json` mtime 全部早于安装时刻 |
| E4 | 它建的是 `~/.rsih`（184K），不是 `~/.pi` |
| E5 | 五个路径删净，`rsih`/`gee` 消失，`pi` 仍 0.85.1，`~/.pi` 完整；释放约 428M |

卸载时一处更正：`~/tools` 是用户原有目录（内有 `gstack`、`ponytail`），不是本次安装创建的，只删了 `~/tools/RSI-Harness` 一层。首次守卫误判并停机，是守卫值正确而非 bug。

E6 未评（用户判定暂时无用，未跑 `harness-rsi` 造 Genome 流程）。E7 始终未核。

## 留档：拆解结论（与是否安装无关）

真东西五条：补丁词表 + 可收窄能力集（`genome.ts:61` `AGENT_HARNESS_PATCH_OPERATIONS`）；血统与内容寻址身份（`genome.ts:1008`，`genome_id = hash(parent, patch)`）；托管键与归还语义（`settings-layer.ts`，`$rsih.managedKeys`）；种子三方对账（`genome-loader.ts:100-160`，`current/stale/modified/shadowed` 四个边界）；契约即 schema + 漂移测试。

借自 Pi 的：配置目录隔离是 Pi 原生的（`piConfig?.configDir || ".pi"`），npm/git 可分发 bundle 是 Pi packages 本来就有的。

名不副实处：全仓无 `fitness|score|benchmark|evaluate`，**没有选择回路**，选择压力全靠人点确认；`assertHarnessComplexity` 只有定义与导出（`genome.ts:1049`、`index.ts:21`），**零调用点**，复杂度预算（`max_active_chars` 32000 等）写了不执行；所谓 Level 2/3 不存在，`harness-rsi` 自身升级走发行版重装，是人在改。

四个可迁移的做法已记录到 NOTES，不依赖 RSIH 本体。
