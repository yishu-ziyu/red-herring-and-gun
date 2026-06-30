# gun.yishuziyu.cn 部署故障复盘

日期：2026-06-15

## 最终结论

这次问题不是单一 DNS 配置错误，而是四个问题叠在一起：

1. `gun.yishuziyu.cn` 最初走 Vercel，国内直连出现 `ERR_CONNECTION_CLOSED`。
2. 本机 `/etc/hosts` 曾写死 `76.76.21.21 gun.yishuziyu.cn`，覆盖了真实 DNS。
3. 本机代理启用了 fake-ip，导致 `dig` 返回 `198.18.x.x`，这不是公网 IP。
4. 阿里云服务器可以承接域名，但 Nginx 最初把 `/` 代理到后端 Express，导致首页 `Cannot GET /`；后续已改为静态前端 + `/api/` 代理。

最终稳定方案：

- DNS：`gun A 121.89.90.68`
- Nginx：`/opt/red-herring/dist` 服务前端静态文件
- Nginx：`/api/` 和 `/health` 代理到 `127.0.0.1:3000`
- 本机 hosts 临时兜底：`121.89.90.68 gun.yishuziyu.cn`

## 为什么绕了很久

之前的判断过度依赖单一路径的结果：

- `dig` 在本机不可靠，因为会被 `/etc/hosts`、系统缓存、代理 fake-ip 影响。
- `curl https://gun.yishuziyu.cn` 在本机不可靠，因为系统代理和 Apple curl/TLS 行为会影响结果。
- Vercel DoH 验证只能说明 Vercel 解析正确，不能说明国内用户直连稳定。
- 只看阿里云 DNS 控制台不能发现本机 hosts 覆盖和代理 fake-ip。

以后遇到类似问题，必须先分层验证，不允许直接猜。

## 标准排障顺序

### 1. 查公共 DNS

```bash
curl --noproxy '*' -sS \
  'https://dns.alidns.com/resolve?name=gun.yishuziyu.cn&type=A'
curl --noproxy '*' -sS \
  'https://dns.google/resolve?name=gun.yishuziyu.cn&type=A'
```

可信结果应为：

```text
121.89.90.68
```

### 2. 查本机覆盖

```bash
grep -n 'gun\.yishuziyu\.cn\|yishuziyu' /etc/hosts || true
dscacheutil -q host -a name gun.yishuziyu.cn
dig +short gun.yishuziyu.cn
```

判断规则：

- `76.76.21.21`：旧 hosts 或旧缓存。
- `198.18.x.x`：代理 fake-ip，不是公网解析。
- `121.89.90.68`：本机解析正确。

### 3. 查代理接管

```bash
scutil --proxy
lsof -nP -iTCP:7897 2>/dev/null | sed -n '1,80p'
```

如果看到 HTTP/HTTPS/SOCKS 都指向 `127.0.0.1:7897`，说明浏览器路径会受代理软件影响。

### 4. 绕过本机 DNS 验证服务器承接

```bash
./ops.sh aliyun-domain
```

成功标准：

```text
aliyun domain https  HTTP/1.1 200 OK
aliyun domain health HTTP/1.1 200 OK
aliyun domain models HTTP/1.1 200 OK
```

### 5. 验证 Agent 主链路

```bash
curl --noproxy '*' --resolve gun.yishuziyu.cn:443:121.89.90.68 \
  -sS -m 180 \
  -X POST https://gun.yishuziyu.cn/api/agent/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"claim":"隔夜菜会致癌是真的吗？","mode":"quick"}'
```

成功标准：

- `steps.length` 为 4。
- 返回 `finalReport`。
- 即使 ReportComposer fallback，也不能 502 或挂死。

## 当前修复记录

- 阿里云 DNS：`gun A 121.89.90.68`。
- 阿里云 Nginx：已切换为静态前端 + API 代理。
- 本机 `/etc/hosts`：已加入 `121.89.90.68 gun.yishuziyu.cn`。
- macOS 代理绕过列表：已加入 `gun.yishuziyu.cn` 和 `*.yishuziyu.cn`。
- `ops.sh public`：已加入公共 DoH 验证。
- `ops.sh aliyun-domain`：已加入阿里云承接验证。

## 静态资源事故

页面打开后 logo 裂图，是因为部署脚本打包时全局排除了 `*.png`，导致 `public/logo.png` 和 `public/agents/*.png` 没有进入服务器 `/opt/red-herring/dist`。

修复：

- `ops.sh` 不再全局排除 `*.png` / `*.jpg` / `*.jpeg`。
- 已补传 `/opt/red-herring/dist/logo.png` 和 `/opt/red-herring/dist/agents/*.png`。

以后不要用全局图片排除规则；如果要排除截图，只排除 `output/`、`screenshots/` 等明确目录。

## 以后不要做的事

- 不要看到 `dig` 返回异常就立刻改 DNS。
- 不要把 `198.18.x.x` 当成真实公网 IP。
- 不要在没查 `/etc/hosts` 前判断“云解析没生效”。
- 不要同时保留同一个主机记录的 CNAME 和 A。
- 不要为了减小部署包全局排除 `*.png`。
