/**
 * 调查历史：只在这个浏览器里（localStorage）。挂载时读一次。
 */
import { useEffect, useState } from "react";
import type { ShellCase } from "../goldenPath/ProductShell";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { threadSummary } from "../lib/investigationThread";
import { groupThreadCases } from "./caseViews";

export function useLocalHistory() {
  const [cases, setCases] = useState<ShellCase[]>([]);
  const [historyReady, setHistoryReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const local = await createKnowledgeBase(null).listCases();
        if (cancelled) return;
        setCases((prev) => {
          const localItems: ShellCase[] = local.map((entry) => ({
            id: entry.id,
            claim: threadSummary(entry.finalReport).threadClaim ?? entry.claim,
            ...threadSummary(entry.finalReport),
            status: (entry.finalReport as Record<string, unknown>)._source === "error-boundary" ? "interrupted" as const : "done" as const,
            createdAt: entry.timestamp,
            report: entry.finalReport as Record<string, unknown>,
          }));
          const ids = new Set(localItems.map((item) => item.id));
          return groupThreadCases([...localItems, ...prev.filter((item) => !ids.has(item.id))]);
        });
      } catch {
        /* 本机历史读不出来：列表留空，不挡新调查 */
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { cases, setCases, historyReady };
}
