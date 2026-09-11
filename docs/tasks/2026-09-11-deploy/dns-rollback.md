# DNS 回滚记录 · gun.yishuziyu.cn

改动前（2026-09-11 05:40 实测，阿里云云解析控制台 yishuziyu.cn 解析设置）：

```
主机记录: gun
记录类型: CNAME
解析请求来源: 默认
记录值: ba0744552526ea06.vercel-dns-017.com
负载策略: 权重 1
TTL: 10 分钟
启用状态: 启用
创建时间: 2026年6月14日 23:43:09
最新更新时间: 2026年9月3日 00:27:10
```

公开 DNS 实测（改前）：

```
gun.yishuziyu.cn  CNAME  ba0744552526ea06.vercel-dns-017.com
                  A      64.29.17.65 / 216.198.79.1
```

## 回滚办法

在阿里云云解析控制台把 `gun` 记录改回上表即可（改回 CNAME 指向 `ba0744552526ea06.vercel-dns-017.com`）。
TTL 为 10 分钟，回滚生效时间以 TTL 为准。

## 本机注意

本机 `/etc/hosts` 第 10 行有 `121.89.90.68 gun.yishuziyu.cn`，会覆盖 DNS。
它让本机始终解析到阿里云，因此本机看不到公共 DNS 的真实指向。
排障时用 `dscacheutil -q host -a name gun.yishuziyu.cn` 或写 `--resolve` 强制指定 IP 对比。
