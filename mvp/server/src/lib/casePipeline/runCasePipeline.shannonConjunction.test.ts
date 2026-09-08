/** Independent public counterexamples from Shannon task §3, frozen before implementation.
 * Synthetic outputs, real production pipeline, no network or paid model execution.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { deriveOverallVerdict } from "../reportAssembly/assembleFinalReport";
import { directAnswer } from "../publicCopy";
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

async function execute(kind: Kind | "single", audit: "clean" | "unavailable", refuted = false) {
  const atoms = kind === "single" ? [A] : [A, B];
  const verdicts = kind === "single" ? [aVerdict(refuted)] : [aVerdict(refuted), bVerdict(kind)];
  const snapshots: InvestigationSnapshotV1[] = [];
  const step = (agent: string, output: Record<string, unknown>): PipelineStep => ({ agent, output, status: "completed", timestamp: Date.now() });
  const composer = { verdictType: refuted ? "false" : "true", conclusion: refuted ? "两项均不成立。" : "两项均已证实。", subclaimVerdicts: verdicts };
  const result = await runCasePipeline({
    claim: atoms.join("，而且") + "。",
    runAgent: async (id) => {
      if (id === "rumor_detector") return step(id, { claimAtoms: atoms, claimAtomTypes: atoms.map(text => ({ text, type: "fact", verifiable: true })) });
      if (id === "fact_checker") return step(id, { factCheckResult: refuted ? "false" : "true", subclaimVerdicts: verdicts });
      if (id === "source_validator") return step(id, { sourceReliability: "high" });
      if (id === "report_composer") return step(id, composer);
      throw new Error(`Unexpected agent ${id}`);
    },
    searchOne: async (query) => ({ answer: "", model: "synthetic-search", sources: query.includes(A) ? [SA] : query.includes(B) && (kind === "related-only" || kind === "supported") ? [SB] : [] }),
    callSelfProofModel: async () => ({ model: "synthetic-selfproof", output: { results: atoms.map(atom => ({ atom, supported: true, reason: "输入明确列出该命题" })) } }),
    wholeClaimAudit: { callModel: async ({ systemPrompt }) => {
      if (audit === "unavailable") throw new Error("synthetic audit unavailable");
      return { model: "synthetic-audit", output: systemPrompt.includes("整句证据评估器")
        ? { supportedWhere: "", biggestGap: "", missingJustifications: [], nextQuestions: [] }
        : { overallQuestion: atoms.join("，而且"), checkabilityRevisions: [], missingJustifications: [], auditQuestions: [] } };
    } },
    citationLiveness: { liveness: new Map([[SA.url, "alive"], [SB.url, "alive"]]) },
    runReport: async () => step("report_composer", composer),
    hooks: { onInvestigationSnapshot: snapshot => { snapshots.push(snapshot); } },
  });
  const artifactDir = process.env.RHG_SHANNON_ARTIFACT_DIR;
  if (artifactDir) {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, `${kind}-${audit}-${refuted ? "false" : "true"}.json`), JSON.stringify({ evidenceKind: "synthetic-pipeline", isolation: "logical-only", report: result.finalReport, snapshots }, null, 2) + "\n");
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

describe("Shannon independent function contract", () => {
  for (const kind of ["unverified", "missing", "related-only"] as const) {
    it(`A supported + B ${kind} cannot prove conjunction, either order`, () => {
      const values = [aVerdict(), bVerdict(kind)];
      expect(deriveOverallVerdict(values)).not.toBe("true");
      expect(deriveOverallVerdict([...values].reverse())).not.toBe("true");
    });
  }
  it("contradict-only partial contributes no true side", () => {
    expect(deriveOverallVerdict([aVerdict(true), { ...bVerdict("unverified"), verdict: "partial", contradictingSources: [SB] }])).toBe("false");
  });
  it("positive single and two fully supported claims retain true", () => {
    expect(deriveOverallVerdict([aVerdict()])).toBe("true");
    expect(deriveOverallVerdict([aVerdict(), bVerdict("supported")])).toBe("true");
  });
});

describe("Shannon real pipeline to final Snapshot/directAnswer", () => {
  for (const audit of ["clean", "unavailable"] as const) {
    for (const kind of ["unverified", "missing", "related-only"] as const) {
      it(`A supported, B ${kind}, audit ${audit}, composer true`, async () => {
        const { report, snapshot } = await execute(kind, audit);
        expect.soft(report.verdictType).toBe("unverified");
        expect.soft(snapshot.conclusion?.judgment).toBe("unresolved");
        expect.soft(snapshot.claims.find(c => c.text === A)?.judgment).toBe("supported");
        expect.soft(snapshot.claims.find(c => c.text === B)?.judgment).toBe("unresolved");
        const answer = snapshot.conclusion?.directAnswer ?? "";
        expect.soft(answer.startsWith(directAnswer("unverified"))).toBe(true);
        expect.soft(answer).toContain(B);
        expect.soft(answer).toMatch(/尚未查清|未核实|无法确认|缺少/);
        expect.soft(answer).not.toContain("两项均已证实");
        assertSourceBinding(snapshot, A, SA.url, "support");
        assertPublishedCitation(report, snapshot);
      });
    }
    for (const kind of ["single", "supported"] as const) {
      it(`positive ${kind}, audit ${audit} preserves supported`, async () => {
        const { report, snapshot } = await execute(kind, audit);
        expect(report.verdictType).toBe("true");
        expect(snapshot.conclusion?.judgment).toBe("supported");
        expect(snapshot.claims.every(c => c.judgment === "supported")).toBe(true);
        assertSourceBinding(snapshot, A, SA.url, "support");
        if (kind === "supported") assertSourceBinding(snapshot, B, SB.url, "support");
      });
    }
    it(`A refuted, B unknown, audit ${audit} preserves false without accusing B`, async () => {
      const { report, snapshot } = await execute("unverified", audit, true);
      expect(report.verdictType).toBe("false");
      expect(snapshot.conclusion?.judgment).toBe("refuted");
      expect(snapshot.claims.find(c => c.text === A)?.judgment).toBe("refuted");
      expect(snapshot.claims.find(c => c.text === B)?.judgment).toBe("unresolved");
      expect(snapshot.conclusion?.directAnswer).not.toContain("两项均不成立");
      expect(snapshot.conclusion?.directAnswer).toContain(B);
      expect(snapshot.conclusion?.directAnswer).toMatch(/尚未查清|未核实|无法确认|缺少/);
      assertSourceBinding(snapshot, A, SA.url, "contradict");
      assertPublishedCitation(report, snapshot);
    });
  }
});
