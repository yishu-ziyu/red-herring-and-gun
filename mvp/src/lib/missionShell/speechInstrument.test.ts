import { describe, expect, it } from "vitest";
import { adaptOrchestrateStreamToShell } from "./streamAdapter";
import { FIXTURE_AGENT_THOUGHT, FIXTURE_MID, FIXTURE_TRIAGE_RUNNING } from "./fixtures";
import {
  flattenRowToBlocks,
  flattenRowsToBlocks,
  instrumentVariantFromTitle,
} from "./speechInstrument";
import { buildVisibleProcessRows } from "./visibleProcessRows";

describe("flattenRowToBlocks", () => {
  it("puts spoken title outside instrument cards", () => {
    const n = buildVisibleProcessRows(adaptOrchestrateStreamToShell(FIXTURE_MID));
    const current = n.rows.find((r) => r.isCurrent) ?? n.rows[0];
    const blocks = flattenRowToBlocks(current);
    expect(blocks[0]?.kind).toBe("speech");
    if (blocks[0]?.kind !== "speech") return;
    expect(blocks[0].text.length).toBeGreaterThan(0);
    expect(blocks.slice(1).every((b) => b.kind === "instrument")).toBe(true);
  });

  it("interleaves speech and instruments; thinking is never a speech field", () => {
    const n = buildVisibleProcessRows(adaptOrchestrateStreamToShell(FIXTURE_TRIAGE_RUNNING));
    const blocks = flattenRowsToBlocks(n.rows);
    expect(blocks.some((b) => b.kind === "speech" && b.text === "正在单独核验原因")).toBe(true);
    expect(
      blocks.some((b) => b.kind === "instrument" && /历史|查阅/.test(b.title))
    ).toBe(true);
    expect(blocks.some((b) => b.kind === "instrument" && b.hostsReasoning)).toBe(true);
    expect(blocks.filter((b) => b.kind === "speech").every((b) => b.kind === "speech")).toBe(
      true
    );
  });

  it("agent_thought sentences live on the instrument, not the speech line", () => {
    const n = buildVisibleProcessRows(adaptOrchestrateStreamToShell(FIXTURE_AGENT_THOUGHT));
    const withThought = n.rows.find((r) => r.reasoning?.length);
    expect(withThought).toBeTruthy();
    const blocks = flattenRowToBlocks(withThought!);
    expect(blocks[0]?.kind).toBe("speech");
    const think = blocks.find((b) => b.kind === "instrument" && b.hostsReasoning);
    expect(think).toBeTruthy();
    if (think?.kind !== "instrument") return;
    expect(think.reasoning?.join("")).toMatch(/真实思考句/);
  });

  it("classifies instrument glyphs from titles", () => {
    expect(instrumentVariantFromTitle("查阅历史案件", "tool:memory_search")).toBe("memory");
    expect(instrumentVariantFromTitle("检索公开材料", "tool:search360")).toBe("search");
    expect(instrumentVariantFromTitle("思考")).toBe("think");
    expect(instrumentVariantFromTitle("报告审稿")).toBe("work");
  });
});
