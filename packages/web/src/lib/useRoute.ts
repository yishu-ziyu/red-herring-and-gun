import { useCallback, useEffect, useState } from "react";

export type Route = { page: "home" } | { page: "settings" } | { page: "case"; caseId: string };

export function parsePath(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/settings") return { page: "settings" };
  const match = /^\/cases\/([^/]+)$/.exec(clean);
  if (match?.[1]) return { page: "case", caseId: decodeURIComponent(match[1]) };
  return { page: "home" };
}

export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: string) => {
    window.history.pushState(null, "", next);
    setPath(next);
  }, []);
  return { path, route: parsePath(path), navigate };
}
