import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./providerRouter.js", () => ({
  callAgentWithFallback: vi.fn(),
}));

import { callAgentWithFallback } from "./providerRouter.js";
import { attachCondensedSnippets } from "./sourceCondenser.js";

describe("attachCondensedSnippets critical-path boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not spend an LLM call on optional source rewriting by default", async () => {
    const result = {
      sources: [
        {
          id: "S1",
          title: "公开来源",
          snippet: "这是一段已经足够让核查继续的公开来源摘要。",
        },
      ],
    };

    await attachCondensedSnippets({}, "待核查说法", result);

    expect(callAgentWithFallback).not.toHaveBeenCalled();
    expect(result.sources[0]).not.toHaveProperty("condensedSnippet");
  });

  it("still supports explicit offline source rewriting", async () => {
    vi.mocked(callAgentWithFallback).mockResolvedValue({
      output: { snippets: [{ id: "S1", snippet: "压缩后的公开来源摘要。" }] },
      model: "minimax:MiniMax-M2.7-highspeed",
      latencyMs: 10,
    });
    const result = {
      sources: [
        {
          id: "S1",
          title: "公开来源",
          snippet: "这是一段已经足够让核查继续的公开来源摘要。",
        },
      ],
    };

    await attachCondensedSnippets({ SOURCE_CONDENSER_ENABLED: "1" }, "待核查说法", result);

    expect(callAgentWithFallback).toHaveBeenCalledTimes(1);
    expect(result.sources[0]).toHaveProperty("condensedSnippet", "压缩后的公开来源摘要。");
  });
});
