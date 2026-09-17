import { describe, expect, it, vi } from "vitest";
import { retrieveForAtoms, selectAtomsToSearch } from "./atomSearch";
import { buildInvestigationSnapshot } from "./investigation/build";

describe("progressive scope", () => {
  it("main claims take priority without adding unretained claims", () => {
    const atoms = Array.from({ length: 8 }, (_, i) => `背景数字${i}`);
    atoms.push("全市公交永久免费");
    const selected = selectAtomsToSearch(atoms, undefined, ["全市公交永久免费", "凭空多出的说法"]);
    expect(selected[0]).toBe("全市公交永久免费");
    expect(selected).not.toContain("凭空多出的说法");
    expect(selected.length).toBeLessThan(atoms.length);
  });
  it("published scope matches actual selected searches and does not include value claims", async () => {
    const atoms = Array.from({ length: 8 }, (_, i) => `线路${i}免费`);
    const onPlan = vi.fn(); const searchOne = vi.fn(async () => ({ sources: [] }));
    await retrieveForAtoms({ claimAtoms: [...atoms, "好政策"], claimAtomTypes: [{ text: "好政策", verifiable: false, type: "value" }], priorityClaimAtoms: [atoms[7]], onPlan, searchOne });
    const plan = onPlan.mock.calls[0][0];
    expect(plan.includedAtoms).toEqual(searchOne.mock.calls.map((row) => row[0]));
    expect(plan.deferredAtoms.length).toBe(2);
    const snap = buildInvestigationSnapshot({ originalClaim: "文章", phase: "investigating", claimAtoms: atoms, scopePlan: plan });
    expect(snap.scope?.deferredClaimIds).toHaveLength(2);
    expect(snap.scope?.includedClaimIds).toHaveLength(6);
  });
});
