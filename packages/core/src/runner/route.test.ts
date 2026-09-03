import { describe, expect, it } from "vitest";
import { createCase } from "../casefile/reduce.js";
import { createFakeLlm } from "../llm/fakes.js";
import { createStageContext } from "../stages/context.js";
import { routeMessage } from "./route.js";

const AT = "2026-09-03T12:00:00.000Z";
const TEXT = "人社部发文说生育津贴直接打到个人卡里了";

function emptyCase() {
  const { case: c } = createCase({ id: "case-route-empty", text: TEXT, at: AT });
  return c;
}

function caseWithClaims() {
  const { case: c } = createCase({ id: "case-route-claims", text: TEXT, at: AT });
  const ctx = createStageContext({ case: c, llm: createFakeLlm({}), now: () => AT });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: TEXT, type: "fact", checkable: true, order: 0 }],
  });
  return ctx.current;
}

describe("routeMessage", () => {
  it("pivotId → pursue_frontier", async () => {
    const fake = createFakeLlm({ route: { route: "ask_case" } });
    const route = await routeMessage(caseWithClaims(), { text: "继续查", pivotId: "p1" }, fake);
    expect(route).toBe("pursue_frontier");
    expect(fake.calls).toHaveLength(0);
  });

  it("消息含 URL → challenge", async () => {
    const fake = createFakeLlm({ route: { route: "ask_case" } });
    const route = await routeMessage(
      caseWithClaims(),
      { text: "对照这篇 https://www.gov.cn/zhengce/x" },
      fake,
    );
    expect(route).toBe("challenge");
    expect(fake.calls).toHaveLength(0);
  });

  it("pivotId 与 URL 同时存在 → pursue_frontier", async () => {
    const fake = createFakeLlm({ route: { route: "off_topic" } });
    const route = await routeMessage(
      caseWithClaims(),
      { text: "看 https://evil.example/x", pivotId: "p1" },
      fake,
    );
    expect(route).toBe("pursue_frontier");
    expect(fake.calls).toHaveLength(0);
  });

  it("空案无 URL → new_claim，且不调 LLM", async () => {
    const fake = createFakeLlm({ route: { route: "ask_case" } });
    const route = await routeMessage(emptyCase(), { text: TEXT }, fake);
    expect(route).toBe("new_claim");
    expect(fake.calls).toHaveLength(0);
  });

  it("空案含 URL → new_claim，且不调 LLM", async () => {
    const fake = createFakeLlm({ route: { route: "challenge" } });
    const route = await routeMessage(
      emptyCase(),
      { text: "对照 https://www.gov.cn/zhengce/x" },
      fake,
    );
    expect(route).toBe("new_claim");
    expect(fake.calls).toHaveLength(0);
  });

  it("LLM 归类 ask_case", async () => {
    const fake = createFakeLlm({ route: { route: "ask_case" } });
    const route = await routeMessage(caseWithClaims(), { text: "现在判得怎样" }, fake);
    expect(route).toBe("ask_case");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.job).toBe("route");
  });

  it("LLM 归类 off_topic", async () => {
    const fake = createFakeLlm({ route: { route: "off_topic" } });
    const route = await routeMessage(caseWithClaims(), { text: "今晚吃什么" }, fake);
    expect(route).toBe("off_topic");
  });

  it("LLM 归类 new_claim", async () => {
    const fake = createFakeLlm({ route: { route: "new_claim" } });
    const route = await routeMessage(caseWithClaims(), { text: "另外还有人说全国都发了" }, fake);
    expect(route).toBe("new_claim");
  });

  it("LLM 返回非法 JSON → new_claim", async () => {
    const fake = createFakeLlm({ route: { nope: true } });
    const route = await routeMessage(caseWithClaims(), { text: "津贴后来发了吗" }, fake);
    expect(route).toBe("new_claim");
    expect(fake.calls).toHaveLength(1);
  });
});
