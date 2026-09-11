/**
 * AccountView — ChatGPT / Kimi 式账户页：称呼、邮箱、登录次数。
 * 不是个人主页，也不挡核查。
 */

import { useCallback, useState } from "react";
import { ACCOUNT_NAME_MAX, accountInitial } from "../../../lib/accountIdentity";
import type { AccountProfile } from "./accountTypes";

interface AccountViewProps {
  account: AccountProfile;
  onClose: () => void;
  onSaved: (account: AccountProfile) => void;
  onDeleted: () => void;
}

function formatDay(at: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(at);
}

export function AccountView({ account, onClose, onSaved, onDeleted }: AccountViewProps) {
  const [name, setName] = useState(account.displayName);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSave = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError("");
      setNotice("");
      setSaving(true);
      try {
        const res = await fetch("/api/auth/email/profile", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: name }),
        });
        const data = (await res.json().catch(() => ({}))) as AccountProfile & {
          ok?: boolean;
          message?: string;
        };
        if (!res.ok) {
          setError(data.message ?? "没保存成");
          return;
        }
        onSaved({
          email: data.email ?? account.email,
          displayName: data.displayName ?? "",
          name: data.name ?? account.name,
          createdAt: data.createdAt ?? account.createdAt,
          loginCount: data.loginCount ?? account.loginCount,
          lastLoginAt: data.lastLoginAt ?? account.lastLoginAt,
        });
        setNotice("已保存");
      } catch {
        setError("网络异常，请重试");
      } finally {
        setSaving(false);
      }
    },
    [account, name, onSaved]
  );

  const handleExport = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/account/export", { credentials: "include" });
      if (!res.ok) {
        setError("导出失败");
        return;
      }
      const payload = await res.json();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "red-herring-account.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("导出失败");
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!window.confirm("删除账户后，这个邮箱下记住的核查会一起去掉。确定？")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account", { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        setError("没删掉，请稍后再试");
        return;
      }
      onDeleted();
    } catch {
      setError("没删掉，请稍后再试");
    } finally {
      setBusy(false);
    }
  }, [onDeleted]);

  return (
    <section className="app-login-panel app-account-panel" aria-label="账户">
      <header className="app-account-head">
        <span className="app-shell-avatar" aria-hidden="true">
          {accountInitial(account.name)}
        </span>
        <div>
          <h2>{account.name}</h2>
          <p>{account.email}</p>
        </div>
      </header>
      <form onSubmit={handleSave}>
        <label htmlFor="account-display-name">怎么称呼你</label>
        <input
          id="account-display-name"
          value={name}
          maxLength={ACCOUNT_NAME_MAX}
          placeholder={account.email.split("@")[0] ?? ""}
          onChange={(event) => {
            setName(event.target.value);
            setNotice("");
          }}
        />
        {error ? <p className="app-login-error">{error}</p> : null}
        {notice ? <p className="app-login-ok">{notice}</p> : null}
        <div className="app-login-actions">
          <button type="submit" disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
          <button type="button" className="app-login-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </form>
      <dl className="app-account-facts">
        <div>
          <dt>邮箱</dt>
          <dd>{account.email}</dd>
        </div>
        <div>
          <dt>加入</dt>
          <dd>{formatDay(account.createdAt)}</dd>
        </div>
        <div>
          <dt>登录</dt>
          <dd>{account.loginCount} 次</dd>
        </div>
      </dl>
      <div className="app-account-data">
        <button type="button" className="app-login-secondary" onClick={() => void handleExport()}>
          导出我的数据
        </button>
        <button type="button" className="app-login-secondary app-account-danger" onClick={() => void handleDelete()} disabled={busy}>
          删除账户
        </button>
      </div>
    </section>
  );
}
