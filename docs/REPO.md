# 仓库怎么长

给全栈工程师看的地图。产品做什么见 `PRODUCT_SPEC.md`。进程怎么跑见 `ARCHITECTURE.md`。本文件只回答：**东西为什么在这里，改一处要顺着哪几层走。**

## 这叫什么

这是一个 **npm workspaces 单体仓库（monorepo）**，正在做 **绞杀式迁移（strangler fig）**。

- 单体仓库：一个 git 里放多个包，共用工具和领域代码，不是「一个文件夹一个 git」。
- 绞杀式迁移：新脊柱（`packages/`）在生产壳旁边长出来。生产壳目录是 `apps/`（由 `mvp/` 改名）。T20 才把发布切到 `packages/`。

标准软件工程里，成熟形态往往是：

```text
apps/          可发布的产品（网站、API）
packages/      被多个 app 共用的领域与工具
docs/          产品、架构、验收、设计
ops / scripts  发布与机械活
```

生产壳已经放在 `apps/`。T20 是切到 `packages/web` 与 `packages/server`，不是再改一次目录名。

## 全栈怎么读：跟着一次请求走

不要按「前端文件夹 / 后端文件夹」来记。按用户的一次调查穿过的层来记。

```text
脸（React）
  apps/src/goldenPath/          人看见的：输入、调查中、完成态、来源抽屉
    ↓ HTTP / SSE
  apps/server/src/handlers.ts   薄适配：收请求、推快照，不写判决
    ↓ 编排
  apps/server/src/lib/casePipeline/
                               拆题 → 检索 → 核查 → 收束
    ↓ 领域（规则必须只有一份）
  packages/core/               快照契约、公开文案、引用绑定、检索过滤
    生产侧镜像：apps/server/src/lib/investigation 等
    前端再导出：apps/src/lib/investigation
    ↓ 实现
  模型 / 搜索供应商            实现层，不上用户界面
    ↓ 发布
  ./ops.sh deploy --yes        Nginx 静态 + Express /api
```

改「用户看见的一句话」时，至少问这四层：

1. 模型为什么会写出这句？（prompt / 写作输入）
2. 报告清洗有没有拦住？（`publicCopy`）
3. 快照有没有把内部字段摊到脸上？（`investigation/build`）
4. 结果页还露不露？（`goldenPath`）

2026-09-11 的 S1 来源序号就是这样修的：检索压缩不再把 `S1` 喂给模型，提示禁止写序号，清洗剥掉残留，快照不把与结论重复的 finding 再挂一遍，结果页再剥一层。只改第 4 层会留下同一条路。

## 现在真正的目录

```text
apps/                     生产 app（脸 + HTTP + 编排）。本地 npm run dev 从这里起。
  src/goldenPath/         现行产品界面
  src/components/v3/      旧三栏壳，只走 /?legacy=1
  src/lib/                前端再导出领域契约，不要在这里另写一份判决
  server/src/             生产 Express、casePipeline、handlers
  server/eval/            生产侧评测入口

packages/                 脊柱（ADR-007）。根目录 npm test / npm run build 跑这里。
  core/                   领域：investigation、rules、search、text、llm、stages
  server/                 未来 HTTP。尚未接 ops.sh
  web/                    未来界面。尚未接 ops.sh
  eval/                   黄金集与门禁

docs/                     产品过程，不是运行时
  PRODUCT_SPEC.md         产品宪法
  ARCHITECTURE.md         运行时接线
  REPO.md                 本文件
  NOTES.md                当前状态（子任务做完就改头部）
  evals/                  验收契约：Change / Not this / Evaluator
  design/                 设计原件与对照
  adr/                    架构决策
  devlog/                 方向改变
  qa/                     质量取证

ops.sh                    唯一发布入口。打包 `apps/`
scripts/                  截图、QA、nginx
  retired/                退役部署脚本，不要从这里发布
CONTEXT.md                实现层词汇表（Agent、原子、管线），不是产品词
```

## 两份相同代码是怎么回事

`packages/core/src/investigation` 是契约源文件。生产 Express 打进 Docker 时不能依赖工作区包，所以 `apps/server/src/lib/investigation` 是**字节镜像**，`mirror.test.ts` 两侧互守。前端从 `apps/src/lib/investigation` 再导出。

改快照：core 与 apps/server 必须一起改，测镜像，再测黄金路径。只改一边，门禁会红，生产会和测试各活各的。

`publicCopy`、`searchProviders`、`citationBinding` 也有 core / apps/server 两份。有的已经漂移（FACE_WORDS 不完全相同）。新逻辑优先写进两边都会跑到的清洗函数，并加同一条回归。T20 之后镜像消失，只留 packages。

## 不要到这些地方找产品

| 路径 | 是什么 |
|------|--------|
| `packages/web`、`packages/server` | 脊柱预演，不是 gun.yishuziyu.cn |
| `tmp-apodex-study/`、`vendor/`、`Chinese_Rumor_Dataset/` | 本地资料，已 gitignore，不进 clone |
| `out/`、`exports/`、`outputs/` | 过程产物 / 路演，已 gitignore |

## 你怎么练全栈

每次动手前写 `docs/evals/YYYY-MM-DD-slug.md`。没有 Evaluator 的句子不算标准。

每次改用户能看见的东西，顺着请求走一遍四层，缺一层就补一层。不要在脸上打补丁、让管线继续制造同样的字。

子任务做完立刻改 `docs/NOTES.md` 头部。方向变了写 `docs/devlog/`，不要用 commit 复述代替。

机器项全绿才交付。测试绿但用户路径没通，改 evaluator，不改口说完成。
