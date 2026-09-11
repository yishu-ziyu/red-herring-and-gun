/**
 * SSRF 守卫验收（ACCEPTANCE A32）。
 *
 * 交接包原话：「新的来源抓取、外链探活、BYOK baseUrl 全部复用现有 URL 安全处理；
 * 需要补测回环、内网、重定向与 DNS 变更后的目标校验，不能凭 http/https 就视为安全。」
 * 补齐一半时发现本模块**一个测试都没有**——这是本轮补上的。
 */
import { describe, expect, it } from "vitest";
import { isBlockedTestLlmUrl } from "./ssrfGuard.js";

describe("必须拦住的", () => {
  it("回环地址的各种写法", () => {
    for (const url of [
      "http://127.0.0.1:8080/v1",
      "http://127.1.2.3/v1",
      "http://localhost/v1",
      "http://sub.localhost/v1",
      "http://[::1]/v1",
      "http://[::ffff:127.0.0.1]/v1",
      "http://0.0.0.0/v1",
    ]) {
      expect(isBlockedTestLlmUrl(url), url).toBe(true);
    }
  });

  it("内网网段", () => {
    for (const url of [
      "http://10.0.0.5/v1",
      "http://172.16.0.1/v1",
      "http://172.31.255.254/v1",
      "http://192.168.1.1/v1",
      "http://100.64.0.1/v1",
      "https://fc00::1/v1",
      "https://fe80::1/v1",
    ]) {
      expect(isBlockedTestLlmUrl(url), url).toBe(true);
    }
  });

  it("云元数据服务", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://metadata/v1",
      "http://metadata.tencentyun.com/v1",
    ]) {
      expect(isBlockedTestLlmUrl(url), url).toBe(true);
    }
  });

  it("绕过写法的几种：十进制整数、十六进制、八进制、缺段、超范围", () => {
    for (const url of [
      "http://2130706433/v1", // 127.0.0.1 的十进制
      "http://0x7f000001/v1", // 十六进制
      "http://0177.0.0.1/v1", // 八进制段
      "http://127.0.0.1./v1",
      "http://127.0.0.1.0/v1",
      "http://999.1.1.1/v1",
      "http://127.0.0.1:99999/v1",
      "不是网址",
    ]) {
      expect(isBlockedTestLlmUrl(url), url).toBe(true);
    }
  });
});

describe("必须放过的", () => {
  it("正常公网 https 端点", () => {
    for (const url of [
      "https://api.openai.com/v1",
      "https://api.deepseek.com/v1",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "https://api.stepfun.com/v1",
    ]) {
      expect(isBlockedTestLlmUrl(url), url).toBe(false);
    }
  });

  it("公网 IP 与相邻网段不能误伤", () => {
    for (const url of [
      "http://8.8.8.8/v1",
      "http://172.32.0.1/v1", // 172.16/12 的右边一位
      "http://172.15.0.1/v1", // 左边一位
      "http://100.128.0.1/v1", // 100.64/10 的右边一位
      "http://169.253.0.1/v1",
    ]) {
      expect(isBlockedTestLlmUrl(url), url).toBe(false);
    }
  });
});
