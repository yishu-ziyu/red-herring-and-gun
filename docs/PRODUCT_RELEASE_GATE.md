# 产品级公开发布门禁

适用场景：任何要公开访问、对外分发、接入平台、给评委/用户/客户使用的产品。

这份清单的目的不是“部署成功”，而是确认真实用户能稳定进入、完整使用、遇到问题时能快速定位责任层。

## 1. 入口可达性

公开域名必须验证三条路径：

```bash
# 公共 DNS
curl --noproxy '*' -sS 'https://dns.alidns.com/resolve?name=<domain>&type=A'
curl --noproxy '*' -sS 'https://dns.google/resolve?name=<domain>&type=A'

# 本机解析
dig +short <domain>
dscacheutil -q host -a name <domain>

# 强制解析到目标服务器
curl --resolve <domain>:443:<target-ip> -I https://<domain>/
```

判断规则：

- 公共 DNS 正确，不代表本机正确。
- 本机 `dig` 可能被 `/etc/hosts`、代理 fake-ip、系统缓存影响。
- `198.18.x.x` 是代理 fake-ip，不是真实公网 IP。
- `/etc/hosts` 可以覆盖一切 DNS 结果，必须检查。

## 2. 国内外网络路径

如果目标用户在国内，不能默认 Vercel、Cloudflare、Netlify 等海外边缘网络可用。

必须分别验证：

- 国内直连网络。
- 全局代理网络。
- 服务器本机访问。
- 公共 DNS over HTTPS。

如果国内直连不稳定，优先选择：

- 国内云服务器直接承接域名。
- 国内 CDN。
- 备案和证书完整的 HTTPS 入口。

## 3. 前端静态资源完整性

首页 200 不代表前端完整。

必须验证：

```bash
curl -I https://<domain>/
curl -I https://<domain>/logo.png
curl -I https://<domain>/<main-js-or-css>
```

注意：

- 部署脚本不能全局排除 `*.png`、`*.jpg`、`*.svg`。
- 如果要排除截图，只排除 `output/`、`screenshots/` 等明确目录。
- favicon、logo、头像、字体、CSS、JS 都属于产品体验，不是可选项。

## 4. API 与后端链路

必须分层验证：

```bash
curl -I https://<domain>/health
curl https://<domain>/api/models/list
```

如果有长任务或 Agent 链路，必须做真实端到端请求：

```bash
curl -m 180 \
  -X POST https://<domain>/api/agent/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"claim":"隔夜菜会致癌是真的吗？","mode":"quick"}'
```

成功标准：

- 返回 HTTP 200。
- 业务字段完整。
- 失败时有 fallback 或明确错误，不允许 502、空白页、无限 loading。

## 5. 代理、缓存、hosts 排查

公开发布时如果“我自己打不开”，先查本机环境，不要马上改云端。

```bash
grep -n '<domain>' /etc/hosts || true
scutil --proxy
scutil --dns
dig +short <domain>
dscacheutil -q host -a name <domain>
```

常见误判：

- hosts 旧记录被当成 DNS 没生效。
- fake-ip 被当成真实公网 IP。
- 浏览器 socket 缓存被当成服务器故障。
- 本机代理失败被当成国内用户都失败。

## 6. 证书与 HTTPS

必须验证：

```bash
openssl s_client -connect <target-ip>:443 -servername <domain> </dev/null
```

检查点：

- 证书域名包含目标域名。
- 证书未过期。
- Nginx / Caddy / 网关确实监听 443。
- HTTP 是否正确跳转到 HTTPS。

## 7. 发布脚本门禁

发布脚本必须内置检查，而不是靠人记。

至少要有：

- `check`：本地测试、构建、类型检查。
- `remote`：服务器进程、Docker、端口、health。
- `public`：公共 DNS、域名 HTTPS、API。
- `domain-takeover` 或等价命令：强制解析到目标服务器验证域名承接。

每次上线后都要把结果写入 `tasks/todo.md` 或部署记录。

## 8. 模型与第三方服务

Agent 产品不能只验证页面。

必须确认：

- 模型 key 是否存在。
- 余额是否足够。
- 超时是否有 fallback。
- 供应商不可用时用户是否仍能拿到可解释结果。
- 日志里能看出是哪一个 provider 失败。

## 9. 发布前最终判定

只有同时满足以下条件，才算“可以公开分发”：

- 域名可从目标用户网络打开。
- 首页静态资源完整。
- API 健康检查通过。
- 核心业务路径端到端通过。
- 长任务不会无限挂起。
- 失败状态对用户可解释。
- 部署脚本能重复验证。
- 已记录当前架构、DNS、服务器、回滚方式。

## 10. 本次事故形成的原则

以后公开发布时，不允许只说“部署好了”。

必须说清楚：

- 用户从哪里访问。
- DNS 到哪里。
- 请求经过哪一层。
- 静态资源在哪里。
- API 在哪里。
- 长任务怎么超时和兜底。
- 国内直连是否验证过。
- 本机特殊环境是否排除过。
