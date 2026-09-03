import type { Tier } from "../fetch/types.js";
import { TIER_A_HOSTS, TIER_A_SUFFIXES, TIER_B_HOSTS, TIER_C_OVERRIDES } from "./sourceTiers.data.js";

export function stripMobileOrWww(host: string): string {
  let h = host.toLowerCase();
  for (;;) {
    if (h.startsWith("www.")) {
      h = h.slice(4);
      continue;
    }
    if (h.startsWith("m.")) {
      h = h.slice(2);
      continue;
    }
    return h;
  }
}

function hostEqualsOrSuffix(host: string, pattern: string): boolean {
  const h = stripMobileOrWww(host);
  const p = stripMobileOrWww(pattern);
  return h === p || h.endsWith(`.${p}`);
}

export function tierOf(host: string): Tier {
  for (const pattern of TIER_C_OVERRIDES) {
    if (hostEqualsOrSuffix(host, pattern)) return "C";
  }
  const h = stripMobileOrWww(host);
  for (const suffix of TIER_A_SUFFIXES) {
    const bare = suffix.slice(1);
    if (h === bare || h.endsWith(suffix)) return "A";
  }
  for (const pattern of TIER_A_HOSTS) {
    if (hostEqualsOrSuffix(host, pattern)) return "A";
  }
  for (const pattern of TIER_B_HOSTS) {
    if (hostEqualsOrSuffix(host, pattern)) return "B";
  }
  return "C";
}
