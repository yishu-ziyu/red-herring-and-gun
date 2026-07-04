/**
 * PrivacyPolicy.tsx — v3 隐私政策 + 数据导出 / 删除页
 *
 * 设计原则：
 * - 静态政策部分用中文 Inline,不做空泛的"我们会保护您的隐私"式口号
 * - 「导出我的数据」直接触发浏览器下载 JSON;不解析后端返回的 stdout / status
 * - 「删除账户」走二次确认,与 Dashboard 视觉一致
 */

import { useCallback, useState } from "react";

interface PrivacyPolicyProps {
  /** 当前邮箱,只为打招呼。如果前端已经 /api/auth/email/me 验证了再传入 */
  email?: string;
  /** 删除成功后的钩子,通常切到 Dashboard */
  onDeleted?: () => void;
}

const TOU_BULLETS = [
  "本工具为事实核查辅助,不提供医疗 / 法律 / 金融建议",
  "所有结果基于公开网络搜索 + 多模型共识,模型可能误判,关键判断请二次核实",
  "你可随时导出或删除你的账号数据,我们不向你收取费用即可随时走人",
  "运行所需 LLM 推理默认走公益额度;配额用尽后请在「设置 → 模型服务商」中接入 BYO Key",
];

const PRIVACY_COLLECT = [
  "邮箱地址(用作账号唯一标识,前端展示用)",
  "邮箱对应的 SHA-256 哈希(用作内部账号索引,不含明文邮箱)",
  "本次登录时间、登录设备 IP(User-Agent 由浏览器自动附带)",
  "你已经提交的核查请求的元数据(请求时间、Agent 调度结果状态)",
];
const PRIVACY_DONT_COLLECT = [
  "你的浏览器 cookie 之外的任何浏览历史",
  "上传图片中的明文 PII(图片仅用于本次请求,不持久化明文存档)",
  "你的模型服务商 API Key(BYO Key 仅存于 localStorage,不发送到我们的服务端)",
];

type ActionState = "idle" | "exporting" | "exported" | "deleting" | "deleted" | "error";

export function PrivacyPolicy({ email, onDeleted }: PrivacyPolicyProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [action, setAction] = useState<ActionState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleExport = useCallback(async () => {
    setAction("exporting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/account/export", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(data.error ?? `导出失败 (${res.status})`);
        setAction("error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = url;
      link.download = `red-herring-account-export-${ts}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setAction("exported");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "导出失败");
      setAction("error");
    }
  }, []);

  const handleDelete = useCallback(async () => {
    setAction("deleting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(data.error ?? `删除失败 (${res.status})`);
        setAction("error");
        return;
      }
      setAction("deleted");
      setConfirmingDelete(false);
      onDeleted?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "删除失败");
      setAction("error");
    }
  }, [onDeleted]);

  return (
    <main className="privacy-policy-page editorial cinema-rise" aria-label="隐私与数据">
      <section style={{ maxWidth: 720, margin: "0 auto" }}>
        <header>
          <span className="small-caps">隐私与数据</span>
          <h1>你的数据,你的控制</h1>
          {email ? (
            <p className="lede">当前账号:{email}</p>
          ) : null}
        </header>

        <article>
          <h2>服务条款概要</h2>
          <ul>
            {TOU_BULLETS.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </article>

        <article>
          <h2>隐私政策</h2>
          <p>我们收集:</p>
          <ul>
            {PRIVACY_COLLECT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>我们不收集:</p>
          <ul>
            {PRIVACY_DONT_COLLECT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article>
          <h2>数据主权</h2>
          <div className="privacy-section-actions">
            <button
              type="button"
              className="privacy-action"
              onClick={handleExport}
              disabled={action === "exporting"}
            >
              {action === "exporting" ? "导出中…" : action === "exported" ? "已导出" : "导出我的数据"}
            </button>
            {!confirmingDelete ? (
              <button
                type="button"
                className="privacy-action privacy-action--danger"
                onClick={() => setConfirmingDelete(true)}
              >
                删除账户
              </button>
            ) : (
              <div className="privacy-section-actions">
                <button
                  type="button"
                  className="privacy-action privacy-action--danger"
                  onClick={handleDelete}
                  disabled={action === "deleting"}
                >
                  {action === "deleting" ? "删除中…" : "确认删除(不可恢复)"}
                </button>
                <button
                  type="button"
                  className="privacy-action"
                  onClick={() => setConfirmingDelete(false)}
                  style={{ background: "transparent", color: "var(--zt-text-secondary)", borderColor: "var(--border-subtle)" }}
                >
                  取消
                </button>
              </div>
            )}
          </div>
          {action === "deleted" ? (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#15803d" }}>
              账户已删除,正在刷新…
            </p>
          ) : null}
          {errorMsg ? <p className="landing-input-error">{errorMsg}</p> : null}
        </article>
      </section>
    </main>
  );
}
