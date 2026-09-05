# MCP 启动排查

## Change

排查并修复用户报告的 brilliant、cloudflare-api、creative_production_mcp、flomo 启动失败；分别记录来源、失败原因、处理与复测。

## Not this

不以停用或删除用户仍需的服务冒充修复；不打印或保存访问令牌。不把 mcp list 中 enabled 当成握手通过。不修改本项目产品代码。

## Evaluator

- 本地 Brilliant 恢复监听并完成 MCP initialize / tools/list，或明确记录其实际阻塞。
- Flomo 完成认证后由 Codex 建立 MCP 连接；若 OAuth 必须用户操作，保留待完成状态，不能称修复完成。
- 另外两个名称定位到实际配置/插件或启动日志，按对应错误修复并复测；仅因当前配置没有条目不能认为已解决。
- 所有相关配置变更有备份并通过解析；无关服务和产品改动保留。

## 结果

2026-09-05：四项实际 MCP initialize / tools/list 检查通过。

| 服务 | 现场原因 | 处理 | 复测 |
| --- | --- | --- | --- |
| brilliant | 本地 Brilliant 未运行，127.0.0.1:3333 无监听 | 启动已安装的 Brilliant.app | 直接 HTTP 握手及 Codex app-server 均返回 17 个工具 |
| cloudflare-api | 插件 OAuth 需重新授权；旧日志显示缺少授权服务器 issuer | 用户完成 codex mcp login 授权 | 新 Codex app-server 返回 serverInfo、3 个工具、oAuth |
| creative_production_mcp | 0.1.25 安装缺失 skills/produce/helpers/moodboards/assets/mood-board-app/index.html；node 以 ENOENT 退出 | codex plugin add creative-production@openai-curated-remote 重装同版本，恢复缺失文件 | 直接 stdio initialize 成功，返回 creative-production 0.1.25 与 1 个工具 |
| flomo | Codex 显示未登录，旧日志为授权元数据缺失 | 用户完成 codex mcp login flomo 授权 | 新 Codex app-server 返回 flomo-mcp 1.0.0、13 个工具、oAuth |

验证细节：Cloudflare 来源为远程插件 .mcp.json；本地 CLI 不自动合并该远程插件，所以 app-server 检查使用同名、同 URL 的单次配置覆盖，没有新增持久重复配置。Creative Production 的 stdio 检查使用插件原命令及原 cwd。工具数量是实际服务响应，未调用业务写入工具。

边界：当前桌面会话已有的启动失败记录不能回溯清除；尚未在新的桌面会话中检查警告是否消失。Brilliant 必须保持运行；本次没有添加开机自启。没有修改本项目产品代码，无需运行产品测试或构建。全局 config.toml 解析通过，原复合工程插件仍停用。此次操作为应用启动、OAuth 更新与官方同版本插件重装，无手工持久配置编辑，也未记录访问令牌。


## 用户后续决定：卸载 Creative Production

Change：用户明确要求删除 Creative Production。

Not this：不只停用；不删除其他设计插件或用户素材。

Evaluator：官方卸载成功，安装列表和插件缓存不再含目标，全局 MCP 无独立残留；其他插件安装状态保持不变。

结果：官方 CLI 卸载成功。安装列表无目标、目标缓存目录不存在、全局配置无独立 MCP 残留；其他插件的安装、启用与版本状态和卸载前一致。当前会话旧工具目录可能保留到新会话，未强制重启 Codex。
