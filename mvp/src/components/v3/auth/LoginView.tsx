/**
 * LoginView.tsx — v3 邮箱登录两段表单
 *
 * 设计：复用 dashboard 视觉锚点 + cinema 动效，杂志质感排版
 */

import { useCallback, useEffect, useState } from "react";

type Stage = "email" | "code" | "success";

interface LoginViewProps {
  onSuccess?: () => void;
}

interface ErrorPayload {
  error?: string;
  message?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginView({ onSuccess }: LoginViewProps) {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        const data = (await res.json().catch(() => ({}))) as ErrorPayload;
        if (res.status === 429 || data.error === "rate_limit") {
          setError("请求过于频繁,请 1 分钟后再试");
          return;
        }
        if (!res.ok) {
          setError(data.message ?? data.error ?? "验证码发送失败");
          return;
        }
        setStage("code");
      } catch {
        setError("网络异常,请重试");
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
        window.setTimeout(() => {
          window.location.href = "/";
        }, 200);
      } catch {
        setError("网络异常,请重试");
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
    <main className="dashboard editorial" aria-label="邮箱登录">
      <section
        className="dashboard-input-card cinema-rise"
        style={{ maxWidth: 480 }}
      >
        <header>
          <span className="small-caps" style={{ color: "var(--zt-text-secondary)" }}>
            邮箱登录
          </span>
          <h1
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--font-serif)",
              fontSize: "var(--type-headline)",
              letterSpacing: "var(--tracking-tight)",
              lineHeight: "var(--leading-snug)",
            }}
          >
            {stage === "code"
              ? "输入验证码"
              : stage === "success"
              ? "登录成功"
              : "继续真实核查"}
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              fontFamily: "var(--font-serif)",
              fontSize: "var(--type-meta)",
              color: "var(--zt-text-secondary)",
              fontStyle: "italic",
              lineHeight: "var(--leading-snug)",
            }}
          >
            {stage === "code"
              ? `验证码已发送至 ${email}(开发模式请查看服务端 console)`
              : "首次使用即自动注册免费账号。5 次 / 30 天免费额度,用完可在「设置 → 模型服务商」中接入 BYO Key。"}
          </p>
        </header>

        {stage === "email" ? (
          <form
            onSubmit={handleSubmitEmail}
            className="landing-input-actions cinema-rise cinema-rise-d1"
            style={{ flexDirection: "column", alignItems: "stretch" }}
          >
            <label className="small-caps" htmlFor="email-input">
              邮箱
            </label>
            <input
              id="email-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="dashboard-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={submitting}
            />
            {error ? <p className="landing-input-error">{error}</p> : null}
            <button
              type="submit"
              className="dashboard-submit-btn"
              disabled={submitting || email.trim().length === 0}
            >
              {submitting ? "发送中…" : "发送验证码"}
            </button>
          </form>
        ) : null}

        {stage === "code" ? (
          <form
            onSubmit={handleSubmitCode}
            className="landing-input-actions cinema-rise cinema-rise-d1"
            style={{ flexDirection: "column", alignItems: "stretch" }}
          >
            <label className="small-caps" htmlFor="code-input">
              6 位验证码
            </label>
            <input
              id="code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="dashboard-input"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
              }
              required
              disabled={submitting}
              autoFocus
              style={{
                letterSpacing: "0.4em",
                fontFamily: "var(--font-mono)",
                fontSize: "1.5rem",
                textAlign: "center",
              }}
            />
            {error ? <p className="landing-input-error">{error}</p> : null}
            <button
              type="submit"
              className="dashboard-submit-btn"
              disabled={submitting || code.length !== 6}
            >
              {submitting ? "校验中…" : "登录"}
            </button>
            <button
              type="button"
              className="landing-material-btn"
              onClick={() => setStage("email")}
              style={{ alignSelf: "flex-start" }}
            >
              换个邮箱
            </button>
          </form>
        ) : null}

        {stage === "success" ? (
          <p
            className="cinema-veil"
            style={{
              color: "#15803d",
              fontSize: 14,
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          >
            登录成功,正在跳转…
          </p>
        ) : null}
      </section>
    </main>
  );
}
