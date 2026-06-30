import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createOauthState,
  decodeSignedJson,
  encodeSignedJson,
  getAipingConfig,
  parseCookies,
} from "./aipingAuth.js";

describe("aipingAuth", () => {
  it("is disabled until client id, secret, and session secret are configured", () => {
    expect(getAipingConfig({}).enabled).toBe(false);
    expect(
      getAipingConfig({
        AIPING_CLIENT_ID: "client",
        AIPING_CLIENT_SECRET: "secret",
        AIPING_SESSION_SECRET: "session",
      }).enabled
    ).toBe(true);
  });

  it("builds the AI Ping OAuth authorize URL with the registered callback and scope", () => {
    const config = getAipingConfig({
      AIPING_CLIENT_ID: "client-id",
      AIPING_CLIENT_SECRET: "client-secret",
      AIPING_SESSION_SECRET: "session-secret",
      AIPING_REDIRECT_URI: "https://gun.yishuziyu.cn/api/auth/aiping/callback",
      AIPING_SCOPE: "profile phone",
    });

    const url = new URL(buildAuthorizeUrl(config, "state-1"));
    expect(url.origin).toBe("https://central.qc-ai.cn");
    expect(url.pathname).toBe("/api/v1/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://gun.yishuziyu.cn/api/auth/aiping/callback");
    expect(url.searchParams.get("scope")).toBe("profile phone");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBeTruthy();
  });

  it("rejects tampered signed state/session payloads", () => {
    const token = encodeSignedJson({ sub: "user-1" }, "secret-a");
    expect(decodeSignedJson<{ sub: string }>(token, "secret-a")).toEqual({ sub: "user-1" });
    expect(decodeSignedJson(token, "secret-b")).toBeNull();
    expect(decodeSignedJson(`${token}x`, "secret-a")).toBeNull();
  });

  it("sanitizes oauth next redirects to local absolute paths", () => {
    expect(createOauthState("/case/1").next).toBe("/case/1");
    expect(createOauthState("https://evil.example").next).toBe("/");
    expect(createOauthState("//evil.example").next).toBe("/");
  });

  it("parses cookie headers without depending on cookie middleware", () => {
    expect(parseCookies("a=1; b=hello%20world")).toEqual({ a: "1", b: "hello world" });
  });
});
