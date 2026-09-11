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

/**
 * IPv4-mapped IPv6（::ffff:a.b.c.d）取出内嵌的 IPv4。
 *
 * 为什么要单独处理：`new URL()` 会把 `[::ffff:127.0.0.1]` 规范化成 `[::ffff:7f00:1]`，
 * 于是「剥掉 ::ffff: 再递归」拿到的是 `7f00:1` 这种半截主机，守卫直接漏过。
 * 实测 `http://[::ffff:127.0.0.1]/v1` 在修之前**不被拦截**。
 */
function ipv4FromMappedIpv6(host: string): number[] | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!match) return null;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
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
    const mapped = ipv4FromMappedIpv6(host);
    if (mapped) return isBlockedPrivateIpv4(mapped);
    const tail = host.slice("::ffff:".length);
    // 点分写法（未经 URL 规范化的那一种）
    if (/^[\d.]+$/.test(tail)) return isBlockedTestLlmUrl(`https://${tail}`);
    // 其余映射形态按内网处理：宁可拦错，不可放过
    return true;
  }
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  }
  const ipv4 = ipv4OctetsFromHostname(host);
  if (ipv4 === "blocked") return true;
  if (ipv4 && isBlockedPrivateIpv4(ipv4)) return true;
  return false;
}
