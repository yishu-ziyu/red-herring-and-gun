import { describe, expect, it } from "vitest";
import {
  ACCOUNT_NAME_MAX,
  accountDisplayName,
  accountHandle,
  accountInitial,
  normalizeAccountName,
} from "./accountIdentity";

describe("accountIdentity", () => {
  it("uses the mailbox local part when no name is set", () => {
    expect(accountHandle("yishuziyu@gmail.com")).toBe("yishuziyu");
    expect(accountDisplayName("yishuziyu@gmail.com", "")).toBe("yishuziyu");
    expect(accountDisplayName("yishuziyu@gmail.com", "  奕枢  ")).toBe("奕枢");
  });

  it("takes the first character for the avatar mark", () => {
    expect(accountInitial("yishuziyu")).toBe("Y");
    expect(accountInitial("奕枢")).toBe("奕");
  });

  it("rejects names longer than the ChatGPT-style nickname cap", () => {
    expect(normalizeAccountName("奕枢").value).toBe("奕枢");
    expect(normalizeAccountName("a".repeat(ACCOUNT_NAME_MAX + 1)).ok).toBe(false);
  });
});
