import { describe, expect, it } from "vitest";
import { candidatesFor } from "./jobModels.js";

const JOBS = [
  "route",
  "self-proof",
  "decompose",
  "assess",
  "investigate",
  "cites",
  "ask_case",
  "compose",
] as const;

describe("candidatesFor", () => {
  it("默认表覆盖全部工单，未知 job 回落到 assess 表", () => {
    const env = {};
    for (const job of JOBS) {
      const rows = candidatesFor(job, env);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.provider).toBe("minimax");
      expect(rows[0]?.model).toBe("MiniMax-M3");
    }
    expect(candidatesFor("decompose", env)[0]?.effort).toBe("low");
    expect(candidatesFor("decompose", env)[0]?.timeoutMs).toBe(30_000);
    expect(candidatesFor("compose", env)[0]?.timeoutMs).toBe(45_000);
    expect(candidatesFor("no-such-job", env)).toEqual(candidatesFor("assess", env));
  });

  it("RHG_MODEL_ASSESS 覆盖且首位是 stepfun", () => {
    const rows = candidatesFor("assess", {
      RHG_MODEL_ASSESS: "stepfun:step-3.7-flash:low",
    });
    expect(rows[0]).toMatchObject({
      provider: "stepfun",
      model: "step-3.7-flash",
      effort: "low",
    });
    expect(rows).toHaveLength(1);
  });

  it("RHG_MODEL_SELF_PROOF / RHG_MODEL_ASK_CASE 按 job 名转大写+下划线", () => {
    const proof = candidatesFor("self-proof", {
      RHG_MODEL_SELF_PROOF: "stepfun:step-3.7-flash",
    });
    expect(proof[0]?.provider).toBe("stepfun");
    const ask = candidatesFor("ask_case", {
      RHG_MODEL_ASK_CASE: "minimax:MiniMax-M3:low",
    });
    expect(ask[0]).toMatchObject({ provider: "minimax", model: "MiniMax-M3", effort: "low" });
  });

  it("坏格式忽略该条并走默认", () => {
    const rows = candidatesFor("assess", { RHG_MODEL_ASSESS: "not-a-provider,::,minimax" });
    expect(rows).toEqual(candidatesFor("assess", {}));
  });

  it("列表里坏条目丢掉、好条目保留", () => {
    const rows = candidatesFor("assess", {
      RHG_MODEL_ASSESS: "nope:x,stepfun:step-3.7-flash:low,also-bad",
    });
    expect(rows).toEqual([
      expect.objectContaining({ provider: "stepfun", model: "step-3.7-flash", effort: "low" }),
    ]);
  });
});
