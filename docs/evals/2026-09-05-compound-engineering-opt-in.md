# Compound Engineering 按需启用

## Change

用户进一步授权修改具体技能并采用渐进式披露。默认停用完整 Compound Engineering 插件，保留原安装；用两份本地维护的 ce-handoff、ce-compound 作为常驻入口。简介限定触发范围，入口指向相关模式，避免加载无关分支。

依赖检查修正了初步的少量入口候选：ce-compound 默认完整研究并可调用 ce-compound-refresh，ce-debug 和 ce-work 串联审查等流程；ce-handoff 恢复有额外确认步骤。本轮不拆分或重写这些流程，避免保留半套。

## Not this

不卸载文件、不改插件缓存，不禁用原生编码、测试或其他插件，不改产品代码和现有项目规则。不把目录下降说成执行性能改善。

## Evaluator

- `codex debug prompt-input` 默认目录不再包含 `compound-engineering:` 的 33 个条目；其余原有技能名称和数量不变。
- 新目录只增加两份本地 ce-handoff、ce-compound；其简介完整可见。所有相对引用存在，两份技能通过官方格式校验。
- 创建交接、从明确来源继续已授权工作、记录非显然经验、常规小修不写经验四个独立场景，用临时工作区验证实际产物和范围。创建不读取恢复分支；普通经验记录不自动展开 CE 格式或历史会话流程。
- 若需恢复原包，应通过持久配置或插件设置重新启用。单次 `-c` 覆盖在当前 debug 路径实测无效，不作为交付命令。
- `codex plugin list --json` 显示该插件 installed=true、enabled=false；33 份 SKILL.md 及全部依赖文件保持原哈希。
- Python tomllib 校验配置；手工配置变更仅该插件 enabled 布尔值。保留其他客户端同时写入的独立配置。备份、前后快照和恢复方法存于 `~/.codex/audits/2026-09-05-skills/compound-engineering/`。

## 结果

已完成。原包保持安装但默认停用，1089 个包文件哈希不变；两个本地技能及相对引用通过校验。新 CLI 目录由 55 项变为 24 项，其他 22 项的名称和简介不变，说明块减少 9,289 字符（53.6%）。

独立代理执行四项合成场景，协调者回读产物并核对结果：交接创建、指定来源继续修复、非显然经验记录、常规小修不记经验全部通过；只读取相应分支。证据位于 `~/.codex/audits/2026-09-05-skills/compound-engineering/RESULT.md` 及同目录 `behavior-evidence/`。

未测量隐式路由准确率、真实项目端到端性能和桌面新会话警告；不将字符减少解释为这些指标改善。单次 -c 配置覆盖实测未恢复插件，恢复原包需更改插件设置并停用两份本地版本。
