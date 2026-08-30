import { describe, expect, it } from "vitest";
import { adaptOrchestrateStreamToShell } from "../../../../lib/missionShell";
import { FIXTURE_COMPLETE, FIXTURE_EARLY, FIXTURE_MID } from "../../../../lib/missionShell/fixtures";
import { buildInvestigationTodos } from "./TodoList";

describe("buildInvestigationTodos", () => {
  it("FIXTURE_EARLY: planner/memory progress, later steps pending or active", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY);
    const todos = buildInvestigationTodos(model);
    expect(todos.map((t) => t.id)).toEqual(["plan", "triage", "search", "fact", "source", "report"]);
    const plan = todos.find((t) => t.id === "plan");
    expect(plan?.status).toBe("done");
    // rumor_detector is running → triage active
    expect(todos.find((t) => t.id === "triage")?.status).toMatch(/active|pending/);
    expect(todos.find((t) => t.id === "report")?.status).toBe("pending");
  });

  it("FIXTURE_MID: search done, fact/source agents complete", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const todos = buildInvestigationTodos(model);
    expect(todos.find((t) => t.id === "plan")?.status).toBe("done");
    expect(todos.find((t) => t.id === "triage")?.status).toBe("done");
    expect(todos.find((t) => t.id === "search")?.status).toBe("done");
    expect(todos.find((t) => t.id === "fact")?.status).toBe("done");
    expect(todos.find((t) => t.id === "source")?.status).toBe("done");
    expect(todos.find((t) => t.id === "report")?.status).toMatch(/active|pending/);
  });

  it("FIXTURE_COMPLETE: all checklist items done when verdict present", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);
    const todos = buildInvestigationTodos(model);
    expect(todos.every((t) => t.status === "done")).toBe(true);
  });
});
