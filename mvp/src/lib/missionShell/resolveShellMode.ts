/**
 * resolveShellMode — live default is narrative token shell.
 * Opt out with ?shell=legacy | VITE_MISSION_SHELL=legacy|off|0|false
 * Opt into antdx with ?shell=antdx | VITE_MISSION_SHELL=antdx
 */

export type MissionShellVariant = "token" | "antdx";

export interface ResolvedShellMode {
  enabled: boolean;
  variant: MissionShellVariant;
}

const LEGACY = new Set(["legacy", "off", "0", "false", "no"]);

export function resolveShellMode(
  shellQuery: string | null | undefined,
  envShell: string | null | undefined
): ResolvedShellMode {
  const q = (shellQuery ?? "").trim().toLowerCase();
  const env = (envShell ?? "").trim().toLowerCase();

  if (LEGACY.has(q) || LEGACY.has(env)) {
    return { enabled: false, variant: "token" };
  }

  if (q === "antdx" || env === "antdx") {
    return { enabled: true, variant: "antdx" };
  }

  // Default: narrative token shell (product decision 2026-08-06)
  return { enabled: true, variant: "token" };
}
