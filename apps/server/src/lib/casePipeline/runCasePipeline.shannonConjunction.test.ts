/** Independent public counterexamples from Shannon task §3, frozen before implementation.
 * Synthetic outputs, real production pipeline, no network or paid model execution.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { confirmedSourceValidatorStep } from "./testSourceRelationAudit";
import { decideSentenceVerdict } from "../../domain/verdict";
import { listAssessedClaims } from "../sentenceVerdict";
import type { InvestigationSnapshotV1 } from "../investigation/index.js";

const A = "甲馆于周二开放";
const B = "乙馆于周二开放";
const SA = { url: "https://shannon.test/alpha-hours", title: "甲馆时间", snippet: "甲馆周二开放" };
const SB = { url: "https://shannon.test/beta-context", title: "乙馆资料", snippet: "乙馆资料" };
type Kind = "unverified" | "missing" | "related-only" | "supported";
const aVerdict = (refuted = false) => ({
  claimAtom: A, verdict: refuted ? "false" : "true",
  evidence: refuted ? "甲馆公告确认周二关闭[1]。" : "甲馆公告确认周二开放[1]。",
  boundary: "公告对应甲馆", supportingSources: refuted ? [] : [SA], contradictingSources: refuted ? [SA] : [],
});
const bVerdict = (kind: Kind) => ({
  claimAtom: B, ...(kind === "missing" ? {} : { verdict: kind === "unverified" ? "unverified" : "true" }),
  evidence: kind === "supported" ? "乙馆公告确认周二开放[1]。" : "乙馆周二开放尚未查清。",
  boundary: kind === "supported" ? "公告对应乙馆" : "缺少乙馆周二开放的直接依据",
  supportingSources: kind === "supported" || kind === "related-only" ? [SB] : [],
  contradictingSources: [], ...(kind === "related-only" ? { sourcesRelatedOnly: true } : {}),
});

async function execute(kind: Kind | "single", refuted = false) {
  const atoms = kind === "single" ? [A] : [A, B];
  const verdicts = kind === "single" ? [aVerdict(refuted)] : [aVerdict(refuted), bVerdict(kind)];
  const snapshots: InvestigationSnapshotV1[] = [];
  const step = (agent: string, output: Record<string, unknown>): PipelineStep => ({ agent, output, status: "completed", timestamp: Date.now() });
  const composer = { verdictType: refuted ? "false" : "true", explanation: refuted ? "两项均不成立。" : "两项均已证实。", subclaimVerdicts: verdicts };
  const result = await runCasePipeline({
    claim: atoms.join("，而且") + "。",
    runAgent: async (id, steps) => {
      if (id === "rumor_detector") return step(id, { claimAtoms: atoms, claimAtomTypes: atoms.map(text => ({ text, type: "fact", verifiable: true })) });
      if (id === "fact_checker") return step(id, { factCheckResult: refuted ? "false" : "true", subclaimVerdicts: verdicts });
      if (id === "source_validator") return confirmedSourceValidatorStep(steps, "high");
      if (id === "report_composer") return step(id, composer);
      throw new Error(`Unexpected agent ${id}`);
    },
    searchOne: async (query) => ({ answer: "", model: "synthetic-search", sources: query.includes(A) ? [SA] : query.includes(B) && (kind === "related-only" || kind === "supported") ? [SB] : [] }),
    callSelfProofModel: async () => ({ model: "synthetic-selfproof", output: { results: atoms.map(atom => ({ atom, supported: true, reason: "输入明确列出该命题" })) } }),
    citationLiveness: { liveness: new Map([[SA.url, "alive"], [SB.url, "alive"]]) },
    runReport: async () => step("report_composer", composer),
    hooks: { onInvestigationSnapshot: snapshot => { snapshots.push(snapshot); } },
  });
  const artifactDir = process.env.RHG_SHANNON_ARTIFACT_DIR;
  if (artifactDir) {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, `${kind}-${refuted ? "false" : "true"}.json`), JSON.stringify({ evidenceKind: "synthetic-pipeline", isolation: "logical-only", report: result.finalReport, snapshots }, null, 2) + "\n");
  }
  return { report: result.finalReport, snapshot: snapshots.at(-1)! };
}

function assertSourceBinding(snapshot: InvestigationSnapshotV1, atom: string, target: string, role: "support" | "contradict") {
  const claim = snapshot.claims.find(c => c.text === atom)!;
  const links = claim.evidence.filter(e => e.role === role);
  expect(links.length).toBeGreaterThan(0);
  expect(links.map(e => snapshot.sources.find(s => s.id === e.sourceId)?.url)).toContain(target);
}

function assertPublishedCitation(report: Record<string, unknown>, snapshot: InvestigationSnapshotV1) {
  const answer = snapshot.conclusion?.directAnswer ?? "";
  const marker = answer.match(/甲馆公告确认周二(?:开放|关闭)\[(\d+)\]/);
  expect(marker, "已知 A 的说明须有可解析的发布引用").not.toBeNull();
  const sources = report.citationSources as Array<{ url: string }>;
  expect(sources[Number(marker![1]) - 1]?.url).toBe(SA.url);
}

/** 整句规则表对一组判词的结论（第一条是主要主张，其余是必要前提）。 */
function overall(verdicts: Array<Record<string, unknown>>) {
  const atoms = verdicts.map((v) => String(v.claimAtom));
  const parts = listAssessedClaims(
    { subclaimVerdicts: verdicts },
    { claimAtoms: atoms, claimAtomTypes: atoms.map((text) => ({ text, type: "fact", verifiable: true })) }
  );
  return decideSentenceVerdict(parts).verdict;
}

describe("Shannon independent function contract", () => {
  for (const kind of ["unverified", "missing", "related-only"] as const) {
    it(`A supported + B ${kind} cannot prove conjunction, either order`, () => {
      const values = [aVerdict(), bVerdict(kind)];
      expect(overall(values)).not.toBe("can-believe");
      expect(overall([...values].reverse())).not.toBe("can-believe");
    });
  }
  it("contradict-only partial contributes no true side", () => {
    expect(overall([aVerdict(true), { ...bVerdict("unverified"), verdict: "partial", contradictingSources: [SB] }])).toBe("cannot-believe");
  });
  it("positive single and two fully supported claims retain true", () => {
    expect(overall([aVerdict()])).toBe("can-believe");
    expect(overall([aVerdict(), bVerdict("supported")])).toBe("can-believe");
  });
});

describe("Shannon real pipeline to final Snapshot/directAnswer", () => {
  it("A和B有原文支持，但推论跳跃C未核：整句与快照不能写成已经证实", async () => {
    const C = "全国所有场馆周二开放";
    const atoms = [A, B, C];
    const snapshots: InvestigationSnapshotV1[] = [];
    const result = await runCasePipeline({
      claim: `${A}，${B}，所以${C}。`,
      runAgent: async (agent, steps) => {
        if (agent === "rumor_detector") return { agent, output: { claimAtoms: atoms,
          claimAtomTypes: [
            { text: A, verifiable: true, type: "fact", role: "premise" },
            { text: B, verifiable: true, type: "fact", role: "premise" },
            { text: C, verifiable: true, type: "causal", role: "main" },
          ] } };
        if (agent === "fact_checker") return { agent, output: { factCheckResult: "partial", subclaimVerdicts: [
          aVerdict(), bVerdict("supported"), { claimAtom: C, verdict: "unverified", evidenceGaps: ["缺少从甲馆和乙馆推广到所有场馆的依据"] },
        ] } };
        if (agent === "source_validator") return confirmedSourceValidatorStep(steps, "high");
        throw new Error(`unexpected ${agent}`);
      },
      searchOne: async (query) => ({ sources: query.includes(A) ? [SA] : query.includes(B) ? [SB] : [] }),
      callSelfProofModel: async () => ({ model: "self", output: { results: atoms.map((atom) => ({ atom, supported: true })) } }),
      evidenceLoop: { enabled: false }, citationLiveness: false,
      runReport: async () => ({ agent: "report_composer", output: { verdictType: "true", explanation: "甲馆和乙馆都开放，因此全国场馆都开放。" } }),
      hooks: { onInvestigationSnapshot: (snapshot) => snapshots.push(snapshot) },
    });
    expect(result.finalReport.verdictType).toBe("unverified");
    expect(Object.fromEntries((result.finalReport.subclaimVerdicts as Array<{ claimAtom: string; verdict: string }>).map((row) => [row.claimAtom, row.verdict]))).toMatchObject({
      [A]: "true", [B]: "true", [C]: "unverified",
    });
    expect(snapshots.at(-1)?.claims.find((item) => item.text === C)?.judgment).toBe("unresolved");
    expect(snapshots.at(-1)?.conclusion?.judgment).toBe("unresolved");
    expect(String(result.finalReport.conclusion)).not.toContain("因此全国场馆都开放");
    expect(String(result.finalReport.summaryForPublic)).not.toContain("因此全国场馆都开放");
    expect(String(result.finalReport.conclusion)).toContain(C);
    expect(String(result.finalReport.conclusion)).toMatch(/尚未查清|还缺|仍缺/);
  });
  for (const kind of ["unverified", "missing", "related-only"] as const) {
    it(`A supported, B ${kind} cannot prove the conjunction`, async () => {
      const { report, snapshot } = await execute(kind);
      expect(report.verdictType).toBe("unverified");
      expect(snapshot.conclusion?.judgment).toBe("unresolved");
      expect(snapshot.claims.find(c => c.text === A)?.judgment).toBe("supported");
      expect(snapshot.claims.find(c => c.text === B)?.judgment).toBe("unresolved");
      expect(snapshot.conclusion?.directAnswer).toContain(B);
      expect(snapshot.conclusion?.directAnswer).not.toContain("两项均已证实");
      assertSourceBinding(snapshot, A, SA.url, "support");
      assertPublishedCitation(report, snapshot);
    });
  }
  for (const kind of ["single", "supported"] as const) {
    it(`positive ${kind} retains supported`, async () => {
      const { report, snapshot } = await execute(kind);
      expect(report.verdictType).toBe("true");
      expect(snapshot.conclusion?.judgment).toBe("supported");
      expect(snapshot.claims.every(c => c.judgment === "supported")).toBe(true);
    });
  }
  it("A refuted, B unknown remains false without accusing B", async () => {
    const { report, snapshot } = await execute("unverified", true);
    expect(report.verdictType).toBe("false");
    expect(snapshot.claims.find(c => c.text === B)?.judgment).toBe("unresolved");
    expect(snapshot.conclusion?.directAnswer).toContain(B);
    expect(String(report.conclusion)).not.toContain("两项均不成立");
    expect(String(report.summaryForPublic)).not.toContain("两项均不成立");
    expect(String(report.conclusion)).toMatch(/尚未查清|还缺|仍缺/);
    assertSourceBinding(snapshot, A, SA.url, "contradict");
  });
});
