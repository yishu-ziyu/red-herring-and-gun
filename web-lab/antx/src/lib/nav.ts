// 用 URL 查询参数切换各部分：/?part=home|running|result|history|share&run=<样例>&live=<runId>
import { useEffect, useState } from "react";

export type Route = { part: string; run?: string; live?: string };

function read(): Route {
  const q = new URLSearchParams(window.location.search);
  return { part: q.get("part") || "home", run: q.get("run") || undefined, live: q.get("live") || undefined };
}

export function hrefOf(route: Route): string {
  const q = new URLSearchParams();
  q.set("part", route.part);
  if (route.run) q.set("run", route.run);
  if (route.live) q.set("live", route.live);
  return `/?${q.toString()}`;
}

export function navigate(route: Route) {
  window.history.pushState(null, "", hrefOf(route));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
