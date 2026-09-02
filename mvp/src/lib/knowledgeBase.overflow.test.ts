import { afterEach, describe, expect, it, vi } from "vitest";
import { createKnowledgeBase } from "./knowledgeBase";
import type { KnowledgeBaseEntry } from "./schemas";

const CASES_KEY = "red-herring-knowledge-cases";
const originalStorage = window.localStorage;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalStorage,
  });
  window.localStorage.clear();
});

function fatEntry(id: string, pad: string): KnowledgeBaseEntry {
  return {
    id,
    claim: `隔夜菜会致癌 ${id}`,
    rumorType: "健康",
    diagnosis: {
      mixedJudgments: [],
      ambiguousTerms: [],
      risk: pad,
      whyNotDirectFactCheck: pad,
    },
    finalReport: { conclusion: pad },
    handoffSteps: [],
    credibilityScore: 10,
    timestamp: Date.now(),
    tags: ["overflow"],
  };
}

describe("knowledgeBase writeList overflow", () => {
  it("console.error 裁剪重试 and still writes instead of silently dropping", async () => {
    const budget = 8_000;
    const store = new Map<string, string>();
    const setLengths: number[] = [];
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          const text = String(value);
          setLengths.push(text.length);
          if (text.length > budget) {
            throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
          }
          store.set(key, text);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear(),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size;
        },
      },
    });

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      const line = args.map(String).join(" ");
      errors.push(line);
      process.stdout.write(`${line}\n`);
    });

    const kb = createKnowledgeBase();
    const pad = "隔夜菜会致癌，等于吃毒药。".repeat(40);
    for (let i = 0; i < 12; i += 1) {
      await kb.saveCase(fatEntry(`case-${i}`, pad));
    }

    expect(setLengths.some((n) => n > budget), `setItem lengths ${setLengths.join(",")}`).toBe(true);
    expect(errors.some((line) => line.includes("裁剪重试"))).toBe(true);
    expect(errors.some((line) => line.includes("[knowledgeBase]"))).toBe(true);

    const listed = await kb.listCases();
    expect(listed.length).toBeGreaterThan(0);
    const raw = window.localStorage.getItem(CASES_KEY);
    expect(raw, "trimmed list must still be stored").toBeTruthy();
    expect(raw!.length).toBeLessThanOrEqual(budget);
    expect(JSON.parse(raw!) as unknown[]).toHaveLength(listed.length);
  });
});
