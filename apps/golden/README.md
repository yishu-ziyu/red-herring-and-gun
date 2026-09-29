# golden：行为保持重写的表征测试

同一份外部世界录音驱动**真实服务端进程**（以及真实前端 `<App/>`），把用户与客户端能观察到的输出全部记下来。
重写前在基线代码上跑一遍得到基线，重写后在新代码上再跑，逐项比对。场景清单与覆盖见 `docs/golden-scenarios.md`。

## 组成

| 文件 | 作用 |
|---|---|
| `tape.mjs` | 以 `--import` 预加载进服务端进程的网络录音/回放层。不改生产代码。 |
| `harness.ts` | 起独立服务进程（独立数据目录、cwd、HOME、TMPDIR），跑场景，采集 HTTP、SSE、SQLite、落盘文件、外部请求清单，归一化。 |
| `normalize.ts` | 归一化规则：时间、今天的日期、ID、令牌按首次出现编号；对象键排序；过程帧按多重集合。 |
| `scenarios.ts` | 场景。请求体用生产前端的同一批函数构造。 |
| `golden.ts` | CLI：`list` / `record` / `replay` / `compare`。 |
| `ui.golden.test.tsx` | 界面 golden：把录下的 SSE 帧逐帧喂给真实 `<App/>`，每帧序列化 DOM。默认跳过。 |
| `fixtures/water-notice.png` | 截图场景用的合成图（不含第三方内容）。 |

录音与运行结果都在 `outputs/golden/`（git 忽略）：录音含提示词与第三方网页摘要，不进仓库。

## 用法（在 `apps/` 下）

```bash
TSX=server/node_modules/.bin/tsx
$TSX golden/golden.ts list
$TSX golden/golden.ts record g01-mixed g02-debunk --jobs 3   # 真实联网：会调用 apps/.env.local 里配置的模型与检索
$TSX golden/golden.ts replay base                               # 回放全部有录音的场景，结果标签 base
$TSX golden/golden.ts replay base2 && $TSX golden/golden.ts compare base base2   # 确定性自检
# 改代码后
$TSX golden/golden.ts replay after && $TSX golden/golden.ts compare base after

# 切片期间的模块级差分（影子运行，见 docs/rewrite-plan.md）：服务进程拿到 RHG_DIFF_DIR/<场景>，比对结果写在那里
RHG_DIFF_DIR=$PWD/../outputs/golden/capture/<切片> $TSX golden/golden.ts replay <标签>

GOLDEN_UI=record  GOLDEN_FRAMES=base GOLDEN_UI_LABEL=ui-base npx vitest run golden/ui.golden.test.tsx
GOLDEN_UI=compare GOLDEN_FRAMES=base GOLDEN_UI_LABEL=ui-after GOLDEN_UI_BASE=ui-base npx vitest run golden/ui.golden.test.tsx
```

## 录音层会怎样失败（先列，再写）

与 `rhg-fix` 工作区未提交的 `netTape.ts` 同一目录布局与环境变量名。在它列出的八条之外，这里另外处理：

1. **提示词带当前时刻**（状态栏 `time=YYYY-MM-DD HH:MM:SS`）→ 今天的日期与时刻换成占位符再算指纹，隔天也能回放。其他日期原样参与指纹。
2. **360 检索地址带随机 `sid`** → 指纹前去掉。
3. **密钥写在请求体里**（Tavily `api_key`）→ 进程里所有密钥值在指纹与落盘前换成 `<secret:名字>`；回放用假密钥，指纹仍对得上。
4. **录制时网络出错或调用方读到一半放弃** → 录成错误或「正文中止」，回放时按同一方式失败，不变成 503。
5. **请求被扣住（hold）时调用方中止** → 按中止处理，和真实 fetch 一样。
6. **开发机状态渗入**：服务进程的 HOME 指向场景目录（不读 `~/.claude/settings.json`），cwd 指向场景目录（`.agent-memory` 不读写开发目录），邮件变量清空（不发真实邮件）；本机存在 `/usr/local/bin/codex` 时拒绝运行（provider 链可能落到本地 codex）。
7. **进程级全局状态**（provider 跳过表等）→ 每个场景一个新进程；同一场景内的多次调查按固定顺序进行。
8. **真实运行按剩余时间做取舍**（补查、质询、要不要写报告），外部回复瞬间到达的回放会走另一支 → 虚拟时钟：回放时把 `Date.now()` 拨到「请求发出时刻 + 录下的耗时（到正文读完）」。`RHG_NET_VCLOCK=0` 关掉，作为第二种回放变体。

回放时对不上的请求记为 `miss` 并按供应商 503 处理；`miss` 数量写进结果，比对时是外部请求清单的一部分。
