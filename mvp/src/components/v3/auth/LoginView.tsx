/**
 * LoginView — 邮箱验证码两段表单。
 * 登录不挡核查；只为跨设备记住最近核查。
 * 配了发信时让用户从邮箱抄码；只有未配置发信的开发回退才展示面板验证码。
 */

import { useCallback, useEffect, useState } from "react";

type Stage = "email" | "code" | "success";

interface LoginViewProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface ErrorPayload {
  error?: string;
  message?: string;
  delivery?: string;
  devCode?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginView({ onSuccess, onCancel }: LoginViewProps) {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmitEmail = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = email.trim();
      if (!EMAIL_REGEX.test(trimmed)) {
        setError("请输入有效邮箱地址");
        return;
      }
      setError("");
      setSubmitting(true);
      try {
        const res = await fetch("/api/auth/email/request", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        const data = (await res.json().catch(() => ({}))) as ErrorPayload;
        if (res.status === 429 || data.error === "rate_limit") {
          setError("请求过于频繁，请 1 分钟后再试");
          return;
        }
        if (!res.ok) {
          setError(data.message ?? data.error ?? "验证码发送失败");
          return;
        }
        const nextDevCode =
          data.delivery === "dev-panel" && typeof data.devCode === "string" && /^\d{6}$/.test(data.devCode)
            ? data.devCode
            : "";
        setDevCode(nextDevCode);
        setCode(nextDevCode);
        setStage("code");
      } catch {
        setError("网络异常，请重试");
      } finally {
        setSubmitting(false);
      }
    },
    [email]
  );

  const handleSubmitCode = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = code.trim();
      if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
        setError("请输入 6 位数字验证码");
        return;
      }
      setError("");
      setSubmitting(true);
      try {
        const res = await fetch("/api/auth/email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: email.trim(), code: trimmed }),
        });
        const data = (await res.json().catch(() => ({}))) as ErrorPayload;
        if (res.status === 401) {
          setError(data.message ?? "验证码不正确或已过期");
          return;
        }
        if (!res.ok) {
          setError(data.message ?? data.error ?? "登录失败");
          return;
        }
        setStage("success");
        onSuccess?.();
      } catch {
        setError("网络异常，请重试");
      } finally {
        setSubmitting(false);
      }
    },
    [code, email, onSuccess]
  );

  useEffect(() => {
    if (stage === "success") return;
    setError("");
  }, [stage]);

  return (
    <section className="app-login-panel" aria-label="邮箱登录">
      <header>
        <h2>
          {stage === "code" ? "输入验证码" : stage === "success" ? "登录成功" : "登录"}
        </h2>
        <p>
          {stage === "code"
            ? devCode
              ? "还没配发信。开发环境用下面这个验证码。"
              : `验证码已发到 ${email}`
            : "登录后，最近核查可以在别的设备接着看。不登录也能查。"}
        </p>
      </header>

      {stage === "email" ? (
        <form onSubmit={handleSubmitEmail}>
          <label htmlFor="email-input">邮箱</label>
          <input
            id="email-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={submitting}
          />
          {error ? <p className="app-login-error">{error}</p> : null}
          <div className="app-login-actions">
            <button type="submit" disabled={submitting || email.trim().length === 0}>
              {submitting ? "发送中…" : "发送验证码"}
            </button>
            {onCancel ? (
              <button type="button" className="app-login-secondary" onClick={onCancel}>
                取消
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {stage === "code" ? (
        <form onSubmit={handleSubmitCode}>
          {devCode ? (
            <p className="app-login-dev-code" aria-live="polite">
              <span>开发验证码</span>
              <strong>{devCode}</strong>
            </p>
          ) : null}
          <label htmlFor="code-input">6 位验证码</label>
          <input
            id="code-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            required
            disabled={submitting}
            autoFocus
            className="app-login-code"
          />
          {error ? <p className="app-login-error">{error}</p> : null}
          <div className="app-login-actions">
            <button type="submit" disabled={submitting || code.length !== 6}>
              {submitting ? "校验中…" : "登录"}
            </button>
            <button
              type="button"
              className="app-login-secondary"
              onClick={() => {
                setStage("email");
                setDevCode("");
                setCode("");
              }}
            >
              换个邮箱
            </button>
          </div>
        </form>
      ) : null}

      {stage === "success" ? <p className="app-login-ok">登录成功</p> : null}
    </section>
  );
}
