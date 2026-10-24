/**
 * 地址即状态：
 *   /               首页
 *   /run/<runId>    运行过程（实时跟进；结束后下面接着出结果）
 *   /result/<runId> 结果（从历史打开，不重新核查）
 * 分享链接 /s/<shareId> 由后端渲染，不经过这里。
 * 开发模式另认 `?part=home|running|result|history|share&run=<回放样例名或 runId>`，方便直接打开各部分；生产构建不认。
 */
import { useEffect, useState } from "react";

export type Route =
  | { view: "home" }
  | { view: "run"; run: string }
  | { view: "result"; run: string }
  /** 只在开发模式出现：首页上直接打开历史抽屉。 */
  | { view: "history" }
  /** 只在开发模式出现：分享页的前端预览。 */
  | { view: "share"; run: string };

const DEV_PARTS: Record<string, Route["view"]> = { home: "home", running: "run", result: "result", history: "history", share: "share" };

function read(): Route {
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const part = params.get("part");
    if (part && DEV_PARTS[part]) {
      const view = DEV_PARTS[part]!;
      const run = params.get("run") ?? "";
      if (view === "home" || view === "history") return { view };
      return { view, run };
    }
  }
  const [, view, id] = window.location.pathname.split("/");
  const run = id ? decodeURIComponent(id) : "";
  if (run && view === "run") return { view: "run", run };
  if (run && view === "result") return { view: "result", run };
  return { view: "home" };
}

export function hrefOf(route: Route): string {
  switch (route.view) {
    case "run":
      return `/run/${encodeURIComponent(route.run)}`;
    case "result":
      return `/result/${encodeURIComponent(route.run)}`;
    case "history":
      return import.meta.env.DEV ? "/?part=history" : "/";
    case "share":
      return import.meta.env.DEV ? `/?part=share&run=${encodeURIComponent(route.run)}` : "/";
    default:
      return "/";
  }
}

const listeners = new Set<(route: Route) => void>();

export function navigate(route: Route) {
  window.history.pushState(null, "", hrefOf(route));
  const next = read();
  for (const fn of listeners) fn(next);
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
