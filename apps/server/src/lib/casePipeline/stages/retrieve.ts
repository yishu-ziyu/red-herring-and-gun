/**
 * 阶段 2 检索：逐命题检索（+ 截图以图搜图）。记忆层先查库：命中且新鲜的命题用知识库证据替换联网检索（不占 6 个名额），
 * 同一案追问的已核命题沿用上一轮证据。命中的命题各落一条活动行。
 */
import { retrieveForAtoms, type AtomSearchBundle } from "../../atomSearch.js";
import { claimAtomKey } from "../../claimAtom/index.js";
import { priorRoundLookupOf } from "../../followUpReuse.js";
import type { ImageOriginResult } from "../../imageOrigin/index.js";
import type { PipelineContext } from "../caseState.js";
import type { PipelineStep } from "../runCasePipeline.js";

export type Retrieval = {
  atomSearchBundle: AtomSearchBundle;
  search360Result: unknown;
  imageOrigin?: ImageOriginResult;
};

export async function retrieve(ctx: PipelineContext, rumorStep: PipelineStep): Promise<Retrieval> {
  const { input, hooks, reusePlan, snapshots } = ctx;
  const searchedAtoms: string[] = [];
  const { atomSearchBundle, search360Result } = await retrieveForAtoms({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    priorityClaimAtoms: rumorStep.output.priorityClaimAtoms,
    onPlan: (scopePlan) => { snapshots.setScopePlan(scopePlan); },
    searchOne: input.searchOne,
    claimAtomKeyFn: claimAtomKey,
    lookupImageOrigin: input.lookupImageOrigin,
    knowledge: input.knowledgeBase
      ? {
          lookup: input.knowledgeBase.lookup,
          onInjected: (hit) => {
            try {
              input.knowledgeBase?.markInjected(hit.atom, hit.originDate);
            } catch (error) {
              console.error("[casePipeline] 知识库注入记录失败", error);
            }
            hooks?.onKnowledgeHit?.(hit);
          },
        }
      : undefined,
    priorRound: reusePlan
      ? {
          lookup: priorRoundLookupOf(reusePlan),
          onInjected: (hit) => hooks?.onPriorRoundReuse?.(hit),
        }
      : undefined,
    hooks: {
      mode: hooks?.searchMode ?? "parallel",
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
  const imageOrigin = atomSearchBundle.imageOrigin;
  // 里程碑：检索返回——来源此时只能是 unassessed（尚未核查）。
  snapshots.investigating({
    claimAtoms: rumorStep.output.claimAtoms,
    claimAtomTypes: rumorStep.output.claimAtomTypes,
    atomSearchBundle,
  });
  return { atomSearchBundle, search360Result, imageOrigin };
}
