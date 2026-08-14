import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DAILY_CHECKS,
  GUEST_DAILY_CHECKS,
  checksExhaustedMessage,
  checksRemainingMessage,
  isChecksExhaustedMessage,
  parseCheckQuota,
  quotaIsExhausted,
  shanghaiDayKey,
} from "./checkQuota";

describe("checkQuota copy", () => {
  it("names the daily caps in people language", () => {
    expect(GUEST_DAILY_CHECKS).toBe(1);
    expect(ACCOUNT_DAILY_CHECKS).toBe(3);
    expect(checksRemainingMessage({ remaining: 1, total: 1, used: 0, kind: "guest", enforced: true })).toBe(
      "今天还能免费查 1 条"
    );
    expect(checksRemainingMessage({ remaining: 2, total: 3, used: 1, kind: "account", enforced: true })).toBe(
      "今天还能查 2 条"
    );
    expect(checksRemainingMessage({ remaining: 0, total: 1, used: 1, kind: "guest", enforced: false })).toBe("");
    expect(quotaIsExhausted({ remaining: 0, total: 1, used: 1, kind: "guest", enforced: false })).toBe(false);
    expect(quotaIsExhausted({ remaining: 0, total: 1, used: 1, kind: "guest", enforced: true })).toBe(true);
  });

  it("only treats the two known exhausted lines as product copy", () => {
    expect(isChecksExhaustedMessage(checksExhaustedMessage("guest"))).toBe(true);
    expect(isChecksExhaustedMessage(checksExhaustedMessage("account"))).toBe(true);
    expect(isChecksExhaustedMessage("quota exceeded at https://internal.example.com")).toBe(false);
  });

  it("uses Asia/Shanghai calendar days", () => {
    expect(shanghaiDayKey(Date.parse("2026-08-14T04:00:00Z"))).toBe("2026-08-14");
    expect(shanghaiDayKey(Date.parse("2026-08-14T16:00:00Z"))).toBe("2026-08-15");
  });

  it("parses a quota payload and rejects junk", () => {
    expect(parseCheckQuota({ remaining: 3, total: 3, used: 0, kind: "account" })).toEqual({
      remaining: 3,
      total: 3,
      used: 0,
      kind: "account",
      enforced: true,
    });
    expect(parseCheckQuota({ remaining: -1, total: 3, used: 0, kind: "account" })).toBeNull();
    expect(parseCheckQuota({ remaining: 1, total: 1, used: 0 })).toBeNull();
  });
});
