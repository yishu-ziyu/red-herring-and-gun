# packages/core 是否同步生产壳 Shannon 两处修补

Date: 2026-09-15
来源：生产壳刚修 `repairGatedConclusion` 整句 unverified 第一句、`extractLeapAtoms` 保留「所以 / 因此」。查脊柱对应文件。

## Change

1. **有同一逻辑才补。** `packages/core` 若有 `repairGatedConclusion` 在整句 unverified 时用「站得住」当第一句，或有 `extractLeapAtoms` 剥掉「所以 / 因此」，做与生产壳相同的最小修补。
2. **没有对应文件或逻辑已不同则不拷。** 不把 `apps/server` 的 `conclusionGate.ts` / `textbookAtoms.ts` 硬搬进 `packages/core`。
3. **investigation 镜像未改。** 本次不碰 `packages/core/src/investigation` 与 `apps/server/src/lib/investigation` 的契约文件。

## Not this

- 不以「脊柱也该有」为由新建 `wholeClaimAudit` 或 `textbookAtoms`。
- 不改门禁、不改 `packages/eval`。
- 不把 `publicCopy.ts`、`stages/decompose.ts`、`text/claimAtom/merge.ts` 当成同一 bug 去改。

## Evaluator

1. `packages/core/src` 不存在 `text/claimAtom/textbookAtoms.ts`、`wholeClaimAudit/`、`conclusionGate.ts`。【命令】`test ! -e packages/core/src/text/claimAtom/textbookAtoms.ts && test ! -d packages/core/src/wholeClaimAudit && test ! -e packages/core/src/text/conclusionGate.ts`
2. `packages/core/src` 无 `extractLeapAtoms` / `repairGatedConclusion` / `applyConclusionGate` 实现（`merge.ts` / `citationBinding.ts` 仅注释提到 gate 名）。【命令】`rg -l "export function (extractLeapAtoms|repairGatedConclusion|applyConclusionGate)" packages/core/src` 空。
3. investigation 镜像仍字节一致：`cd packages/core && npx vitest run src/investigation/mirror.test.ts` 全绿。【命令】
