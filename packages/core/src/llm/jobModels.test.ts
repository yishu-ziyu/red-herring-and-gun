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
  "qualify",
  "qualify_review",
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

  const FOUR_KEYS = {
    MINIMAX_API_KEY: "sk-mm-test",
    MINIMAX_MODEL: "MiniMax-M2.7-highspeed",
    STEPFUN_API_KEY: "sk-sf-test",
    STEPFUN_MODEL: "step-3.7-flash",
    DEEPSEEK_API_KEY: "sk-ds-test",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    MIMO_API_KEY: "sk-mimo-test",
    MIMO_MODEL: "mimo-v2.5-pro",
  } as const;

  it("无 RHG_MODEL 覆盖时按 env 已配置供应商建候选，并用各自 MODEL 名", () => {
    const rows = candidatesFor("assess", FOUR_KEYS);
    expect(rows.map((row) => `${row.provider}:${row.model}`)).toEqual([
      "minimax:MiniMax-M2.7-highspeed",
      "stepfun:step-3.7-flash",
      "deepseek:deepseek-v4-flash",
      "mimo:mimo-v2.5-pro",
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/sk-mm-test|sk-sf-test|sk-ds-test|sk-mimo-test/);
  });

  it("只配 DeepSeek 与 MiMo 时不塞未配置的 MiniMax/StepFun", () => {
    const rows = candidatesFor("qualify", {
      DEEPSEEK_API_KEY: "sk-ds-test",
      DEEPSEEK_MODEL: "deepseek-v4-pro",
      MIMO_API_KEY: "sk-mimo-test",
    });
    expect(rows.map((row) => row.provider)).toEqual(["deepseek", "mimo"]);
    expect(rows[0]?.model).toBe("deepseek-v4-pro");
    expect(rows[1]?.model).toBe("mimo-v2.5-pro");
  });

  it("空白 key 不算已配置", () => {
    const rows = candidatesFor("assess", {
      MINIMAX_API_KEY: "   ",
      DEEPSEEK_API_KEY: "sk-ds-test",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
    });
    expect(rows.map((row) => row.provider)).toEqual(["deepseek"]);
  });

  it("RHG_MODEL 覆盖不与 env 发现合并", () => {
    const rows = candidatesFor("assess", {
      ...FOUR_KEYS,
      RHG_MODEL_ASSESS: "stepfun:step-3.7-flash:low",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "stepfun", model: "step-3.7-flash", effort: "low" });
  });

  it("compose 在已配置 MiniMax 时保留 medium 与 45s", () => {
    const rows = candidatesFor("compose", {
      MINIMAX_API_KEY: "sk-mm-test",
      MINIMAX_MODEL: "MiniMax-M2.7-highspeed",
    });
    expect(rows).toEqual([
      expect.objectContaining({
        provider: "minimax",
        model: "MiniMax-M2.7-highspeed",
        effort: "medium",
        timeoutMs: 45_000,
      }),
    ]);
  });
});
