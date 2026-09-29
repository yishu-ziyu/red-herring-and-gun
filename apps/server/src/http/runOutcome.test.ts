/**
 * 调查结局与额度结算：每一条对应旧处理器 catch 里的一个分支（判定顺序即优先级）。
 */
import { describe, expect, it } from "vitest";
import { classifyFailure, QUOTA_SETTLEMENT, RUN_FINAL_STATUS, TIMEOUT_LABEL } from "./runOutcome.js";

const none = { cancelled: false, byoFailed: false };
const timeoutError = new Error(`${TIMEOUT_LABEL}超时（420000ms）`);
// 管线的 throwIfAborted 抛的是 signal.reason：name 为 AbortError 的错误。
const abortError = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

describe("classifyFailure", () => {
  it("用户点了停止：无论管线抛的是什么，都算取消", () => {
    expect(classifyFailure(timeoutError, { cancelled: true, byoFailed: true })).toBe("cancelled");
    expect(classifyFailure(new Error("boom"), { cancelled: true, byoFailed: false })).toBe("cancelled");
  });

  it("自带密钥失败排在超时与中止之前", () => {
    expect(classifyFailure(timeoutError, { cancelled: false, byoFailed: true })).toBe("byo-failed");
    expect(classifyFailure(abortError, { cancelled: false, byoFailed: true })).toBe("byo-failed");
  });

  it("总时限与宽限都过了：超时", () => {
    expect(classifyFailure(timeoutError, none)).toBe("timed-out");
  });

  it("管线因中止退出：按客户端离开结算", () => {
    expect(classifyFailure(abortError, none)).toBe("client-gone");
    expect(classifyFailure(new Error("client-disconnected"), none)).toBe("client-gone");
  });

  it("其余都是服务端失败（含图片解析失败与非 Error 抛出物）", () => {
    expect(classifyFailure(new Error("HTTP 404"), none)).toBe("server-error");
    expect(classifyFailure("boom", none)).toBe("server-error");
  });
});

describe("结算表", () => {
  it("额度：完成、超时、客户端离开计费；取消、密钥失败、服务端失败退还", () => {
    expect(QUOTA_SETTLEMENT).toEqual({
      completed: "commit",
      cancelled: "release",
      "byo-failed": "release",
      "timed-out": "commit",
      "client-gone": "commit",
      "server-error": "release",
    });
  });

  it("run 终态：只有完成算 completed，取消是 cancelled，其余 interrupted", () => {
    expect(RUN_FINAL_STATUS).toEqual({
      completed: "completed",
      cancelled: "cancelled",
      "byo-failed": "interrupted",
      "timed-out": "interrupted",
      "client-gone": "interrupted",
      "server-error": "interrupted",
    });
  });
});
