# #79 实现测量说明

冻结契约：`docs/evals/2026-09-08-shannon-conjunction.md`。实现最多两次根因修复，均使用同一 Shannon 测试。

1. `implement-attempt-1/`：修复 derive 将 unknown 过滤后剩余 true 当全真、partial 仅反证被当真侧、bind 重置 related-only、缺判词未知边界。17 项中 15 通过、2 失败：related-only 仍在上游 merge 丢失标记。原始日志及失败 Snapshot 保留。该 shell 末尾 tail 遮盖 Vitest 退出码，收据明确记录退出码未捕获，不以 shell 0 宣称通过。
2. `implement-attempt-2/`：沿上游 merge 保留相关性标记，并将其传给分桶和方向 guard；同步 core 镜像。17 项全部通过。A 真 + B 未知为 unverified/unresolved；A 假 + B 未知维持 false/refuted 但 B unresolved；单条与双条有据真维持 supported；引用绑定仍指向 A 的真实合成 URL。

实际执行均为本地 synthetic 管线或机器检查，收费模型调用 0。未执行 LIVE 或 eval:gate。独立 Validator 的旧测试更正与候选复验独立记录，未修改冻结 Shannon 测试。

正向补查仍使用新 fact_checker 判词，不继承旧对象的 related-only 标记；既有 Audit 回归用例验证新 URL 进入方向 relation、recheckCommitted=true、重新评估关闭 gap 后可恢复证据支持的强度。仅重复绑定旧的显式相关材料不能使其升级为支持。

保留原有混合聚合语义：有据之真和有据之假仍返回 partial；本轮没有实现自然语言逻辑分类器。

初次全量 mvp 的缺依赖套件错误与 server tsc 错误保留。原因是临时 worktree 缺少 mvp/server/node_modules；补到现有 canonical server 依赖的 symlink 后四套件 21 项、server tsc 通过，没有下载或改变依赖版本。

最终验证：根测试 605+85+21+83=794，通过；根 build、mvp build、server tsc 通过。mvp 最后全量启动时 Validator 仍在完成 Case4 测量器校正，结果 1101 通过、1 失败、1 跳过（97 套件通过、1 失败、1 跳过）。最后编辑完成后仅重跑该 Audit 套件，28/28 通过；原全量 exit 1 如实保留，不能宣称该命令 exit 0。独立 Validator 3 套件61项当前全绿，对旧 HEAD 同版测量器11失败50通过。所有当前测试项的最终结果通过，保留1项既有跳过；人评与 LIVE/eval:gate 未完成。

生产文件：`atomSearch.ts`、`claimAtom/merge.ts` 及 core 字节镜像、`assembleFinalReport.ts`、`conclusionGate.ts`。没有修改 UI、Snapshot schema 或 Audit 实现；没有合并或关闭 Issue。风险边界：本地 synthetic 管线证明确定性出口语义，不证明 LIVE 模型与真实用户视觉验收。

## 稳定最终全量及当前 main 对照

Validator 完成所有测量校正后，主会话另跑一次完整 mvp：1101 过、LegacyDesk 1 失败、1 跳过（exit 1）。当前 main 同环境完整 mvp：1007 过、同错误签名 1 失败、1 跳过；main/candidate 单跑该套件均 29 过。此前 Audit 测量失败已经消失，本次独立保留 LegacyDesk 全量门失败，不通过修改代码/skip/重复挑选成功消除。MACHINE_GATE_NOT_MET，具名阻塞待人工裁决；不宣称全量通过。原始日志和hash见 final-mvp-comparison.json。
