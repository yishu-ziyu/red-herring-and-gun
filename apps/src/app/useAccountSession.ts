/**
 * 账户与它名下的历史：我是谁（/me）、服务端存档列表、本机留存，按同一个账户作用域合并。
 *
 * scopeVersion 是账户作用域的版本号：登录、退出、重新水合都会让它变，迟到的旧响应一律丢弃
 * （退出后迟到的旧报告不渲染、迟到的打开失败不提示）。accountEmailRef 让异步回调读到当下的账户。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountProfile } from "../components/v3/auth/accountTypes";
import type { ShellCase } from "../goldenPath/ProductShell";
import { accountDisplayName } from "../lib/accountIdentity";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { threadSummary } from "../lib/investigationThread";
import { groupThreadCases, toShellCases, type ServerCaseItem } from "./caseViews";

export function useAccountSession() {
  const [cases, setCases] = useState<ShellCase[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const scopeVersion = useRef(0);
  const accountEmailRef = useRef<string | null>(null);

  // 与旧壳同一纪律：不用 AbortSignal（/me /cases 是幂等 GET，重复结果幂等）。
  const hydrateAccountCases = useCallback(async () => {
    const version = ++scopeVersion.current;
    setHistoryReady(false);
    try {
      const me = await fetch("/api/auth/email/me", { credentials: "include" });
      if (version !== scopeVersion.current) return;
      if (!me.ok) {
        setAccount(null);
        accountEmailRef.current = null;
      } else {
        const data = (await me.json()) as Partial<AccountProfile> & { authenticated?: boolean; email?: string };
        if (version !== scopeVersion.current) return;
        if (data.authenticated && typeof data.email === "string") {
          setAccount({
            email: data.email,
            displayName: typeof data.displayName === "string" ? data.displayName : "",
            name: typeof data.name === "string" ? data.name : accountDisplayName(data.email, data.displayName),
            createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
            loginCount: typeof data.loginCount === "number" ? data.loginCount : 1,
            lastLoginAt: typeof data.lastLoginAt === "number" ? data.lastLoginAt : Date.now(),
          });
          accountEmailRef.current = data.email;
        } else {
          setAccount(null);
          accountEmailRef.current = null;
        }
      }
      const listRes = await fetch("/api/cases", { credentials: "include" });
      if (listRes.ok && version === scopeVersion.current) {
        const list = (await listRes.json()) as { cases?: ServerCaseItem[] };
        setCases(groupThreadCases(toShellCases(Array.isArray(list.cases) ? list.cases : [])));
      }
      const local = await createKnowledgeBase(accountEmailRef.current).listCases();
      if (version !== scopeVersion.current) return;
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
      setHistoryReady(true);
    } catch {
      if (version === scopeVersion.current) setHistoryReady(true);
    }
  }, []);

  useEffect(() => {
    void hydrateAccountCases();
  }, [hydrateAccountCases]);

  return { account, setAccount, accountEmailRef, scopeVersion, cases, setCases, historyReady, hydrateAccountCases };
}
