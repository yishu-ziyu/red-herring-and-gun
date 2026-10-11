/**
 * ssrfGuard.ts — 服务端替别人访问外部网址之前，拦截内网、元数据服务和特殊 IPv6 地址。
 * isBlockedUrl 只看网址里写的主机名和 IP，不做 DNS 解析：解析到内网 IP 的公网域名拦不住。
 * 自己做 DNS 解析的调用方（如 favicon 代取）用 isBlockedIp 逐个检查解析出的地址。
 */
import net from "node:net";

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

export function isBlockedUrl(raw: string): boolean {
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
    if (/^[\d.]+$/.test(tail)) return isBlockedUrl(`https://${tail}`);
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

/**
 * 除内网外，其余同样不是公网单播的 IPv4 段。
 * 不直接加进 isBlockedPrivateIpv4，是为了不改变 isBlockedUrl 现有的拦截范围。
 */
function isNonPublicIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (isBlockedPrivateIpv4(parts)) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF 协议分配、TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 中继任播
  if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a! >= 224) return true; // 组播 224/4、保留 240/4、广播 255.255.255.255
  return false;
}

/** 把合法 IPv6 文本展开成 8 组 16 位整数；尾部点分 IPv4 写法也换算进去。 */
function ipv6Hextets(ip: string): number[] | null {
  let host = ip.toLowerCase();
  const zone = host.indexOf("%");
  if (zone >= 0) host = host.slice(0, zone);
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted) {
    if (!net.isIPv4(dotted[2]!)) return null;
    const [a, b, c, d] = dotted[2]!.split(".").map(Number) as [number, number, number, number];
    host = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0 || (halves.length === 2 && missing === 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * 判断一个 DNS 解析结果（或 IP 字面量）能不能连：不是公网单播就拦。
 * 解析不了的输入一律当作要拦。IPv6 里内嵌 IPv4 的几种写法（映射、兼容、NAT64、6to4）取出 IPv4 再判断，
 * 否则 `::ffff:127.0.0.1`、`64:ff9b::a00:1` 这类地址会绕过 IPv4 检查。
 */
export function isBlockedIp(ip: string): boolean {
  const raw = ip.trim().replace(/^\[|\]$/g, "");
  if (net.isIPv4(raw)) return isNonPublicIpv4(raw.split(".").map(Number));
  const h = net.isIPv6(raw) ? ipv6Hextets(raw) : null;
  if (!h) return true;
  const embeddedV4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0 || h[5] === 0xffff)) {
    // ::、::1 以及 ::0.0.x.x 都不是公网地址；其余是 ::ffff:a.b.c.d（映射）或 ::a.b.c.d（兼容）
    if (h[5] === 0 && h[6] === 0) return true;
    return isNonPublicIpv4(embeddedV4(h[6]!, h[7]!));
  }
  if (h[0] === 0x64 && h[1] === 0xff9b) {
    // 64:ff9b::/96 是公用 NAT64 前缀，看内嵌 IPv4；64:ff9b:1::/48 是本地 NAT64，整段拦
    if (h.slice(2, 6).every((x) => x === 0)) return isNonPublicIpv4(embeddedV4(h[6]!, h[7]!));
    return true;
  }
  if (h[0] === 0x2002) return isNonPublicIpv4(embeddedV4(h[1]!, h[2]!)); // 6to4
  // 只有 2000::/3 是全球单播；fc00::/7、fe80::/10、fec0::/10、ff00::/8 等都落在外面
  if ((h[0]! & 0xe000) !== 0x2000) return true;
  if (h[0] === 0x2001 && h[1]! < 0x200) return true; // 2001::/23 IETF 协议分配（含 Teredo）
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true; // 文档示例
  if (h[0] === 0x3fff && h[1]! < 0x1000) return true; // 3fff::/20 文档示例
  return false;
}
