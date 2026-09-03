import type { CaseEvent } from '@rhg/core/casefile';
import contested from "../../fixtures/contested.json";
import decomposing from "../../fixtures/decomposing.json";
import done from "../../fixtures/done.json";
import followup from "../../fixtures/followup.json";
import retrieving from "../../fixtures/retrieving.json";

export type FixtureFile = {
  name: string;
  cutAt: number;
  events: CaseEvent[];
};

export const FIXTURES: Record<string, FixtureFile> = {
  decomposing: decomposing as FixtureFile,
  retrieving: retrieving as FixtureFile,
  contested: contested as FixtureFile,
  done: done as FixtureFile,
  followup: followup as FixtureFile,
};

export const FIXTURE_NAMES = ["decomposing", "retrieving", "contested", "done", "followup"] as const;

export function fixtureNameOf(caseId: string): string | undefined {
  if (!caseId.startsWith("fx-")) return undefined;
  const name = caseId.slice(3);
  return name in FIXTURES ? name : undefined;
}

export function loadFixture(caseId: string): FixtureFile | undefined {
  const name = fixtureNameOf(caseId);
  return name ? FIXTURES[name] : undefined;
}
