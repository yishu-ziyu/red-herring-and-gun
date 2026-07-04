import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "gun-byo-key";
const TIMESTAMP_KEY = "gun-byo-key-last-tested-at";

interface StoredKey {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  error?: string;
  testedAt: number;
}

function obfuscate(value: StoredKey): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function deobfuscate(raw: string): StoredKey | null {
  try {
    const decoded = decodeURIComponent(escape(atob(raw)));
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.baseUrl === "string" &&
      typeof parsed.apiKey === "string" &&
      typeof parsed.modelName === "string"
    ) {
      return parsed as StoredKey;
    }
    return null;
  } catch {
    return null;
  }
}

function isSafeBaseUrl(baseUrl: string): boolean {
  if (baseUrl.startsWith("https://")) return true;
  if (baseUrl.startsWith("http://localhost")) return true;
  if (baseUrl.startsWith("http://127.0.0.1")) return true;
  return false;
}

function formatTestedAt(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export function ApiKeySettings() {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saveHint, setSaveHint] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = deobfuscate(raw);
      if (parsed) {
        setBaseUrl(parsed.baseUrl);
        setApiKey(parsed.apiKey);
        setModelName(parsed.modelName);
      }
    }
    const lastTs = window.localStorage.getItem(TIMESTAMP_KEY);
    if (lastTs && !Number.isNaN(Number(lastTs))) {
      setTestResult({
        ok: true,
        testedAt: Number(lastTs),
      });
    }
    setHydrated(true);
  }, []);

  const baseUrlError = useMemo(() => {
    if (!hydrated) return "";
    if (!baseUrl.trim()) return "";
    if (!isSafeBaseUrl(baseUrl.trim())) {
      return "Base URL 必须以 https:// 开头（dev 允许 http://localhost）。";
    }
    return "";
  }, [baseUrl, hydrated]);

  const canSubmit = baseUrl.trim() && apiKey.trim() && !baseUrlError;

  const handleSave = () => {
    if (!canSubmit) return;
    const payload: StoredKey = {
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
    };
    window.localStorage.setItem(STORAGE_KEY, obfuscate(payload));
    setSaveHint("已保存到本地浏览器存储。");
    window.setTimeout(() => setSaveHint(""), 2500);
  };

  const handleTest = async () => {
    setSaveHint("");
    if (!canSubmit) {
      setTestResult({
        ok: false,
        error: baseUrlError || "请填写 Base URL 和 API Key。",
        testedAt: Date.now(),
      });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/agent/test-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          modelName: modelName.trim(),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        latencyMs?: number;
        status?: number;
        error?: string;
      };
      const result: TestResult = {
        ok: Boolean(data.ok),
        latencyMs: data.latencyMs,
        status: data.status,
        error: data.error,
        testedAt: Date.now(),
      };
      setTestResult(result);
      if (result.ok) {
        window.localStorage.setItem(TIMESTAMP_KEY, String(result.testedAt));
      }
    } catch (error) {
      setTestResult({
        ok: false,
        error: error instanceof Error ? error.message : "未知网络错误",
        testedAt: Date.now(),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="api-key-settings" aria-label="BYO Key 设置">
      <header className="api-key-settings-header">
        <div>
          <span>BYO Key</span>
          <h1>自带 API Key</h1>
        </div>
        <a href="/" className="api-key-settings-back">返回首页</a>
      </header>

      <section className="api-key-settings-card" aria-label="配置表单">
        <p className="api-key-settings-intro">
          填入 OpenAI 兼容协议的 base URL、API Key 与模型名。密钥仅保存在你本机的浏览器存储中，不会上传到我们的服务端。
        </p>

        <div className="api-key-form-grid">
          <label>
            <span>Base URL</span>
            <input
              aria-label="Base URL"
              type="text"
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              aria-label="API Key"
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label>
            <span>Model Name</span>
            <input
              aria-label="Model Name"
              type="text"
              placeholder="gpt-4o-mini（可留空）"
              autoComplete="off"
              spellCheck={false}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </label>
        </div>

        {baseUrlError ? (
          <p className="api-key-settings-error" role="alert">{baseUrlError}</p>
        ) : null}

        <div className="api-key-actions">
          <button
            type="button"
            onClick={handleTest}
            disabled={!canSubmit || testing}
            aria-busy={testing}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSubmit}
          >
            保存
          </button>
        </div>

        {saveHint ? <p className="api-key-settings-hint">{saveHint}</p> : null}

        {testResult ? (
          <div
            className={`api-key-test-result ${testResult.ok ? "ok" : "fail"}`}
            role={testResult.ok ? "status" : "alert"}
            aria-live="polite"
          >
            <strong>
              {testResult.ok ? "连接成功" : "连接失败"}
              {typeof testResult.latencyMs === "number" ? ` · ${testResult.latencyMs}ms` : ""}
              {typeof testResult.status === "number" ? ` · HTTP ${testResult.status}` : ""}
            </strong>
            {testResult.error ? <span>{testResult.error}</span> : null}
            <small>上次测试：{formatTestedAt(testResult.testedAt)}</small>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default ApiKeySettings;