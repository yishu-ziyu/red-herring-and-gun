/**
 * ipGuard.ts — 检查 DNS 解析出的每个地址是不是公网单播。
 * 单独成文件，因为它用 node:net，而 ssrfGuard.ts 会被前端打包（经 investigation 模块）引入。
 */
import net from "node:net";
import { isBlockedPrivateIpv4 } from "./ssrfGuard.js";

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
