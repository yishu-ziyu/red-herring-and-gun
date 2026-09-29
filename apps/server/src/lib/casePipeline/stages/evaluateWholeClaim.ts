/**
 * 阶段 7 整句审计评估（Issue #78 §7）：初轮核查完成后、报告前。
 * 回答「原句现在成立到哪里 / 最大缺口 / 下一步查什么」；LM 先验只能生成问题，不得成为 Evidence。
 * 最多 1 次 audit-driven 补查：只有能映射到真实 kept atom 的问题才补查（复用 searchOne + bundle 合并 + fact_checker 重判）；
 * 纯桥接缺口只记录。失败 / 超预算时保守沿用 Planning 缺口基线（fail-closed，Review 5128449568 Blocker 2）。
 */
import { bindAtomEvidenceToVerdicts, buildAtomSearchBundle } from "../../atomSearch.js";
import { claimAtomKey } from "../../claimAtom/index.js";
import { mergeSourcesIntoBundle } from "../../evidenceLoop/evidenceLoop.js";
import { applyClaimSourceRelationAudit } from "../../sourceRelationAudit.js";
import {
  resolveQuestionAtomKey,
  runWholeClaimEvaluation,
  type WholeClaimAuditQuestion,
} from "../../wholeClaimAudit/index.js";
import type { CaseState, PipelineContext } from "../caseState.js";

/** 每次 Audit 最多提出的高价值问题数（Issue #78 §8）。 */
const MAX_AUDIT_QUESTIONS = 3;

export async function evaluateWholeClaim(ctx: PipelineContext, state: CaseState): Promise<void> {
  const { input, claim, steps, audit, budget, snapshots } = ctx;
  const { runAgent, searchOne } = input;
  const { rumorStep, atomSearchBundle, search360Result } = state;
  const wholeClaimAudit = audit.run;
  const writeAuditConservativeArtifact = (status: "failed" | "skipped-budget") => {
    rumorStep.output.wholeClaimAudit = {
      supportedWhere: "",
      biggestGap: "",
      missingJustifications: audit.unresolvedGaps,
      model: wholeClaimAudit.model,
      reevaluated: false,
      recheckCommitted: false,
      evaluationStatus: status,
    };
  };
  if (audit.callModel && budget.hasComposerHeadroom()) {
    const keptAuditAtoms = Array.isArray(rumorStep.output.claimAtoms)
      ? (rumorStep.output.claimAtoms as string[])
      : [];
    const evaluation = await runWholeClaimEvaluation({
      claim,
      keptAtoms: keptAuditAtoms,
      claimAtomTypes: rumorStep.output.claimAtomTypes,
      subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
      missingJustificationsFromPlan: wholeClaimAudit.plan?.missingJustifications,
      callModel: audit.callModel,
    });
    if (!evaluation) {
      wholeClaimAudit.evaluationStatus = "failed";
      writeAuditConservativeArtifact("failed");
    }
    if (evaluation) {
      wholeClaimAudit.evaluation = evaluation.evaluation;
      wholeClaimAudit.model = wholeClaimAudit.model || evaluation.model;
      const keptKeys = new Set(keptAuditAtoms.map((a) => claimAtomKey(a)));
      const searchables = evaluation.evaluation.nextQuestions
        .map((q) => ({ question: q, atomKey: resolveQuestionAtomKey(q, keptAuditAtoms) }))
        .filter((row): row is { question: WholeClaimAuditQuestion; atomKey: string } =>
          Boolean(row.atomKey && keptKeys.has(row.atomKey))
        )
        .slice(0, MAX_AUDIT_QUESTIONS);
      const newSourcesByAtomKey: Record<string, number> = {};
      const addedUrlsByAtomKey: Record<string, string[]> = {};
      let recheckCommitted = false;
      let newlyBoundEvidenceUrlsByAtomKey: Record<string, string[]> = {};
      if (searchables.length > 0 && budget.hasComposerHeadroom()) {
        for (const { question, atomKey } of searchables) {
          if (budget.composerHeadroomUsedUp()) break;
          const query = (question.suggestedQuery || question.question).trim().slice(0, 160);
          let result: unknown;
          try {
            result = await searchOne(query);
          } catch {
            continue;
          }
          if ((result as { _source?: string } | null)?._source === "tool-error") continue;
          const found = buildAtomSearchBundle([{ atom: atomKey, result }], claimAtomKey);
          const beforeUrls = new Set(
            (atomSearchBundle.byAtomKey[atomKey] ?? []).map((s) => String(s.url ?? ""))
          );
          const before = (atomSearchBundle.byAtomKey[atomKey] ?? []).length;
          mergeSourcesIntoBundle(atomSearchBundle, atomKey, found.byAtomKey[atomKey] ?? [], claimAtomKey);
          const after = atomSearchBundle.byAtomKey[atomKey] ?? [];
          const gained = Math.max(0, after.length - before);
          if (gained > 0) {
            newSourcesByAtomKey[atomKey] = (newSourcesByAtomKey[atomKey] ?? 0) + gained;
            const added = after
              .map((s) => String(s.url ?? ""))
              .filter((u) => u && !beforeUrls.has(u));
            addedUrlsByAtomKey[atomKey] = [...(addedUrlsByAtomKey[atomKey] ?? []), ...added];
          }
        }
        // 拿到有效新证据才重判（同 evidence loop 纪律）；重判失败保留原判词。
        // 提交判定（Review 5128022550 Blocker 2）：只有重判成功返回合法目标 atom
        // 判词、经 bind 形成非 related-only 的 support/contradict relation、且实际
        // 引用了本次新 URL，才算 committed；否则第二次 Evaluation 无权关闭旧 gap。
        if (Object.keys(newSourcesByAtomKey).length > 0) {
          try {
            const rechecked = await runAgent("fact_checker", steps, search360Result, atomSearchBundle);
            const recheckedVerdicts = rechecked?.output?.subclaimVerdicts;
            if (!rechecked.error && rechecked.status !== "failed" && Array.isArray(recheckedVerdicts) && recheckedVerdicts.length > 0) {
              let audited = bindAtomEvidenceToVerdicts(
                recheckedVerdicts as Array<{ claimAtom: string; [key: string]: unknown }>,
                atomSearchBundle.byAtomKey,
                claimAtomKey
              );
              // New audit-driven sources have not been direction-checked yet. Refresh the
              // independent audit before they are allowed to close a whole-claim gap.
              try {
                const refreshedSource = await runAgent(
                  "source_validator",
                  [...steps, rechecked],
                  search360Result,
                  atomSearchBundle,
                );
                steps.push(refreshedSource);
                state.sourceStep = refreshedSource;
                state.sourceAudit.markAudited();
              } catch {
                // Fail closed below: missing audits strip directional use of the new URLs.
              }
              audited = applyClaimSourceRelationAudit(
                audited,
                state.sourceStep?.output?.claimSourceRelations,
                claimAtomKey,
              );
              rechecked.output.subclaimVerdicts = audited;
              const gainedKeys = Object.keys(newSourcesByAtomKey);
              const boundByKey: Record<string, string[]> = {};
              const committed = gainedKeys.every((atomKey) => {
                const verdict = (audited as Array<Record<string, unknown>>).find(
                  (v) => v && typeof v.claimAtom === "string" && claimAtomKey(v.claimAtom) === atomKey
                );
                if (!verdict || verdict.sourcesRelatedOnly === true) return false;
                const added = new Set(addedUrlsByAtomKey[atomKey] ?? []);
                const bucketUrls = [
                  ...(Array.isArray(verdict.supportingSources) ? verdict.supportingSources : []),
                  ...(Array.isArray(verdict.contradictingSources) ? verdict.contradictingSources : []),
                ].map((s) =>
                  s && typeof s === "object" ? String((s as { url?: unknown }).url ?? "") : ""
                );
                const referenced = [...new Set(bucketUrls.filter((u) => u && added.has(u)))];
                boundByKey[atomKey] = referenced;
                return referenced.length > 0;
              });
              if (committed) {
                recheckCommitted = true;
                newlyBoundEvidenceUrlsByAtomKey = boundByKey;
                steps.push(rechecked);
                state.factStep = rechecked;
              }
              // 未提交：保留原 factStep（旧判词），补查证据仍在 bundle，报告 / 溯源可见。
            }
          } catch {
            // 补查证据已入 bundle，报告 / 溯源仍可见。
          }
        }
      }
      // 结算（Review 5127740625 Blocker 3 + 5128022550 Blocker 2）：只有重判真正
      // 提交（新 URL 进 bind 后的非 related-only relation）时，才跑 bounded
      // re-evaluation 并以第二次 Evaluation 为准关闭旧 gap；否则保守沿用第一次。
      let finalSupportedWhere = evaluation.evaluation.supportedWhere;
      let finalBiggestGap = evaluation.evaluation.biggestGap;
      let reevaluated = false;
      if (recheckCommitted && budget.hasComposerHeadroom()) {
        const reevaluation = await runWholeClaimEvaluation({
          claim,
          keptAtoms: keptAuditAtoms,
          claimAtomTypes: rumorStep.output.claimAtomTypes,
          subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
          missingJustificationsFromPlan: wholeClaimAudit.plan?.missingJustifications,
          callModel: audit.callModel,
        });
        if (reevaluation) {
          wholeClaimAudit.reevaluation = reevaluation.evaluation;
          finalSupportedWhere = reevaluation.evaluation.supportedWhere;
          finalBiggestGap = reevaluation.evaluation.biggestGap;
          reevaluated = true;
          const unresolvedAfterReeval = new Set<string>();
          for (const q of reevaluation.evaluation.nextQuestions) unresolvedAfterReeval.add(q.question);
          for (const gap of reevaluation.evaluation.missingJustifications) unresolvedAfterReeval.add(gap);
          audit.unresolvedGaps = [...unresolvedAfterReeval];
        }
      }
      if (!reevaluated) {
        // 无 target 的桥接问题 + 补查没取得新来源的问题 + eval 缺口 → 未解决，
        // 交给收权门限制整句结论强度（§11）。
        const resolvedKeys = new Set(Object.keys(newSourcesByAtomKey));
        const unresolved = new Set<string>();
        for (const q of evaluation.evaluation.nextQuestions) {
          const atomKey = resolveQuestionAtomKey(q, keptAuditAtoms);
          if (!atomKey || !keptKeys.has(atomKey) || !resolvedKeys.has(atomKey)) unresolved.add(q.question);
        }
        for (const gap of evaluation.evaluation.missingJustifications) unresolved.add(gap);
        audit.unresolvedGaps = [...unresolved];
      }
      wholeClaimAudit.extraPass = {
        ran: searchables.length > 0,
        questionsSearched: searchables.length,
        newSourcesByAtomKey,
        unresolvedQuestions: audit.unresolvedGaps,
        reevaluated,
        recheckCommitted,
        newlyBoundEvidenceUrlsByAtomKey,
      };
      wholeClaimAudit.evaluationStatus = "completed";
      rumorStep.output.wholeClaimAudit = {
        supportedWhere: finalSupportedWhere,
        biggestGap: finalBiggestGap,
        missingJustifications: audit.unresolvedGaps,
        model: evaluation.model,
        reevaluated,
        recheckCommitted,
        evaluationStatus: "completed",
      };
      // 里程碑：audit 补查可能新增来源 / 翻转判词，快照同步一次。
      snapshots.judging({
        claimAtoms: rumorStep.output.claimAtoms,
        claimAtomTypes: rumorStep.output.claimAtomTypes,
        atomSearchBundle,
        subclaimVerdicts: state.factStep?.output?.subclaimVerdicts,
        sourceRelationAudits: state.sourceStep?.output?.claimSourceRelations,
      });
    }
  } else if (audit.callModel) {
    // 预算不足未启动 Evaluation：保守沿用 Planning 缺口基线，不留静默空档。
    wholeClaimAudit.evaluationStatus = "skipped-budget";
    writeAuditConservativeArtifact("skipped-budget");
  }
}
