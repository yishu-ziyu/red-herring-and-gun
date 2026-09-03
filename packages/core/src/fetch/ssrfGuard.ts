/**
 * ssrfGuard.ts — 拦截内网 / 元数据服务 / 特殊 IPv6 的 LLM 测试端点
 */

import dns from "node:dns/promises";

function ipv4OctetsFromHostname(hostname: string): number[] | "blocked" | null {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (/0x/i.test(host) || /^\d+$/.test(host)) return "blocked";
  if (!/^[\d.]+$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length !== 4) return "blocked";
  if (parts.some((part) => part.length > 1 && part.startsWith("0"))) return "blocked";
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "blocked";
  return nums;
}

function isBlockedPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedTestLlmUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "metadata.tencentyun.com" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "::"
  ) {
    return true;
  }
  if (host.startsWith("::ffff:")) {
    return isBlockedTestLlmUrl(`https://${host.slice("::ffff:".length)}`);
  }
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  }
  const ipv4 = ipv4OctetsFromHostname(host);
  if (ipv4 === "blocked") return true;
  if (ipv4 && isBlockedPrivateIpv4(ipv4)) return true;
  return false;
}

/** 覆盖 IPv4 私网/保留段、IPv6 ULA/链路本地、以及内网惯用主机名。 */
export function isPrivateAddressText(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // 含云 metadata 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 组播/保留段
    return false;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(h) || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
    return false;
  }
  return false;
}

/** 域名可能解析到内网 IP（含 DNS rebinding），生产环境必须解析后再核验。 */
export async function baseUrlTargetsPrivateNetwork(baseUrl: string): Promise<boolean> {
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return true; // 非法 URL 一律拦
  }
  if (isPrivateAddressText(hostname)) return true;
  try {
    const resolved = await dns.lookup(hostname, { all: true });
    return resolved.some((row) => isPrivateAddressText(row.address));
  } catch {
    // DNS 解析失败：交给后续 fetch 自然报错，不在这里放结论
    return false;
  }
}

export async function blockedFetchReason(url: string): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "ssrf: invalid url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "ssrf: not http(s)";
  }
  if (isBlockedTestLlmUrl(url)) return "ssrf: blocked host";
  if (isPrivateAddressText(parsed.hostname)) return "ssrf: private host";
  if (await baseUrlTargetsPrivateNetwork(url)) return "ssrf: resolved private";
  return undefined;
}
