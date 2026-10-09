# 红鲱鱼与枪

可检查的信息调查工具。用户交进来一句说法、一张截图或一个链接，产品把说法拆成几截，分别找公开证据，告诉用户哪一截成立、哪一截有问题、哪一截还查不清，每个判断都能点开出处。

- 产品定义：`docs/PRODUCT.md`
- 产品和方向决定：`docs/DECISIONS.md`
- 给 AI 助手的工作规则：`AGENTS.md`

线上：`https://gun.yishuziyu.cn`。2026-10-09 起显示维护页，因为原服务器已到期，产品正在重做（#146）。

## 目录

- `apps/`：产品本身，前端和后端都在这里。只改这里。
- `packages/`：放弃的迁移计划留下的旧代码，不在线上运行，将在 #139 删除。
- `docs/`：`PRODUCT.md` 和 `DECISIONS.md` 描述现在；`history/`、`evals/`、`devlog/`、`adr/`、`design/`、`tasks/` 是历史记录，记录的是当时的情况，可能和现在的代码不一致。
- `ops.sh`：旧的发布脚本，发布目标是已到期的服务器，现在不能用（#146）。

## 在本机运行

```bash
cd apps
npm install
npm --prefix server install
cp .env.local.example .env.local   # 然后填入真实的模型和搜索密钥
npm run dev
```

打开 `http://127.0.0.1:5173/`。没有真实密钥时，页面能打开，但调查会失败。

注意：示例文件里还列着 #139 要删除的供应商（例如 DeepSeek、MiMo、AIPing）。#139 完成后会更新示例文件；在那之前，只需要填 MiniMax、阶跃和搜索引擎的密钥。

`.env.local` 不会提交到仓库。不要把密钥写进任何会提交的文件。

## 测试

本项目没有单元测试和集成测试，只有一个真实端到端测试：真实浏览器、真实后端、真实模型和搜索，走一遍用户的主路径。

```bash
cd apps
npm run dev    # 另开一个终端，保持运行
npm run e2e
```

一次大约 7 分钟，会产生模型和搜索费用。测试在后台运行，不弹出窗口；每次在 `out/e2e/<时间>/` 留下结果文件、截图和录屏 `run.webm`。测试运行期间不要改后端文件，因为开发服务器保存文件时会重启，正在进行的调查会被打断。

构建：

```bash
cd apps && npm run build
```

## 许可

MIT，见 `LICENSE`。
