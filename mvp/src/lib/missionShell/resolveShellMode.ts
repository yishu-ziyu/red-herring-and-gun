/**
 * resolveShellMode — live check is always the product token shell.
 * ?shell=legacy | ?legacyStream=1 | VITE_MISSION_SHELL=legacy|off|0|false
 * are not opt-outs. antdx remains a resolver token only; live UI freezes to token.
 */

export type MissionShellVariant = "token" | "antdx";

export interface ResolvedShellMode {
  enabled: boolean;
  variant: MissionShellVariant;
}

export function readLiveShellQuery(
  search: string | URLSearchParams | null | undefined
): string | null {
  if (search == null || search === "") return null;
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const shell = params.get("shell");
  if (shell !== null) return shell;
  if (params.get("legacyStream") === "1") return "legacy";
  return null;
}

export function resolveShellMode(
  shellQuery: string | null | undefined,
  envShell: string | null | undefined
): ResolvedShellMode {
  const q = (shellQuery ?? "").trim().toLowerCase();
  const env = (envShell ?? "").trim().toLowerCase();

  if (q === "antdx" || env === "antdx") {
    return { enabled: true, variant: "antdx" };
  }

  return { enabled: true, variant: "token" };
}
