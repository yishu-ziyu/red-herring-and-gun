/** 按本轮问题检索；上一轮材料不替代本轮证据。 */
import { retrieveForAtoms, type AtomSearchBundle } from "../../atomSearch.js";
import type { PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";

export type Retrieval = {
  atomSearchBundle: AtomSearchBundle;
  search360Result: unknown;
};

export async function retrieve(ctx: PipelineContext, rumorStep: PipelineStep): Promise<Retrieval> {
  const { input, hooks, snapshots } = ctx;
  const searchedAtoms: string[] = [];
  const { atomSearchBundle, search360Result } = await retrieveForAtoms({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    priorityClaimAtoms: rumorStep.output.priorityClaimAtoms,
    onPlan: (scopePlan) => { snapshots.setScopePlan(scopePlan); },
    searchOne: input.searchOne,
    hooks: {
      onAtomStart: (atom) => {
        // 里程碑：单个原子检索开始（声明该命题进入 searching；来源未返回不预填）。
        searchedAtoms.push(atom);
        snapshots.investigating({
          claimAtoms: rumorStep.output.claimAtoms,
          claimAtomTypes: rumorStep.output.claimAtomTypes,
          atomSearchBundle: { atomsSearched: [...searchedAtoms], byAtomKey: {} },
        });
        hooks?.onAtomSearchStart?.(atom);
      },
      onAtomResult: hooks?.onAtomSearchResult,
    },
  });
  if (input.recorder) {
    for (const [claimKey, sources] of Object.entries(atomSearchBundle.byAtomKey)) {
      for (const source of sources) {
        source.materialId = input.recorder.recordMaterial({
          url: source.url, kind: "search-snippet", content: source.snippet,
          metadata: { claimKey, title: source.title, retrievedAt: source.retrievedAt, fetchStatus: source.fetchStatus },
        });
      }
    }
  }
  // 里程碑：检索返回——来源此时只能是 unassessed（尚未核查）。
  snapshots.investigating({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
  });
  return { atomSearchBundle, search360Result };
}
