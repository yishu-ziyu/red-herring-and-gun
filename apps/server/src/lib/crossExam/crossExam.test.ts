import { expect, it, vi } from "vitest";
import { claimAtomKey } from "../claimAtom/index.js";
import type { AtomSearchBundle } from "../atomSearch.js";
import { findCrossExamTargets, makeSecondOpinionCall, runCrossExam } from "./crossExam.js";

const atom = "这项政策已生效";
const support = { url: "https://a.example/source", title: "支持", snippet: "支持原文" };
const contradict = { url: "https://b.example/source", title: "反驳", snippet: "反驳原文" };
const bundle = { byAtomKey: { [claimAtomKey(atom)]: [support, contradict] } } as AtomSearchBundle;

it("只有已绑定的双向冲突触发独立意见，单侧缺口不触发", () => {
  const single = findCrossExamTargets({ verdicts: [{ claimAtom: atom, verdict: "unverified", evidenceGaps: ["缺原文"], supportingSources: [support] }], bundle, claimAtomKeyFn: claimAtomKey });
  expect(single).toEqual([]);
  const conflict = findCrossExamTargets({ verdicts: [{ claimAtom: atom, verdict: "disputed", supportingSources: [support], contradictingSources: [contradict] }], bundle, claimAtomKeyFn: claimAtomKey });
  expect(conflict).toHaveLength(1);
});

it("只读质询保留问题，不搜索、不重判、不按分歧降分", async () => {
  const targets = findCrossExamTargets({ verdicts: [{ claimAtom: atom, verdict: "true", supportingSources: [support], contradictingSources: [contradict] }], bundle, claimAtomKeyFn: claimAtomKey });
  const raw = vi.fn(async () => ({ model: "second", output: { verdict: "false", reason: "来源冲突", challenge: "以哪份原文为准？", query: "政策生效 原文", sources: [support.url, "javascript:bad()"] } }));
  const result = await runCrossExam({ claim: atom, targets, callSecondOpinion: makeSecondOpinionCall(raw) });
  expect(raw).toHaveBeenCalledTimes(1);
  expect(result.confidenceAdjustment).toBe(0);
  expect(result.atoms[0]).toMatchObject({ relation: "disagree", query: "政策生效 原文", searchStatus: "not_run", status: "unresolved" });
  expect(result.atoms[0]?.sources?.map((source) => source.url)).toEqual([support.url]);
});
