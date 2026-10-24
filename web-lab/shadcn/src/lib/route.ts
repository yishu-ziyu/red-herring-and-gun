import { useEffect, useState } from "react";

export type Part = "home" | "running" | "result" | "history" | "share";
const PARTS: Part[] = ["home", "running", "result", "history", "share"];

export type Route = { part: Part; run: string };

function read(): Route {
  const params = new URLSearchParams(window.location.search);
  const part = params.get("part") as Part | null;
  return { part: part && PARTS.includes(part) ? part : "home", run: params.get("run") ?? "" };
}

const listeners = new Set<(route: Route) => void>();

export function navigate(part: Part, run = "") {
  const params = new URLSearchParams();
  params.set("part", part);
  if (run) params.set("run", run);
  window.history.pushState(null, "", `/?${params}`);
  const route = read();
  for (const fn of listeners) fn(route);
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onPop = () => setRoute(read());
    listeners.add(setRoute);
    window.addEventListener("popstate", onPop);
    return () => {
      listeners.delete(setRoute);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return route;
}
