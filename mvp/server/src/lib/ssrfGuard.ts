/**
 * ssrfGuard.ts — 拦截内网 / 元数据服务 / 特殊 IPv6 的 LLM 测试端点
 */

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
