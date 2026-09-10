import { useEffect, useMemo, useState } from "react";
import {
  BYO_PROVIDER_PRESETS,
  CUSTOM_PRESET_ID,
  matchByoPreset,
  type ByoProviderPreset,
} from "../../../lib/byoProviderPresets";
import { ProviderMark } from "./ProviderMark";
import "./ApiKeySettings.css";

const STORAGE_KEY = "gun-byo-key";
const TIMESTAMP_KEY = "gun-byo-key-last-tested-at";
const DEFAULT_PRESET = BYO_PROVIDER_PRESETS[0];

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

function modelsForPreset(preset: ByoProviderPreset, modelName: string) {
  if (!modelName.trim() || preset.models.some((model) => model.id === modelName)) {
    return preset.models;
  }
  return [...preset.models, { id: modelName, label: modelName }];
}

export function ApiKeySettings() {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_PRESET.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState(DEFAULT_PRESET.defaultModel);
  const [hydrated, setHydrated] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saveHint, setSaveHint] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = deobfuscate(raw);
      if (parsed) {
        const matched = matchByoPreset(parsed.baseUrl);
        setPresetId(matched?.id ?? CUSTOM_PRESET_ID);
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

  const selectedPreset = useMemo(
    () => BYO_PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? null,
    [presetId]
  );
  const isCustom = presetId === CUSTOM_PRESET_ID;
  const modelOptions = selectedPreset ? modelsForPreset(selectedPreset, modelName) : [];

  const baseUrlError = useMemo(() => {
    if (!hydrated) return "";
    if (!baseUrl.trim()) return "";
    if (!isSafeBaseUrl(baseUrl.trim())) {
      return "Base URL 必须以 https:// 开头（dev 允许 http://localhost）。";
    }
    return "";
  }, [baseUrl, hydrated]);

  const canSubmit = Boolean(baseUrl.trim() && apiKey.trim() && !baseUrlError);

  const selectPreset = (nextId: string) => {
    if (nextId === CUSTOM_PRESET_ID) {
      setPresetId(CUSTOM_PRESET_ID);
      return;
    }
    const next = BYO_PROVIDER_PRESETS.find((preset) => preset.id === nextId);
    if (!next) return;
    setPresetId(next.id);
    setBaseUrl(next.baseUrl);
    if (!next.models.some((model) => model.id === modelName)) {
      setModelName(next.defaultModel);
    }
  };

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
    <main className="api-key-settings" aria-label="模型设置">
      <div className="api-key-settings-inner">
        <header className="api-key-settings-header">
          <div className="api-key-header-left">
            <span className="api-key-header-tag">系统偏好 · LLM 引擎</span>
            <h1>模型设置</h1>
            <p className="api-key-settings-intro">
              点一家，只填密钥。密钥保存在本机浏览器存储中。
            </p>
          </div>
          <a href="/" className="api-key-settings-back" title="返回首页">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            返回首页
          </a>
        </header>

        {/* 服务商预设卡片 */}
        <section className="api-key-card" aria-labelledby="provider-heading">
          <div className="api-key-card-header">
            <h2 id="provider-heading" className="api-key-card-title">选择服务商</h2>
            <span className="api-key-card-desc">自动载入端点与推荐模型参数</span>
          </div>

          <div className="api-key-chip-row" role="group" aria-label="服务商">
            {BYO_PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="api-key-chip"
                aria-pressed={presetId === preset.id}
                onClick={() => selectPreset(preset.id)}
              >
                <ProviderMark id={preset.id} />
                <span>{preset.name}</span>
              </button>
            ))}
            <button
              type="button"
              className="api-key-chip"
              aria-pressed={isCustom}
              onClick={() => selectPreset(CUSTOM_PRESET_ID)}
            >
              <ProviderMark id="custom" />
              <span>自定义</span>
            </button>
          </div>
        </section>

        {/* 参数与密钥配置卡片 */}
        <section className="api-key-card" aria-labelledby="credentials-heading">
          <div className="api-key-card-header">
            <h2 id="credentials-heading" className="api-key-card-title">端点与访问凭证</h2>
            <span className="api-key-card-desc">仅在发起核查与测试时使用</span>
          </div>

          <div className="api-key-form-grid">
            <label className="api-key-field">
              <span>接口地址</span>
              <div className="api-key-input-wrapper">
                <input
                  aria-label="Base URL"
                  type="text"
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
            </label>

            <label className="api-key-field">
              <div className="api-key-field-header">
                <span>API Key</span>
              </div>
              <div className="api-key-input-wrapper">
                <input
                  aria-label="API Key"
                  type={showKey ? "text" : "password"}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="api-key-toggle-visibility"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                  tabIndex={-1}
                >
                  {showKey ? "隐藏" : "显示"}
                </button>
              </div>
            </label>

            {isCustom ? (
              <label className="api-key-field">
                <span>模型名</span>
                <div className="api-key-input-wrapper">
                  <input
                    aria-label="Model Name"
                    type="text"
                    placeholder="可留空"
                    autoComplete="off"
                    spellCheck={false}
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                  />
                </div>
              </label>
            ) : (
              <div className="api-key-field">
                <span>模型</span>
                <div className="api-key-model-row" role="group" aria-label="模型">
                  {modelOptions.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className="api-key-model-pill"
                      aria-pressed={modelName === model.id}
                      onClick={() => setModelName(model.id)}
                    >
                      {model.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {baseUrlError ? (
            <p className="api-key-settings-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{baseUrlError}</span>
            </p>
          ) : null}

          {saveHint ? (
            <p className="api-key-settings-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>{saveHint}</span>
            </p>
          ) : null}

          {testResult ? (
            <div
              className={`api-key-test-result ${testResult.ok ? "ok" : "fail"}`}
              role={testResult.ok ? "status" : "alert"}
              aria-live="polite"
            >
              <div className="api-key-test-result-header">
                <span className="api-key-status-dot" aria-hidden="true"></span>
                <strong>
                  {testResult.ok ? "连接成功" : "连接失败"}
                  {typeof testResult.latencyMs === "number" ? ` · ${testResult.latencyMs}ms` : ""}
                  {typeof testResult.status === "number" ? ` · HTTP ${testResult.status}` : ""}
                </strong>
              </div>
              {testResult.error ? <span>{testResult.error}</span> : null}
              <small>上次测试：{formatTestedAt(testResult.testedAt)}</small>
            </div>
          ) : null}

          <div className="api-key-actions-panel">
            <div className="api-key-actions">
              <button
                type="button"
                className="api-key-btn api-key-btn-secondary"
                onClick={handleTest}
                disabled={!canSubmit || testing}
                aria-busy={testing}
              >
                {testing ? "测试中…" : "测试连接"}
              </button>
              <button
                type="button"
                className="api-key-btn api-key-btn-primary"
                onClick={handleSave}
                disabled={!canSubmit}
              >
                保存
              </button>
            </div>
          </div>
        </section>

        {/* 底部安全声明 Callout */}
        <aside className="api-key-security-callout" aria-label="安全与存储说明">
          <svg className="api-key-security-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <p className="api-key-settings-footnote">
            密钥只保存在这台电脑的浏览器里，本站不做存储。点「测试连接」时，会由本站后端替你向所填的服务商地址发起一次连接验证，验证过程与结果都不会展示密钥。共用电脑使用后，请清除本页保存的配置。
          </p>
        </aside>
      </div>
    </main>
  );
}

export default ApiKeySettings;
