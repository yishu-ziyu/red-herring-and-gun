# Trace 分享边界

首跑、阴性、纠正三次原始收据保持原样，引用原执行路径 out/ 下的原始 artifact。仓库只分享派生的 `trace.redacted.zip`：删去 Cookie、Set-Cookie、Authorization、Proxy-Authorization headers 与 cookie jar；其余操作、网络目标和页面记录保留。派生 trace 不能冒称原始 hash 相同。

新的 qa:replay 在 .data/qa-private-traces/ 私有目录保存原始 trace（文件权限600），先脱敏再生成发布 artifact hash 与收据。旧快照、失败日志、截图和执行收据未改写。原始 trace 不进入 Git。此处理不替代全产品 privacy-isolation 行仍缺少的全面泄漏扫描。
