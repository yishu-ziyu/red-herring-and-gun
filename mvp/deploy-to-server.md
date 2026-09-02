# 云服务器部署

唯一发布入口（仓库根目录）：

```bash
./ops.sh deploy --yes
```

这会：本地测试并 `npm run build`，把含 `mvp/dist/` 的包传到服务器，重建 Docker，把前端写到 `/opt/red-herring/dist`，再套 host nginx。

不要跑 `deploy-to-aliyun.sh` 或 `mvp/deploy.sh`。它们会立刻失败并指向 `ops.sh`。
